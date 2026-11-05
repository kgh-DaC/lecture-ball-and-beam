// imitation.js — 모방 학습: 행동복제(BC)와 DAgger (ai-extension §2.8, 19장)
//
// 전문가 = 등록된 제어기(pid 또는 lqr). 학생 = nn-policy 와 같은 구조 u = u_lim·tanh(MLP(normObs(o))).
// 학습 목표: 신경망 출력(tanh 이전)이 atanh(u_expert/u_lim) 를 맞추게 하는 회귀(MSE).
//
// 전문가 질의: 전문가 제어기를 매 스텝 "그림자"로 실행한다 — 같은 측정(y_filt, y_raw, θ)을 받고 출력은 기록만.
//   실제로 적용된 u 를 전문가의 직전 출력으로 덮어써(expert.u = u) 관측기 계열(LQR)도 실제 입력으로 예측하게 한다.
//
// BC     : 라운드마다 전문가 시연 에피소드를 rollouts_per_round 개씩 더 모아(시연 분포: demo_env) 다시 학습.
// DAgger : 1라운드 = BC 와 같은 시연. 이후 라운드는 학생(β 확률로 전문가) 정책으로 "평가 분포" 환경을 굴리고,
//          학생이 방문한 상태에 전문가 라벨을 붙여 데이터에 합친다(Ross 2011). 라운드별 데이터 양은 BC 와 같다.
// 분포 이동 시연: 시연은 설정값 근처에서 시작하는 쉬운 상황(demo_env)에서만 모으고, 평가는 넓은 시작 범위에서 한다.
import { rng } from '../linalg.js';
import { getController } from '../registry.js';
import { createMLP, createTrainer, toJSON, cloneNet, fromJSON, forward } from './mlp.js';
import { normObs, OBS_SPEC } from './obs.js';
import { BallBeamEnv, rollout, trajRmse } from './train_env.js';
import { nnPolicyJSON, policyFromJSON } from './policy.js';
import { summarizeEnv } from './qlearn.js';

export const EXPERTS = Object.freeze({
  pd: { id: 'pid', params: { kp: 0.5, ki: 0, kd: 1.25, n_filt: 8, d_on: 'measurement' }, label: 'PD (0.5, 1.25)' },
  lqr: { id: 'lqr', params: {}, label: 'LQR (기본값)' },
});

const ATANH_CLIP = 0.995;
const atanh = (x) => 0.5 * Math.log((1 + x) / (1 - x));

/** 전문가 그림자 실행기 */
export class ExpertShadow {
  constructor(expert, env) {
    const ex = typeof expert === 'string' ? EXPERTS[expert] : expert;
    if (!ex) throw new Error(`알 수 없는 전문가: ${expert}`);
    this.ex = ex;
    this.env = env;
  }
  reset() {
    const C = getController(this.ex.id);
    const e = this.env;
    this.c = new C(this.ex.params, { model: e.baseModel, Ts_s: e.opts.Ts_s, u_lim_rad: e.u_lim_rad, mode: 'sim' });
    this.c.reset({ t_s: 0, ref_m: e.refAt(e.t), y_m: e.yMeas, u_rad: 0, theta_rad: e.st.theta_rad });
  }
  /** 현재 env 측정으로 전문가 출력 */
  query() {
    const e = this.env;
    return this.c.update(e.refAt(e.t), e.yMeas, e.opts.Ts_s, { theta_rad: e.st.theta_rad, y_raw_m: e.yRaw });
  }
  applied(u) { if (this.c && 'u' in this.c) this.c.u = u; }
}

/**
 * 한 에피소드: 매 스텝 전문가 라벨을 얻고, actFn(obs, u_exp) 이 정한 u 를 적용한다.
 * @returns {{ X, Y, ro: { return, end_hit, y_m, ref_m }, states: [e, v][] }}
 */
function labeledEpisode(env, shadow, actFn, seed) {
  let obs = env.reset(seed);
  shadow.reset();
  const X = [], Y = [], ys = [], rs = [], states = [];
  let ret = 0, end = false, done = false;
  while (!done) {
    const uExp = shadow.query();
    const u = actFn(obs, uExp);
    X.push(normObs(obs)); Y.push([atanh(Math.max(-ATANH_CLIP, Math.min(ATANH_CLIP, uExp / env.u_lim_rad)))]);
    states.push([obs[0], obs[1]]);
    const r = env.step(u);
    shadow.applied(env.u);
    ret += r.reward; obs = r.obs; done = r.done;
    if (r.info.end_hit) end = true;
    ys.push(r.info.y_m); rs.push(r.info.ref_m);
  }
  return { X, Y, states, ro: { return: ret, end_hit: end, y_m: ys, ref_m: rs } };
}

/** 전문가 시연 수집 → { X(정규화 관측), Y(atanh(u/u_lim)), U(rad), episodes } */
export function collectDemos({ expert = 'pd', episodes = 10, env: envOpts = {}, seed = 1, y0_range_m = null } = {}) {
  const env = new BallBeamEnv({ ...envOpts, ...(y0_range_m ? { y0_range_m } : {}) });
  const sh = new ExpertShadow(expert, env);
  const X = [], Y = [], eps = [];
  for (let i = 0; i < episodes; i++) {
    const d = labeledEpisode(env, sh, (o, ue) => ue, seed * 1009 + i);
    X.push(...d.X); Y.push(...d.Y); eps.push(d.ro);
  }
  return { X, Y, U: Y.map((y) => [env.u_lim_rad * Math.tanh(y[0])]), episodes: eps };
}

/** 정책 평가 → { mean_return, rmse_m, fail_rate, rollouts } */
export function evaluatePolicy(policy, { env: envOpts = {}, episodes = 8, seed = 1000, record = false } = {}) {
  const act = typeof policy === 'function' ? policy : policy.act;
  const env = new BallBeamEnv(envOpts);
  const ros = [];
  let R = 0, F = 0, rm = 0;
  for (let i = 0; i < episodes; i++) {
    const ro = rollout(env, (o) => act(o), { seed: seed + i, record: true });
    R += ro.return; F += ro.end_hit ? 1 : 0; rm += trajRmse(ro);
    if (record) ros.push(ro);
  }
  return { mean_return: R / episodes, rmse_m: rm / episodes, fail_rate: F / episodes, rollouts: ros };
}

/** 전문가 자체 성능(같은 평가 환경) */
export function evaluateExpert(expert, { env: envOpts = {}, episodes = 8, seed = 1000 } = {}) {
  const env = new BallBeamEnv(envOpts);
  const sh = new ExpertShadow(expert, env);
  let R = 0, F = 0, rm = 0;
  for (let i = 0; i < episodes; i++) {
    const d = labeledEpisode(env, sh, (o, ue) => ue, seed + i);
    R += d.ro.return; F += d.ro.end_hit ? 1 : 0; rm += trajRmse(d.ro);
  }
  return { mean_return: R / episodes, rmse_m: rm / episodes, fail_rate: F / episodes };
}

/** 분포 이동 산점도 데이터: 전문가와 학생이 방문한 (e, v) */
export function distributionShift(policy, expert = 'pd', { env: envOpts = {}, seed = 1000, episodes = 3, demo_env = { y0_rel_range_m: [-0.015, 0.015], ref_switch_prob: 0 } } = {}) {
  const act = typeof policy === 'function' ? policy : policy.act;
  const envE = new BallBeamEnv({ ...envOpts, ...(demo_env || {}) });
  const envP = new BallBeamEnv(envOpts);
  const shE = new ExpertShadow(expert, envE), shP = new ExpertShadow(expert, envP);
  const states_expert = [], states_policy = [], disagreement = [];
  for (let i = 0; i < episodes; i++) {
    states_expert.push(...labeledEpisode(envE, shE, (o, ue) => ue, seed + i).states);
    const d = labeledEpisode(envP, shP, (o, ue) => { const u = act(o); disagreement.push(Math.abs(u - ue)); return u; }, seed + i);
    states_policy.push(...d.states);
  }
  return { states_expert, states_policy, mean_abs_disagreement_rad: disagreement.reduce((s, x) => s + x, 0) / Math.max(1, disagreement.length) };
}

/**
 * BC / DAgger job. budget = 라운드 수(기본 1)
 * Progress { kind:'imitation', iter, total, method, dataset_size, train_loss, val_loss, eval_return, eval_rmse_m, eval_fail_rate, expert_return, done }
 */
export function createImitation({ expert = 'pd', method = 'bc', demo_episodes = 6, demo_env = { y0_rel_range_m: [-0.015, 0.015], ref_switch_prob: 0 }, rounds = 6,
  rollouts_per_round = 4, beta0 = 0.5, hidden = [16, 16], activation = 'tanh', epochs_per_round = 60, batch_size = 64, lr = 3e-3,
  env: envOpts = {}, eval_episodes = 8, seed = 1 } = {}) {
  if (method !== 'bc' && method !== 'dagger') throw new Error('createImitation: method 는 bc|dagger');
  const demoEnv = new BallBeamEnv({ ...envOpts, ...demo_env });
  const runEnv = new BallBeamEnv(envOpts);
  const shDemo = new ExpertShadow(expert, demoEnv), shRun = new ExpertShadow(expert, runEnv);
  const net = createMLP({ sizes: [OBS_SPEC.names.length, ...hidden, 1], activation, out_activation: 'linear', seed });
  const lim = runEnv.u_lim_rad;
  const R = rng(seed + 3);
  const X = [], Y = [];
  const history = [];
  let round = 0, demoCount = 0;
  const expertEval = evaluateExpert(expert, { env: envOpts, episodes: eval_episodes });
  const studentAct = (n) => (o) => lim * Math.tanh(forward(n, normObs(o))[0]);
  const job = {
    done: false, history,
    step(budget = 1) {
      for (let b = 0; b < budget && !job.done; b++) {
        // 데이터 모으기
        if (round === 0) {
          for (let i = 0; i < demo_episodes; i++) { const d = labeledEpisode(demoEnv, shDemo, (o, ue) => ue, seed * 1009 + demoCount++); X.push(...d.X); Y.push(...d.Y); }
        } else if (method === 'bc') {
          for (let i = 0; i < rollouts_per_round; i++) { const d = labeledEpisode(demoEnv, shDemo, (o, ue) => ue, seed * 1009 + demoCount++); X.push(...d.X); Y.push(...d.Y); }
        } else {
          const beta = round === 1 ? beta0 : 0;
          const act = studentAct(net);
          for (let i = 0; i < rollouts_per_round; i++) {
            const d = labeledEpisode(runEnv, shRun, (o, ue) => (R.uniform() < beta ? ue : act(o)), seed * 7919 + round * 101 + i);
            X.push(...d.X); Y.push(...d.Y);
          }
        }
        // 학습 (따뜻한 시작)
        const tr = createTrainer(net, { X, Y }, { epochs: epochs_per_round, batch_size, lr, optimizer: 'adam', val_frac: 0.15, seed: seed + round, keep_best: true });
        while (!tr.done) tr.step(10);
        const res = tr.result();
        copyInto(net, res.net);
        const last = res.history[res.history.length - 1];
        round += 1;
        const ev = evaluatePolicy(studentAct(net), { env: envOpts, episodes: eval_episodes });
        history.push({ kind: 'imitation', iter: round, total: rounds, method, dataset_size: X.length, train_loss: last.train_loss, val_loss: res.history[res.best_epoch - 1]?.val_loss ?? last.val_loss,
          eval_return: ev.mean_return, eval_rmse_m: ev.rmse_m, eval_fail_rate: ev.fail_rate, expert_return: expertEval.mean_return, done: round >= rounds });
        if (round >= rounds) job.done = true;
      }
      return history[history.length - 1] || { kind: 'imitation', iter: 0, total: rounds, method, done: job.done };
    },
    cancel() { job.done = true; },
    result() {
      return nnPolicyJSON(toJSON(cloneNet(net)), { u_lim_rad: lim, meta: { algo: method, expert: typeof expert === 'string' ? expert : expert.id, seed, rounds: round,
        demo_episodes, rollouts_per_round, demo_env, beta0, dataset_size: X.length, expert_return: expertEval.mean_return, env: summarizeEnv(runEnv.opts) } });
    },
  };
  return job;
}

function copyInto(dst, src) {
  for (let l = 0; l < dst.W.length; l++) { dst.W[l] = src.W[l].slice(); dst.b[l] = src.b[l].slice(); }
}

export { policyFromJSON, fromJSON };
