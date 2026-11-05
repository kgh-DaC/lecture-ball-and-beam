// autotune.js — 릴레이 사이클 분석, 튜닝 규칙, 최적화 튜닝 (11장, controller-interface §6)
//
// ■ 릴레이 시험과 이중 적분기 (docs/theory/model-derivation.md §6)
//   릴레이 제어기(relay.js)는 안쪽 루프로 측정값 미분 되먹임 −kd_stab·ẏ 를 둔다. 그래서 릴레이가 보는 대상은
//   G'(s) = P(s)/(1 + kd_stab·s·P(s)) 이고, 여기서 찾은 Ku, Tu 는 G' 의 임계 이득·주기다.
//   튜닝 규칙으로 얻은 PID C'(s) 를 G' 에 붙이면 전체 제어기는 C'(s) + kd_stab·s (측정값 미분) 이므로
//   applyRule(..., { kd_stab }) 가 kd 에 kd_stab 을 더해 pid 파라미터로 돌려준다.
//
// ■ 기술함수
//   이상 릴레이(진폭 h):            N(a) = 4h/(π a)            → Ku = 4h/(π a)
//   히스테리시스 ε 릴레이:          Ku ≈ 4h/(π √(a² − ε²))     (opts.eps 를 주면 사용)
//   a 는 출력 진동의 반진폭(피크–피크/2), Tu 는 진동 주기.
import { simulate } from './simulate.js';

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

/**
 * 릴레이 실험 기록에서 극한 사이클 진폭·주기 추출.
 * @param rec { t_s: number[], y_m: number[], u_rad?: number[] }  (y_m 에 NaN 허용)
 * @param opts { h, eps = 0, discard = 2, min_cycles = 5, max_cv = 0.2 }
 *   discard: 처음 버릴 사이클 수(과도 구간). max_cv: 주기 변동계수 상한(넘으면 불규칙).
 * @returns { ok, a_m, Tu_s, Ku, cycles, reason, crossings_s, periods_s, amps_m, center_m }
 */
export function relayAnalyze(rec, opts = {}) {
  const h = opts.h;
  if (!(h > 0)) throw new Error('relayAnalyze: opts.h > 0 필요');
  const eps = opts.eps ?? 0;
  const discard = opts.discard ?? 2;
  const minCycles = opts.min_cycles ?? 5;
  const maxCv = opts.max_cv ?? 0.2;
  const t = [], y = [];
  for (let k = 0; k < rec.t_s.length; k++) if (Number.isFinite(rec.y_m[k]) && Number.isFinite(rec.t_s[k])) { t.push(rec.t_s[k]); y.push(rec.y_m[k]); }
  const fail = (reason, extra = {}) => ({ ok: false, a_m: null, Tu_s: null, Ku: null, cycles: 0, reason, ...extra });
  if (t.length < 20) return fail('too_short');
  // 중심: 뒤쪽 절반 평균(과도 구간 영향 줄이기)
  const center = mean(y.slice(Math.floor(y.length / 2)));
  // 상승 교차(중심 위로) — 선형 보간 시각. 잡음 떨림을 막기 위해 교차 후 다시 아래로 eps_h 이상 내려가야 다음 교차 인정
  const hy = Math.max(eps * 0.5, 1e-4);
  const ups = [];
  let armed = y[0] < center - hy;
  for (let k = 1; k < y.length; k++) {
    if (y[k] < center - hy) armed = true;
    if (armed && y[k - 1] < center && y[k] >= center) {
      const f = (center - y[k - 1]) / (y[k] - y[k - 1]);
      ups.push(t[k - 1] + f * (t[k] - t[k - 1]));
      armed = false;
    }
  }
  const nCyc = ups.length - 1;
  if (nCyc - discard < minCycles) return fail('too_few_cycles', { cycles: Math.max(0, nCyc - discard), crossings_s: ups, center_m: center });
  const use = ups.slice(discard);
  const periods = [], amps = [];
  for (let i = 0; i < use.length - 1; i++) {
    periods.push(use[i + 1] - use[i]);
    let mx = -Infinity, mn = Infinity;
    for (let k = 0; k < t.length; k++) if (t[k] >= use[i] && t[k] < use[i + 1]) { mx = Math.max(mx, y[k]); mn = Math.min(mn, y[k]); }
    amps.push((mx - mn) / 2);
  }
  const Tu = mean(periods), a = mean(amps);
  const cv = std(periods) / Tu;
  const res = { ok: true, a_m: a, Tu_s: Tu, Ku: null, cycles: periods.length, reason: null, crossings_s: ups, periods_s: periods, amps_m: amps, center_m: center, period_cv: cv };
  if (!(a > eps)) return { ...res, ok: false, reason: 'amplitude_below_eps' };
  res.Ku = eps > 0 ? (4 * h) / (Math.PI * Math.sqrt(a * a - eps * eps)) : (4 * h) / (Math.PI * a);
  if (cv > maxCv) return { ...res, ok: false, reason: 'irregular' };
  return res;
}

/** 튜닝 규칙 표 (11장 tuning-rules 위젯이 그대로 보여 준다). Ti, Td 는 Tu 배수 */
export const RULES = {
  zn: { label: 'Ziegler–Nichols PID', kp: 0.6, Ti: 0.5, Td: 0.125 },
  tl: { label: 'Tyreus–Luyben PID', kp: 1 / 2.2, Ti: 2.2, Td: 1 / 6.3 },
  no_overshoot: { label: 'ZN 오버슈트 없음', kp: 0.2, Ti: 0.5, Td: 1 / 3 },
};

/**
 * 규칙 → pid 파라미터 { kp, ki, kd }.  kp = c·Ku, ki = kp/Ti, kd = kp·Td (+ kd_stab)
 * @param opts { kd_stab = 0 } 릴레이 시험의 안쪽 미분 이득(위 설명)
 */
export function applyRule(rule, Ku, Tu_s, opts = {}) {
  const r = RULES[rule];
  if (!r) throw new Error(`applyRule: 알 수 없는 규칙 ${rule}`);
  if (!(Ku > 0 && Tu_s > 0)) throw new Error('applyRule: Ku, Tu_s > 0 필요');
  const kp = r.kp * Ku;
  const Ti = r.Ti * Tu_s, Td = r.Td * Tu_s;
  return { kp, ki: kp / Ti, kd: kp * Td + (opts.kd_stab ?? 0) };
}

/**
 * 시뮬레이션 비용 (SI, 스텝 시작 이후). 공이 빔 끝에 닿으면 큰 벌점.
 * cost: 'itae' Σ (t−t0)|e|dt, 'iae' Σ|e|dt, 'ise' Σ e²dt
 */
export function simCost(sim, cost = 'itae', t0 = 0) {
  let J = 0;
  for (let k = 1; k < sim.t_s.length; k++) {
    const t = sim.t_s[k];
    if (t < t0) continue;
    const dt = t - sim.t_s[k - 1];
    const e = sim.ref_m[k] - sim.y_m[k];
    J += cost === 'ise' ? e * e * dt : cost === 'iae' ? Math.abs(e) * dt : (t - t0) * Math.abs(e) * dt;
  }
  if (sim.end_hit) J += 1e3;
  return J;
}

/**
 * Nelder–Mead 최적화 튜닝 (pid).  모든 평가는 같은 simulate() 를 쓴다.
 * @param model plant.makeModel 결과
 * @param init { kp, ki, kd }
 * @param opts { cost='itae', profile=P1, max_iter=60, bounds={kp:[0,6],ki:[0,1],kd:[0,6]}, n_filt=10, sim_opts={noise:false}, u_penalty=0 }
 * @returns { best: {kp,ki,kd}, J, history: [{ iter, kp, ki, kd, J }], evals }
 */
export function optimize(model, init, opts = {}) {
  const cost = opts.cost ?? 'itae';
  const profile = opts.profile ?? { type: 'step', from_mm: 150, to_mm: 200, pre_s: 2, hold_s: 8 };
  const maxIter = opts.max_iter ?? 60;
  const bounds = { kp: [0, 6], ki: [0, 1], kd: [0, 6], ...(opts.bounds || {}) };
  const keys = ['kp', 'ki', 'kd'];
  const t0 = profile.type === 'step' ? profile.pre_s ?? 0 : 0;
  const clip = (x) => x.map((v, i) => Math.min(bounds[keys[i]][1], Math.max(bounds[keys[i]][0], v)));
  let evals = 0;
  const f = (x) => {
    evals++;
    const p = { kp: x[0], ki: x[1], kd: x[2], n_filt: opts.n_filt ?? 10, d_on: 'measurement' };
    const sim = simulate(model, { id: 'pid', params: p }, profile, { noise: false, ...(opts.sim_opts || {}) });
    let J = simCost(sim, cost, t0);
    if (opts.u_penalty) J += opts.u_penalty * sim.u_rad.reduce((s, u) => s + u * u, 0);
    return J;
  };
  // 초기 단순체: init 과 각 축 +20% (0 이면 범위의 5%)
  const x0 = clip(keys.map((k) => init[k] ?? 0));
  let simplex = [x0];
  for (let i = 0; i < 3; i++) {
    const x = x0.slice();
    const span = bounds[keys[i]][1] - bounds[keys[i]][0];
    x[i] = x[i] !== 0 ? x[i] * 1.2 : 0.05 * span;
    simplex.push(clip(x));
  }
  let fx = simplex.map(f);
  const history = [];
  for (let it = 0; it < maxIter; it++) {
    const ord = fx.map((v, i) => i).sort((a, b) => fx[a] - fx[b]);
    simplex = ord.map((i) => simplex[i]); fx = ord.map((i) => fx[i]);
    history.push({ iter: it, kp: simplex[0][0], ki: simplex[0][1], kd: simplex[0][2], J: fx[0] });
    const n = 3;
    const c = [0, 1, 2].map((j) => mean(simplex.slice(0, n).map((x) => x[j])));
    const xr = clip(c.map((v, j) => v + (v - simplex[n][j])));
    const fr = f(xr);
    if (fr < fx[0]) {
      const xe = clip(c.map((v, j) => v + 2 * (v - simplex[n][j])));
      const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; fx[n] = fe; } else { simplex[n] = xr; fx[n] = fr; }
    } else if (fr < fx[n - 1]) { simplex[n] = xr; fx[n] = fr; }
    else {
      const xc = clip(c.map((v, j) => v + 0.5 * (simplex[n][j] - v)));
      const fc = f(xc);
      if (fc < fx[n]) { simplex[n] = xc; fx[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { simplex[i] = clip(simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]))); fx[i] = f(simplex[i]); }
      }
    }
    // 수렴: 비용 상대 변화가 작으면 종료
    const spread = Math.max(...fx) - Math.min(...fx);
    if (spread < 1e-6 * Math.max(1e-9, Math.abs(fx[0]))) break;
  }
  const bi = fx.indexOf(Math.min(...fx));
  const b = simplex[bi];
  return { best: { kp: b[0], ki: b[1], kd: b[2] }, J: fx[bi], history, evals };
}
