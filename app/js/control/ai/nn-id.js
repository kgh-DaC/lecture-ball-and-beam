// nn-id.js — 신경망 시스템 식별 (ai-extension §2.5, 16장)
//
// 데이터: 가상 볼앤빔(simulate.stepPlant: 공 + 가정 서보 fo_slew + 지연 + 빔 끝 정지)에
//   안정화 PD(참 상태 사용) + PRBS 형 각도 섭동을 넣어 빔 위를 고루 돌아다니게 하고 Ts = 0.06 s 마다 기록.
//   x_k = [y, ẏ, θ] (참 상태, 선택적으로 측정 잡음),  입력 u_k(이번 명령), u_{k−1}(직전 명령: 서보 지연 정보)
//   학습 쌍  [x_k, u_k, u_{k−1}] → Δx_k = x_{k+1} − x_k   (잔차를 배우면 쉬움: x_{k+1} ≈ x_k)
// 물리 모델 비교: plant.stateSpace(서보 포함 3상태 / 공만 2상태) → ZOH c2d(Ts).  지연·속도 한계·빔 끝은 물리 모델에 없다.
// 다단계 예측: 같은 시작 상태에서 기록된 u 열로 각 모델을 h 스텝 굴리고 y 오차의 RMSE (자기 예측이 누적된다).
import { rng } from '../linalg.js';
import { stepPlant, initPlantState } from '../simulate.js';
import { makeModel, ASSUMED_SERVO, stateSpace } from '../plant.js';
import { c2d } from '../analysis.js';
import { createMLP, createTrainer, fitNormalizer, normalize, denormalize, forward, toJSON, fromJSON } from './mlp.js';

const TS = 0.06;
const Y_LO = 0.02, Y_HI = 0.33;

/** 한 궤적 생성 (참 상태) */
function genTraj(model, R, n, { excitation = 'prbs', kp = 1.2, kd = 1.6, amp = 0.15 } = {}) {
  const st = initPlantState(model, { y_m: 0.06 + 0.22 * R.uniform() });
  let ref = 0.06 + 0.22 * R.uniform(), dither = 0, hold = 0, refHold = 0;
  const x = [], u = [];
  for (let k = 0; k < n; k++) {
    if (hold <= 0) {
      dither = excitation === 'prbs' ? (R.uniform() < 0.5 ? -1 : 1) * amp * (0.3 + 0.7 * R.uniform()) : amp * (2 * R.uniform() - 1);
      hold = 2 + Math.floor(8 * R.uniform());
    }
    if (refHold <= 0) { ref = 0.05 + 0.24 * R.uniform(); refHold = 30 + Math.floor(60 * R.uniform()); }
    hold--; refHold--;
    const uk = Math.max(-model.u_lim_rad, Math.min(model.u_lim_rad, kp * (ref - st.y_m) - kd * st.ydot_m_s + dither));
    x.push([st.y_m, st.ydot_m_s, st.theta_rad]);
    u.push(uk);
    stepPlant(st, uk, TS, model, { substeps: 6, y_min_m: Y_LO, y_max_m: Y_HI });
  }
  x.push([st.y_m, st.ydot_m_s, st.theta_rad]);
  return { t_s: x.map((_, k) => k * TS), x, u };
}

/**
 * 데이터셋 생성 → { X, Y, traj, test_traj, meta }
 * @param opts { n_samples=3000, seed=1, noise_m=0, excitation='prbs'|'random', traj_len=200, n_test_traj=3 }
 *   noise_m: 기록 상태에 넣는 측정 잡음 σ — y: noise_m, ẏ: 5·noise_m /s, θ: 2·noise_m rad/m (1 mm → 0.002 rad)
 *            (과적합 시연용; 시험 궤적 test_traj 에는 잡음이 없다)
 */
export function generateDataset({ n_samples = 3000, seed = 1, noise_m = 0, excitation = 'prbs', traj_len = 200, n_test_traj = 3 } = {}) {
  const model = makeModel({ servo_tf: { ...ASSUMED_SERVO } });
  const R = rng(seed);
  const X = [], Y = [], traj = [];
  const nz = (v, s) => (s > 0 ? v + s * R.normal() : v);
  while (X.length < n_samples) {
    const tr = genTraj(model, R, Math.min(traj_len, n_samples - X.length), { excitation });
    const xn = tr.x.map((x) => [nz(x[0], noise_m), nz(x[1], 5 * noise_m), nz(x[2], 2 * noise_m)]);
    for (let k = 0; k < tr.u.length; k++) {
      X.push([...xn[k], tr.u[k], k > 0 ? tr.u[k - 1] : tr.u[k]]);
      Y.push([0, 1, 2].map((j) => xn[k + 1][j] - xn[k][j]));
    }
    traj.push(tr);
  }
  const Rt = rng(seed + 100000);
  const test_traj = Array.from({ length: n_test_traj }, () => genTraj(model, Rt, traj_len, { excitation }));
  return { X, Y, traj, test_traj, meta: { n_samples: X.length, seed, noise_m, excitation, Ts_s: TS, features: ['y', 'ydot', 'theta', 'u', 'u_prev'],
    targets: ['dy', 'dydot', 'dtheta'], model: 'ball_servo (plant.ASSUMED_SERVO)', provenance: 'simulated' } };
}

/**
 * 식별 학습 job (mlp.createTrainer 위에 정규화 추가). Progress = mlp Progress + kind 'nn-id'
 * result() → NNIdModel { format:'nn-id', version, net(JSON), x_norm, y_norm, features, Ts_s, meta, history }
 */
export function createIdTrainer(dataset, { hidden = [32, 32], activation = 'tanh', epochs = 150, batch_size = 64, lr = 3e-3, optimizer = 'adam',
  l2 = 0, val_frac = 0.2, seed = 1, keep_best = true } = {}) {
  const x_norm = fitNormalizer(dataset.X), y_norm = fitNormalizer(dataset.Y);
  const Xn = dataset.X.map((x) => normalize(x_norm, x)), Yn = dataset.Y.map((y) => normalize(y_norm, y));
  const net = createMLP({ sizes: [Xn[0].length, ...hidden, Yn[0].length], activation, out_activation: 'linear', seed });
  const tr = createTrainer(net, { X: Xn, Y: Yn }, { epochs, batch_size, lr, optimizer, l2, val_frac, seed, keep_best, kind: 'nn-id' });
  const job = {
    get done() { return tr.done; },
    history: tr.history,
    step(budget = 1) { return tr.step(budget); },
    cancel() { tr.cancel(); },
    result() {
      const r = tr.result();
      return { format: 'nn-id', version: 1, net: toJSON(r.net), x_norm, y_norm, features: dataset.meta.features, Ts_s: dataset.meta.Ts_s,
        meta: { provenance: 'simulated', hidden, activation, epochs, batch_size, lr, optimizer, l2, val_frac, seed, best_epoch: r.best_epoch, dataset: dataset.meta },
        history: r.history.map((h) => ({ iter: h.iter, train_loss: h.train_loss, val_loss: h.val_loss })) };
    },
  };
  return job;
}

const netCache = new WeakMap();
function netOf(m) { let n = netCache.get(m); if (!n) { n = fromJSON(m.net); netCache.set(m, n); } return n; }

/** 한 스텝 예측 x_{k+1} */
export function predictNext(nnModel, x, u, u_prev) {
  const d = denormalize(nnModel.y_norm, forward(netOf(nnModel), normalize(nnModel.x_norm, [x[0], x[1], x[2], u, u_prev])));
  return [x[0] + d[0], x[1] + d[1], x[2] + d[2]];
}

/** 물리 모델 이산화 → { servo: {Ad, Bd}, ball_only: {Ad, Bd} } */
export function physModels(Ts_s = TS) {
  const ms = makeModel({ servo_tf: { ...ASSUMED_SERVO } });
  const mb = makeModel({});
  const ss1 = stateSpace(ms), ss2 = stateSpace(mb);
  return { servo: c2d(ss1.A, ss1.B, Ts_s), ball_only: c2d(ss2.A, ss2.B, Ts_s) };
}

function linStep({ Ad, Bd }, x, u) {
  return Ad.map((row, i) => row.reduce((s, a, j) => s + a * x[j], 0) + Bd[i][0] * u);
}

/**
 * 다단계 예측 비교
 * @param src 궤적 배열 또는 dataset(test_traj 사용)
 * → { horizons, rmse_y_m: { nn, phys_servo, phys_ball }, example: { t_s, y_true, y_nn, y_phys_servo, y_phys_ball } }
 */
export function compareModels(nnModel, src, { horizons = [1, 5, 20, 50], start_stride = 10, example_len = 100 } = {}) {
  const trajs = Array.isArray(src) ? src : src.test_traj;
  const P = physModels(nnModel.Ts_s ?? TS);
  const H = Math.max(...horizons);
  const acc = { nn: horizons.map(() => [0, 0]), phys_servo: horizons.map(() => [0, 0]), phys_ball: horizons.map(() => [0, 0]) };
  for (const tr of trajs) {
    for (let s = 1; s + H < tr.u.length; s += start_stride) {
      let xn = tr.x[s].slice(), xs = tr.x[s].slice(), xb = [tr.x[s][0], tr.x[s][1]];
      for (let h = 1; h <= H; h++) {
        const k = s + h - 1;
        xn = predictNext(nnModel, xn, tr.u[k], tr.u[k - 1]);
        xs = linStep(P.servo, xs, tr.u[k]);
        xb = linStep(P.ball_only, xb, tr.u[k]);
        const hi = horizons.indexOf(h);
        if (hi >= 0) {
          const yt = tr.x[s + h][0];
          for (const [key, yp] of [['nn', xn[0]], ['phys_servo', xs[0]], ['phys_ball', xb[0]]]) { acc[key][hi][0] += (yp - yt) ** 2; acc[key][hi][1] += 1; }
        }
      }
    }
  }
  const rm = (a) => a.map(([s, n]) => (n ? Math.sqrt(s / n) : null));
  // 예시: 첫 궤적 처음부터 example_len 스텝 자유 실행
  const tr = trajs[0];
  const L = Math.min(example_len, tr.u.length - 1);
  let xn = tr.x[1].slice(), xs = tr.x[1].slice(), xb = [tr.x[1][0], tr.x[1][1]];
  const ex = { t_s: [], y_true: [], y_nn: [], y_phys_servo: [], y_phys_ball: [], u_rad: [] };
  for (let k = 1; k <= L; k++) {
    ex.t_s.push(tr.t_s[k]); ex.y_true.push(tr.x[k][0]); ex.y_nn.push(xn[0]); ex.y_phys_servo.push(xs[0]); ex.y_phys_ball.push(xb[0]); ex.u_rad.push(tr.u[k]);
    xn = predictNext(nnModel, xn, tr.u[k], tr.u[k - 1]);
    xs = linStep(P.servo, xs, tr.u[k]);
    xb = linStep(P.ball_only, xb, tr.u[k]);
  }
  return { horizons, rmse_y_m: { nn: rm(acc.nn), phys_servo: rm(acc.phys_servo), phys_ball: rm(acc.phys_ball) }, example: ex };
}
