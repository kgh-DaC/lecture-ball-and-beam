// lqr.js — 이산 LQR / LQI + 관측기 (13장)
//
// 상태(오차 좌표, x_e = x − x_ref, x_ref = [ref, 0, 0, …]):  e = y − ref  ← 주의: metrics의 e = ref − y 와 부호 반대
//   서보 없음: [e, ė]        1차 서보: [e, ė, θ]        2차 서보: [e, ė, θ, θ̇]
// 설계: 연속 모델 → ZOH 이산화(Ts = env.Ts_s, 고정 가정) → dlqr.  u_k = −K x̂_e,k  (− K_i z_k)
// LQI: z_{k+1} = z_k + Ts·e_k  (적분 상태 추가, 비용 q_i)
// 관측기 (현재 추정형):  x̂⁻ = Ad x̂ + Bd u_{k−1},  x̂ = x̂⁻ + Lc (y − C x̂⁻)
//   luenberger: 관측기 극점 z_obs = z_ctrl^obs_speed  (연속 극점을 obs_speed 배 빠르게)
//   kalman    : 정상상태 칼만 이득, R_n = (1 mm)², Q_n = obs_speed·diag(1e-8, 1e-5, 1e-5, …)
//   none      : ẏ = 필터된 후진 차분, θ = 포텐쇼미터(없으면 모델 예측)
// 측정값은 펌웨어 재귀 필터의 지연이 없는 aux.y_raw_m 을 우선 쓴다(모델에 없는 지연을 피하기 위해).
// θ_meas = true 이고 aux.theta_rad 가 유한하면 θ̂ 를 측정값으로 바꾼다(포텐쇼미터 개조의 이점).
//   이때 보정 이득은 [y, ẏ] 부분계로 따로 설계한 Lth 를 쓴다(lqrDesign 주석 참고). 상태가 [y, ẏ, θ] 인 모델만 해당.
// 지연(서보 Td, 샘플·통신)은 설계 모델에 없다 → 위상 여유 감소로 나타난다(docs/theory).
import { mergeParams, saturate, dtValid, FilteredDiff } from './common.js';
import { stateSpace } from '../plant.js';
import { c2d, dlqr, place } from '../analysis.js';
import { matmul, transpose, solve, eig, zeros as mzeros } from '../linalg.js';

/** 설계 결과 (위젯 qr-explorer 에서도 사용) */
export function lqrDesign(model, params, Ts_s) {
  const ss = stateSpace(model);
  const n = ss.A.length;
  const { Ad, Bd } = c2d(ss.A, ss.B, Ts_s);
  const qdiag = ss.states.map((s) => (s === 'y' ? params.q_e : s === 'ydot' ? params.q_edot : s === 'theta' ? params.q_theta : 1e-6));
  let Aa = Ad, Ba = Bd, Q;
  if (params.integral) {
    Aa = [...Ad.map((r) => [...r, 0]), [...ss.C[0].map((c) => c * Ts_s), 1]];
    Ba = [...Bd, [0]];
    Q = mzeros(n + 1, n + 1);
    qdiag.forEach((q, i) => { Q[i][i] = q; });
    Q[n][n] = params.q_i;
  } else {
    Q = mzeros(n, n);
    qdiag.forEach((q, i) => { Q[i][i] = q; });
  }
  const res = dlqr(Aa, Ba, Q, [[params.r]]);
  const K = res.K[0];
  const zc = res.poles;
  const sc = zc.map((z) => ({ re: Math.log(Math.hypot(z.re, z.im)) / Ts_s, im: Math.atan2(z.im, z.re) / Ts_s }));
  // 관측기 (플랜트 상태만)
  const Cm = ss.C;
  let Lc = null, obsPoles = null;
  if (params.observer === 'luenberger') {
    // 제어기 극점(플랜트 차수만큼, 빠른 순) → 지수 obs_speed
    const base = sc.slice().sort((a, b) => a.re - b.re).slice(0, n);
    obsPoles = base.map((s) => {
      const re = s.re * params.obs_speed, im = s.im * params.obs_speed;
      const m = Math.exp(re * Ts_s);
      return { re: m * Math.cos(im * Ts_s), im: m * Math.sin(im * Ts_s) };
    });
    // 켤레 짝 보정 (실수 계수 보장)
    obsPoles = fixConj(obsPoles);
    const CA = matmul(Cm, Ad);
    const Kt = place(transpose(Ad), transpose(CA), obsPoles);
    Lc = Kt[0];
  } else if (params.observer === 'kalman') {
    const Qn = mzeros(n, n);
    ss.states.forEach((s, i) => { Qn[i][i] = params.obs_speed * (s === 'y' ? 1e-8 : 1e-5); });
    const Rn = 1e-6;
    const P = dlqr(transpose(Ad), transpose(Cm), Qn, [[Rn]]).P; // 사전 공분산 (쌍대 리카티)
    const PCt = matmul(P, transpose(Cm));
    const S = matmul(Cm, PCt)[0][0] + Rn;
    Lc = PCt.map((r) => r[0] / S);
    // 추정 오차 동역학 (I − Lc C) Ad 의 극점
    const IL = Ad.map((_, i) => Ad.map((__, j) => (i === j ? 1 : 0) - Lc[i] * Cm[0][j]));
    obsPoles = eig(matmul(IL, Ad));
  }
  // θ 측정(포텐쇼미터) 모드용 축소 관측기 이득 — 상태가 [y, ẏ, θ]일 때만.
  // θ̂ 를 측정값으로 덮어쓰면 추정 오차 동역학이 [e_y, e_ẏ] 2차로 줄어든다. 3상태용 Lc 를 그대로 쓰면
  // 이 2차 오차 동역학이 불안정해질 수 있다(2026-11-03 발견: 가정 서보에서 고유값 ≈ 1.38).
  // 그래서 (A11, C1) 부분계에 대해 따로 설계한다: 예측은 Ad 전체(θ̂_{k−1} = 측정값)로 하고 보정은 y, ẏ 만.
  let Lth = null, obsPolesTh = null;
  if (params.observer !== 'none' && n === 3 && ss.states[2] === 'theta') {
    const Ar = [[Ad[0][0], Ad[0][1]], [Ad[1][0], Ad[1][1]]];
    const Cr = [[1, 0]];
    if (params.observer === 'luenberger') {
      const slow = sc.slice().sort((a, b) => b.re - a.re).slice(0, 2); // 지배 극점 2개
      obsPolesTh = fixConj(slow.map((s) => {
        const m = Math.exp(s.re * params.obs_speed * Ts_s);
        return { re: m * Math.cos(s.im * params.obs_speed * Ts_s), im: m * Math.sin(s.im * params.obs_speed * Ts_s) };
      }));
      const Kt = place(transpose(Ar), transpose(matmul(Cr, Ar)), obsPolesTh);
      Lth = [Kt[0][0], Kt[0][1], 0];
    } else {
      const Qn = [[params.obs_speed * 1e-8, 0], [0, params.obs_speed * 1e-5]];
      const Rn = 1e-6;
      const P = dlqr(transpose(Ar), transpose(Cr), Qn, [[Rn]]).P;
      const S = P[0][0] + Rn;
      Lth = [P[0][0] / S, P[1][0] / S, 0];
    }
    const IL = Ar.map((_, i) => Ar.map((__, j) => (i === j ? 1 : 0) - Lth[i] * Cr[0][j]));
    obsPolesTh = eig(matmul(IL, Ar));
  }
  return { ss, Ad, Bd, K, poles_z: zc, poles_s: sc, Lc, obs_poles_z: obsPoles, Lth, obs_poles_th_z: obsPolesTh, n, iterations: res.iterations };
}

function fixConj(ps) {
  // 복소 극점이 짝 없이 남으면 실수로 만든다
  const out = [];
  const used = new Array(ps.length).fill(false);
  for (let i = 0; i < ps.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    if (Math.abs(ps[i].im) < 1e-12) { out.push({ re: ps[i].re, im: 0 }); continue; }
    const j = ps.findIndex((q, k) => !used[k] && Math.abs(q.re - ps[i].re) < 1e-9 && Math.abs(q.im + ps[i].im) < 1e-9);
    if (j >= 0) { used[j] = true; out.push(ps[i], ps[j]); } else out.push({ re: Math.hypot(ps[i].re, ps[i].im), im: 0 });
  }
  return out;
}

export default class Lqr {
  static meta = {
    id: 'lqr',
    label: 'LQR / LQI',
    family: 'modern',
    linear: false,
    params: [
      { key: 'q_e', label: 'Q_e', unit: '1/m²', type: 'number', min: 1, max: 1e5, step: 1, default: 400,
        help: '위치 오차 가중. 브라이슨 규칙: 허용 5 cm → 1/0.05² = 400' },
      { key: 'q_edot', label: 'Q_ė', unit: 's²/m²', type: 'number', min: 0, max: 1e4, step: 1, default: 25,
        help: '속도 가중. 허용 20 cm/s → 25' },
      { key: 'q_theta', label: 'Q_θ', unit: '1/rad²', type: 'number', min: 0, max: 1e4, step: 1, default: 33,
        help: '서보각 가중(서보 포함 모델에서만). 허용 10° → 33' },
      { key: 'r', label: 'R', unit: '1/rad²', type: 'number', min: 0.01, max: 1000, step: 0.01, default: 3.65,
        help: '입력 가중. 허용 30° → 1/0.5236² = 3.65. 키우면 입력이 작아지고 응답이 느려진다' },
      { key: 'integral', label: '적분 상태(LQI)', unit: '–', type: 'bool', default: false,
        help: '∫e dt 를 상태에 추가해 정상상태 오차(빔 수평 오차 등)를 없앤다' },
      { key: 'q_i', label: 'Q_i', unit: '1/(m²·s²)', type: 'number', min: 0, max: 1e5, step: 1, default: 50,
        help: '적분 상태 가중' },
      { key: 'observer', label: '관측기', unit: '–', type: 'enum', default: 'luenberger',
        options: [{ value: 'none', label: '없음(차분)' }, { value: 'luenberger', label: 'Luenberger' }, { value: 'kalman', label: '칼만 필터' }],
        help: '초음파는 위치만 잰다. 속도는 추정해야 한다' },
      { key: 'obs_speed', label: '관측기 속도 배수', unit: '–', type: 'number', min: 1, max: 10, step: 0.5, default: 3,
        help: 'Luenberger: 제어기 극점보다 몇 배 빠르게. 칼만: 프로세스 잡음 배율' },
      { key: 'theta_meas', label: 'θ 측정 사용', unit: '–', type: 'bool', default: true,
        help: '포텐쇼미터 서보각을 상태로 바로 쓴다. 캘리브레이션이 없으면 자동으로 관측기 추정' },
    ],
    debug_keys: ['x_hat_y', 'x_hat_ydot', 'x_hat_theta', 'i', 'saturated'],
    needs_model: true,
  };

  constructor(params = {}, env = {}) {
    if (!env.model) throw new Error('lqr: env.model 필요');
    this.env = { u_lim_rad: 0.5236, Ts_s: 0.06, ...env };
    this.params = mergeParams(Lqr.meta.params, params);
    this.design();
    this.diff = new FilteredDiff(0.1);
    this.reset();
  }
  design() { this.d = lqrDesign(this.env.model, this.params, this.env.Ts_s); }
  setParams(partial) {
    const old = this.params;
    this.params = mergeParams(Lqr.meta.params, partial, this.params);
    this.design();
    if (old.integral !== this.params.integral) this.z = 0;
  }
  reset(state0 = {}) {
    this.design();
    const n = this.d.n;
    this.xh = new Array(n).fill(0);
    if (Number.isFinite(state0.y_m)) this.xh[0] = state0.y_m;
    if (n > 2 && Number.isFinite(state0.theta_rad)) this.xh[2] = state0.theta_rad;
    this.z = 0;
    this.u = Number.isFinite(state0.u_rad) ? state0.u_rad : 0;
    this.started = Number.isFinite(state0.y_m);
    this.diff.reset(Number.isFinite(state0.y_m) ? state0.y_m : NaN);
    this._dbg = { x_hat_y: this.xh[0], x_hat_ydot: 0, x_hat_theta: n > 2 ? this.xh[2] : NaN, i: 0, saturated: false, lost: false, theta_source: 'none' };
  }

  update(ref_m, y_m, dt_s, aux = {}) {
    const lim = this.env.u_lim_rad;
    const { Ad, Bd, K, n, ss } = this.d;
    const p = this.params;
    if (!dtValid(dt_s)) return this.u;
    const yv = Number.isFinite(aux.y_raw_m) ? aux.y_raw_m : y_m;
    const lost = !Number.isFinite(yv);
    // θ 측정은 상태 [y, ẏ, θ] 모델에서만 쓴다(2차 서보·ARX 는 θ̇ 등 다른 상태가 있어 관측기 추정으로 대체)
    const thMeas = p.theta_meas && Number.isFinite(aux.theta_rad) && n === 3 && ss.states[2] === 'theta';
    const Lc = thMeas && this.d.Lth ? this.d.Lth : this.d.Lc;
    // 예측
    const xp = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { let s = Bd[i][0] * this.u; for (let j = 0; j < n; j++) s += Ad[i][j] * this.xh[j]; xp[i] = s; }
    if (!this.started && !lost) { xp.fill(0); xp[0] = yv; this.started = true; }
    let xh = xp;
    if (p.observer === 'none') {
      if (!lost) {
        xh[0] = yv;
        xh[1] = this.diff.update(yv, dt_s);
      }
    } else if (!lost) {
      const innov = yv - ss.C[0].reduce((s, c, j) => s + c * xp[j], 0);
      xh = xp.map((x, i) => x + Lc[i] * innov);
    }
    if (thMeas) xh[2] = aux.theta_rad;
    this.xh = xh;
    // 오차 좌표
    const xe = xh.slice(); xe[0] = xh[0] - ref_m;
    let u = 0;
    for (let i = 0; i < n; i++) u -= K[i] * xe[i];
    let zn = this.z;
    if (p.integral && !lost) zn = this.z + dt_s * xe[0];
    if (p.integral) u -= K[n] * zn;
    const r = saturate(u, lim);
    // 적분 와인드업 방지: 포화 중이고 적분이 포화를 키우면 적분 갱신 안 함
    if (p.integral && !lost) {
      const uNoInt = u + K[n] * zn - K[n] * this.z;
      if (!(r.saturated && Math.abs(u) > Math.abs(uNoInt))) this.z = zn;
    }
    this.u = r.u;
    this._dbg = { x_hat_y: xh[0], x_hat_ydot: xh[1], x_hat_theta: n > 2 ? xh[2] : NaN, i: this.z, saturated: r.saturated, lost,
      theta_source: n > 2 ? (thMeas ? 'pot' : 'observer') : 'none' };
    return r.u;
  }
  get debug() { return { ...this._dbg }; }

  static design(model, specs = {}) {
    // 브라이슨 규칙: 허용 최대값의 제곱 역수
    const e = specs.e_max_m ?? 0.05, ed = specs.edot_max_m_s ?? 0.2, th = specs.theta_max_rad ?? (10 * Math.PI) / 180, u = specs.u_max_rad ?? (30 * Math.PI) / 180;
    return { q_e: 1 / e ** 2, q_edot: 1 / ed ** 2, q_theta: 1 / th ** 2, r: 1 / u ** 2, integral: false, q_i: 50, observer: 'luenberger', obs_speed: 3, theta_meas: true };
  }
}
