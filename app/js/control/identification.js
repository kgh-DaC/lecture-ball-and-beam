// identification.js — 서보 시스템 식별과 전체 전달함수 합성 (07·08장, controller-interface §7)
//
// 캘리브레이션 함수(calibrate, potToCdeg, presetCalibration)만 하드웨어 단위(LSB, cdeg)를 쓰고 나머지는 SI.
// data = { t_s: [], u_rad: [], y_rad: [] }  — u = 서보 명령각, y = 포텐쇼미터 측정각(명령 좌표, 수평 0).
//
// 모델 (docs/theory/model-derivation.md §4)
//   fo      : G(s) = K e^{−Td s}/(τ s + 1)
//   so      : G(s) = K ωn² e^{−Td s}/(s² + 2ζωn s + ωn²)
//   fo_slew : τ θ̇ = K u(t−Td) − θ,  |θ̇| ≤ vmax       (속도 한계 — 큰 스텝에서 서보가 일정 속도로 도는 현상)
//   arx     : A(q) y = q^{−nk} B(q) u + e  → 영차 유지(ZOH) 역변환으로 연속 TF
// 적합: 시뮬레이션 오차 제곱합 최소화(Nelder–Mead). 입력은 영차 유지, 지연은 정확한 시각에서 구간을 나눠 적분한다.
// 편차 좌표: 기록 시작 직전에 서보가 u0(기본 u[0])에서 정지해 있었다고 보고 y − y[0], u − u0 로 맞춘다
//   (캘리브레이션 오프셋이 결과에 섞이지 않게). PRBS·처프는 기록 직전 명령이 u[0]가 아니므로 opts.u0 를 준다.
import { SERVO_PRESETS } from '../config/servo-presets.js';
import { makeModel, plantTF, tf2ssCanon } from './plant.js';
import { roots, polyFromRoots, solve } from './linalg.js';
import { c2d } from './analysis.js';

// ------------------------------------------------------------------ 캘리브레이션
/**
 * 포텐쇼미터 캘리브레이션: cmd_cdeg ≈ c·raw² + a·raw + b (최소제곱)
 * @param points [{ cmd_cdeg, pot_raw_mean, pot_raw_std, n }]
 * @returns { fit: { order, a_cdeg_per_lsb, b_cdeg, c }, residual_max_cdeg, residuals_cdeg, warn }
 *   warn: 'flat'(raw 변화 < 20 LSB — 와이퍼 미연결·전원 문제), 'nonlinear'(잔차 > 100 cdeg), null
 */
export function calibrate(points, opts = {}) {
  const order = opts.order ?? 1;
  if (!Array.isArray(points) || points.length < order + 1) throw new Error(`calibrate: 점이 ${order + 1}개 이상 필요`);
  const raw = points.map((p) => Number(p.pot_raw_mean));
  const cmd = points.map((p) => Number(p.cmd_cdeg));
  const span = Math.max(...raw) - Math.min(...raw);
  if (span < 20) {
    return { fit: { order, a_cdeg_per_lsb: 0, b_cdeg: cmd.reduce((s, x) => s + x, 0) / cmd.length, c: 0 }, residual_max_cdeg: null, residuals_cdeg: [], warn: 'flat' };
  }
  const rows = raw.map((r) => (order === 2 ? [r * r, r, 1] : [r, 1]));
  const coef = lstsq(rows, cmd);
  const fit = order === 2 ? { order, a_cdeg_per_lsb: coef[1], b_cdeg: coef[2], c: coef[0] } : { order, a_cdeg_per_lsb: coef[0], b_cdeg: coef[1], c: 0 };
  const residuals = raw.map((r, i) => cmd[i] - potToCdeg(r, fit));
  const rmax = Math.max(...residuals.map(Math.abs));
  return { fit, residual_max_cdeg: rmax, residuals_cdeg: residuals, warn: rmax > 100 ? 'nonlinear' : null };
}

/** raw(LSB) → 명령 좌표 각(cdeg) */
export function potToCdeg(raw, fit) {
  if (!fit || !Number.isFinite(raw)) return NaN;
  return (fit.c || 0) * raw * raw + fit.a_cdeg_per_lsb * raw + fit.b_cdeg;
}

/** 서보 프리셋의 임시 캘리브레이션(architecture §4). 없으면 null(SG90) */
export function presetCalibration(servo_model) {
  const p = SERVO_PRESETS[servo_model];
  if (!p || !p.pot_preset) return null;
  const { order, a_cdeg_per_lsb, b_cdeg, c } = p.pot_preset;
  return { order, a_cdeg_per_lsb, b_cdeg, c };
}

// ------------------------------------------------------------------ 시험 신호 (펌웨어 ID 모드와 같은 식, protocol.md)
/**
 * 시험 신호 생성 (가상 장치·번들 샘플·식별 실습 미리보기용). 반환 { t_s, u_rad, u0_rad }
 *   step : { from_rad, to_rad, hold_s }        100 ms from 유지 후 to
 *   prbs : { amp_rad, bit_s, n_bits }           9비트 LFSR x⁹+x⁵+1, seed 0x1FF (펌웨어와 같은 비트열)
 *   chirp: { amp_rad, f0_hz, f1_hz, dur_s }     선형 처프
 *   u0_rad: 기록 직전 명령(step = from, prbs·chirp = 0 으로 가정)
 */
export function idSignal(kind, a, Ts_s = 0.005) {
  const t = [], u = [];
  if (kind === 'step') {
    const T = 0.1 + a.hold_s;
    const N = Math.round(T / Ts_s);
    for (let k = 0; k < N; k++) { t.push(k * Ts_s); u.push(k * Ts_s < 0.1 - 1e-9 ? a.from_rad : a.to_rad); }
    return { t_s: t, u_rad: u, u0_rad: a.from_rad };
  }
  if (kind === 'prbs') {
    let lfsr = 0x1ff, idx = 0;
    const next = () => { const out = lfsr & 1; const fb = (lfsr ^ (lfsr >> 4)) & 1; lfsr = (lfsr >> 1) | (fb << 8); return out; };
    let bit = next();
    const N = Math.round((a.n_bits * a.bit_s) / Ts_s);
    for (let k = 0; k < N; k++) {
      const tk = k * Ts_s;
      const b = Math.floor(tk / a.bit_s + 1e-9);
      while (idx < b) { bit = next(); idx++; }
      t.push(tk); u.push(bit ? a.amp_rad : -a.amp_rad);
    }
    return { t_s: t, u_rad: u, u0_rad: 0 };
  }
  if (kind === 'chirp') {
    const N = Math.round(a.dur_s / Ts_s);
    for (let k = 0; k < N; k++) {
      const tk = k * Ts_s;
      const ph = a.f0_hz * tk + ((a.f1_hz - a.f0_hz) * tk * tk) / (2 * a.dur_s);
      t.push(tk); u.push(a.amp_rad * Math.sin(2 * Math.PI * ph));
    }
    return { t_s: t, u_rad: u, u0_rad: 0 };
  }
  throw new Error(`idSignal: 알 수 없는 kind ${kind}`);
}

// ------------------------------------------------------------------ 서보 응답 시뮬레이션
/**
 * 서보 모델 응답. 입력은 영차 유지(u[k] 가 [t_k, t_{k+1}) 동안), 지연 Td 는 정확한 시각에서 처리.
 * @param servo { type, K, tau_s, Td_s, wn_rad_s, zeta, vmax_rad_s, cont }
 * @param opts { u0 = u[0] (t<0 명령, 그때 정지 상태), y0 = K·u0 (t=0 각도) }
 * @returns y_rad[] (각 t_k 에서의 θ)
 */
export function simulateServo(servo, t_s, u_rad, opts = {}) {
  const N = t_s.length;
  const type = servo.type;
  const K = servo.K ?? 1;
  const Td = type === 'arx' ? servo.cont.delay_s || 0 : servo.Td_s || 0;
  const u0 = opts.u0 ?? u_rad[0];
  const y = new Array(N);
  // 상태
  let th = opts.y0 ?? (type === 'arx' ? dcGain(servo.cont) * u0 : K * u0);
  let thd = 0;
  let canon = null, xs = null;
  if (type === 'arx') {
    canon = tf2ssCanon(servo.cont.num, servo.cont.den);
    const n = canon.A.length;
    xs = new Array(n).fill(0);
    // 정지 상태: x_n = u0 / a_n (plant.tf2ssCanon 정준형), 출력 오프셋은 y0 − dc·u0 로 보정
    const a = servo.cont.den.map((c) => c / servo.cont.den[0]);
    if (n > 0 && a[n] !== 0) xs[n - 1] = u0 / a[n];
  }
  const arxOut = (x, ud) => { let s = canon.D[0][0] * ud; for (let i = 0; i < x.length; i++) s += canon.C[0][i] * x[i]; return s; };
  const arxOff = type === 'arx' ? (opts.y0 ?? dcGain(servo.cont) * u0) - dcGain(servo.cont) * u0 : 0;
  // 지연된 입력: 시각 τ 에서 유효한 명령 = u[j], j = 마지막 t_j ≤ τ − Td (없으면 u0)
  const uAt = (j) => (j < 0 ? u0 : u_rad[j]);
  let jd = -1; // 현재 지연 입력 인덱스
  const segStep = (ud, h) => {
    if (h <= 0) return;
    if (type === 'ideal') { th = K * ud; return; }
    if (type === 'fo') { th = K * ud + (th - K * ud) * Math.exp(-h / servo.tau_s); return; }
    if (type === 'fo_slew') {
      const tau = servo.tau_s, vmax = servo.vmax_rad_s > 0 ? servo.vmax_rad_s : Infinity;
      let d = K * ud - th, rem = h;
      if (Math.abs(d) > vmax * tau) {
        const tb = (Math.abs(d) - vmax * tau) / vmax;
        const step = Math.min(tb, rem);
        th += Math.sign(d) * vmax * step; rem -= step;
      }
      if (rem > 0) { d = K * ud - th; th = K * ud - d * Math.exp(-rem / tau); }
      return;
    }
    // so, arx: RK4 (h ≤ 1 ms)
    const nst = Math.max(1, Math.ceil(h / 0.001 - 1e-9));
    const hh = h / nst;
    if (type === 'so') {
      const w = servo.wn_rad_s, z = servo.zeta;
      const f = (a, b) => [b, w * w * (K * ud - a) - 2 * z * w * b];
      for (let i = 0; i < nst; i++) {
        const k1 = f(th, thd), k2 = f(th + 0.5 * hh * k1[0], thd + 0.5 * hh * k1[1]);
        const k3 = f(th + 0.5 * hh * k2[0], thd + 0.5 * hh * k2[1]), k4 = f(th + hh * k3[0], thd + hh * k3[1]);
        th += (hh / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
        thd += (hh / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      }
      return;
    }
    if (type === 'arx') {
      const A = canon.A, B = canon.B;
      const f = (x) => A.map((r, i) => r.reduce((s, c, j) => s + c * x[j], 0) + B[i][0] * ud);
      for (let i = 0; i < nst; i++) {
        const k1 = f(xs), k2 = f(xs.map((v, q) => v + 0.5 * hh * k1[q]));
        const k3 = f(xs.map((v, q) => v + 0.5 * hh * k2[q])), k4 = f(xs.map((v, q) => v + hh * k3[q]));
        xs = xs.map((v, q) => v + (hh / 6) * (k1[q] + 2 * k2[q] + 2 * k3[q] + k4[q]));
      }
      th = arxOut(xs, ud) + arxOff;
      return;
    }
    throw new Error(`simulateServo: 알 수 없는 type ${type}`);
  };
  if (type === 'arx') th = arxOut(xs, u0) + arxOff;
  for (let k = 0; k < N; k++) {
    y[k] = th;
    if (k === N - 1) break;
    const ta = t_s[k], tb = t_s[k + 1];
    let tc = ta;
    // 구간 [ta, tb) 안에서 지연 입력이 바뀌는 시각들
    while (true) {
      // jd 를 tc 시점에 맞춤
      while (jd + 1 < N && t_s[jd + 1] + Td <= tc + 1e-12) jd++;
      const tNext = jd + 1 < N ? t_s[jd + 1] + Td : Infinity;
      const tEnd = Math.min(tb, tNext);
      segStep(uAt(jd), tEnd - tc);
      tc = tEnd;
      if (tc >= tb - 1e-12) break;
    }
  }
  return y;
}

function dcGain(cont) {
  const n = cont.num[cont.num.length - 1], d = cont.den[cont.den.length - 1];
  return d === 0 ? Infinity : n / d;
}

/** 적합도 % = 100·(1 − ‖y − ŷ‖/‖y − ȳ‖)  (MATLAB compare 와 같은 NRMSE 정의) */
export function fitPercent(y, yhat) {
  let m = 0, n = 0;
  for (let k = 0; k < y.length; k++) if (Number.isFinite(y[k]) && Number.isFinite(yhat[k])) { m += y[k]; n++; }
  m /= n;
  let num = 0, den = 0;
  for (let k = 0; k < y.length; k++) if (Number.isFinite(y[k]) && Number.isFinite(yhat[k])) { num += (y[k] - yhat[k]) ** 2; den += (y[k] - m) ** 2; }
  return den > 0 ? 100 * (1 - Math.sqrt(num / den)) : null;
}

// ------------------------------------------------------------------ 그래프 방법
/**
 * 스텝 응답 그래프 방법 (2점법): 10 %, 63.2 % 도달 시각으로 τ, Td 를 구한다.
 *   1차+지연: t10 = Td + τ·ln(1/0.9),  t63 = Td + τ  →  τ = (t63 − t10)/(1 − ln(1/0.9)),  Td = t63 − τ
 * @returns { K, tau_s, Td_s, t_step_s, t10_s, t63_s }
 */
export function stepGraphical(data) {
  const { t_s, u_rad, y_rad } = data;
  const N = t_s.length;
  const uS = u_rad[0], uE = u_rad[N - 1];
  if (Math.abs(uE - uS) < 1e-9) throw new Error('stepGraphical: 입력에 스텝이 없음');
  let ks = u_rad.findIndex((u) => Math.abs(u - uS) > 0.5 * Math.abs(uE - uS));
  const tStep = t_s[ks];
  const pre = y_rad.slice(0, Math.max(1, ks)).filter(Number.isFinite);
  const y0 = pre.reduce((s, x) => s + x, 0) / pre.length;
  const tail = y_rad.slice(Math.floor(N * 0.9)).filter(Number.isFinite);
  const yf = tail.reduce((s, x) => s + x, 0) / tail.length;
  const K = (yf - y0) / (uE - uS);
  const cross = (frac) => {
    const lvl = y0 + frac * (yf - y0);
    const sgn = Math.sign(yf - y0);
    for (let k = Math.max(1, ks); k < N; k++) {
      if (!Number.isFinite(y_rad[k]) || !Number.isFinite(y_rad[k - 1])) continue;
      if (sgn * (y_rad[k] - lvl) >= 0) {
        const d = y_rad[k] - y_rad[k - 1];
        const f = d !== 0 ? (lvl - y_rad[k - 1]) / d : 1;
        return t_s[k - 1] + Math.min(1, Math.max(0, f)) * (t_s[k] - t_s[k - 1]);
      }
    }
    return null;
  };
  const t10 = cross(0.1), t63 = cross(1 - Math.exp(-1));
  if (t10 == null || t63 == null) return { K, tau_s: null, Td_s: null, t_step_s: tStep, t10_s: t10, t63_s: t63 };
  const tau = (t63 - t10) / (1 - Math.log(1 / 0.9));
  const Td = Math.max(0, t63 - tStep - tau);
  return { K, tau_s: tau, Td_s: Td, t_step_s: tStep, t10_s: t10, t63_s: t63 };
}

// ------------------------------------------------------------------ 최적화 도구
function nelderMead(f0, x0, steps, maxIter = 400, tol = 1e-10) {
  const f = (x) => { const v = f0(x); return Number.isFinite(v) ? v : Infinity; };
  const n = x0.length;
  let S = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += steps[i]; S.push(x); }
  let F = S.map(f);
  let it = 0;
  for (; it < maxIter; it++) {
    const o = F.map((v, i) => i).sort((a, b) => F[a] - F[b]);
    S = o.map((i) => S[i]); F = o.map((i) => F[i]);
    if (Math.abs(F[n] - F[0]) <= tol * (Math.abs(F[0]) + 1e-30)) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const xr = c.map((v, j) => v + (v - S[n][j])); const fr = f(xr);
    if (fr < F[0]) {
      const xe = c.map((v, j) => v + 2 * (v - S[n][j])); const fe = f(xe);
      if (fe < fr) { S[n] = xe; F[n] = fe; } else { S[n] = xr; F[n] = fr; }
    } else if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; }
    else {
      const out = fr < F[n];
      const xc = out ? c.map((v, j) => v + 0.5 * (xr[j] - v)) : c.map((v, j) => v + 0.5 * (S[n][j] - v));
      const fc = f(xc);
      if (fc < Math.min(fr, F[n])) { S[n] = xc; F[n] = fc; }
      else for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + 0.5 * (v - S[0][j])); F[i] = f(S[i]); }
    }
  }
  const b = F.indexOf(Math.min(...F));
  return { x: S[b], f: F[b], iter: it };
}

function prep(data, opts) {
  const keep = [];
  for (let k = 0; k < data.t_s.length; k++) if (Number.isFinite(data.y_rad[k]) && Number.isFinite(data.u_rad[k])) keep.push(k);
  if (keep.length < 10) throw new Error('식별: 유효 샘플이 10개 미만');
  const t = data.t_s, u = data.u_rad;
  const y0 = data.y_rad[keep[0]];
  const u0 = opts.u0 ?? u[0];
  return { t, u, y: data.y_rad, keep, y0, u0 };
}

function sse(d, servo) {
  // 편차 좌표: 정지 상태 (u0 ↔ y0). 모델은 θ − y0 = G·(u − u0)
  const yh = simulateServo(servo, d.t, d.u.map((v) => v - d.u0), { u0: 0, y0: 0 });
  let s = 0;
  for (const k of d.keep) { const e = d.y[k] - d.y0 - yh[k]; s += e * e; }
  return { s, yh: yh.map((v) => v + d.y0) };
}

/**
 * 측정 데이터와 같은 좌표의 모델 예측: ŷ = y[0] + G·(u − u0)  (적합과 같은 편차 좌표, 그래프 겹치기용)
 * simulateServo(servo, t, u) 는 절대 좌표(θ → K·u)라서 캘리브레이션 오프셋이 있으면 측정과 어긋난다.
 * @param data { t_s, u_rad, y_rad }  @param opts { u0 = u[0] }
 */
export function predictServo(servo, data, opts = {}) {
  return sse(prep(data, opts), servo).yh;
}

function yFit(d, yh) { return fitPercent(d.keep.map((k) => d.y[k]), d.keep.map((k) => yh[k])); }

/** 입력이 한 번만 바뀌는 스텝인가 */
export function isStepInput(u) {
  let changes = 0;
  for (let k = 1; k < u.length; k++) if (Math.abs(u[k] - u[k - 1]) > 1e-12) changes++;
  return changes === 1;
}

function initFO(data, d) {
  if (isStepInput(data.u_rad)) {
    try {
      const g = stepGraphical(data);
      if (g.tau_s > 0) return { K: g.K, tau_s: g.tau_s, Td_s: g.Td_s };
    } catch (e) { /* 그래프 방법 실패 → 기본값 */ }
  }
  // PRBS/처프: 이득은 최소제곱 정적 이득, τ·Td 는 서보 전형값
  let num = 0, den = 0;
  for (const k of d.keep) { num += (d.y[k] - d.y0) * (d.u[k] - d.u0); den += (d.u[k] - d.u0) ** 2; }
  return { K: den > 0 ? num / den : 1, tau_s: 0.05, Td_s: 0.01 };
}

/**
 * 지연 격자 탐색 + 국소 최적화. 지연은 비용 함수를 여러 골짜기로 만든다(특히 PRBS·처프) →
 * Td 를 격자(0 ~ td_max, td_step)로 고정하고 나머지 파라미터를 NM 으로 맞춘 뒤, 최선 점에서 Td 까지 함께 다듬는다.
 * mk(p, Td) → servo,  p0: 나머지 파라미터 출발점(변환 좌표),  steps: 그 초기 보폭
 */
function delayGridFit(d, mk, p0s, steps, opts) {
  const tdMax = opts.td_max ?? 0.08, tdStep = opts.td_step ?? 0.0025;
  const f = (p, Td) => sse(d, mk(p, Td)).s;
  let best = null;
  for (let Td = 0; Td <= tdMax + 1e-12; Td += tdStep) {
    for (const p0 of p0s) {
      const r = nelderMead((p) => f(p, Td), p0, steps, opts.inner_iter ?? 120, 1e-8);
      if (!best || r.f < best.f) best = { f: r.f, p: r.x, Td };
    }
  }
  const full = (x) => f(x.slice(0, -1), Math.abs(x[x.length - 1]));
  const x0 = [...best.p, best.Td];
  const st = [...steps.map((s) => s * 0.3), tdStep * 0.5];
  let r = nelderMead(full, x0, st, opts.max_iter ?? 400);
  r = nelderMead(full, r.x, st.map((s) => s * 0.2), opts.max_iter ?? 400);
  const out = r.f <= best.f ? { p: r.x.slice(0, -1), Td: Math.abs(r.x[r.x.length - 1]), f: r.f } : best;
  return out;
}

function finish(d, sv, f) {
  const { yh } = sse(d, sv);
  return { ...sv, fit_pct: yFit(d, yh), sse: f };
}

/**
 * 1차+지연 적합. opts { u0, init: {K, tau_s}, td_max = 0.08, td_step = 0.0025, max_iter = 400 }
 * @returns { type: 'fo', K, tau_s, Td_s, fit_pct, sse }
 */
export function fitFO(data, opts = {}) {
  const d = prep(data, opts);
  const g = opts.init ?? initFO(data, d);
  const mk = (p, Td) => ({ type: 'fo', K: p[0], tau_s: Math.exp(Math.min(3, Math.max(-9, p[1]))), Td_s: Td });
  const K0 = g.K || 1;
  const r = delayGridFit(d, mk, [[K0, Math.log(Math.max(1e-3, g.tau_s || 0.05))]], [0.1 * Math.abs(K0), 0.4], opts);
  return finish(d, mk(r.p, r.Td), r.f);
}

/**
 * 2차+지연 적합 (ωn ≤ 300 rad/s, 0.05 ≤ ζ ≤ 5). opts { u0, init_fo, td_max, td_step, max_iter }
 * @returns { type: 'so', K, wn_rad_s, zeta, Td_s, fit_pct, sse }
 */
export function fitSO(data, opts = {}) {
  const d = prep(data, opts);
  const fo = opts.init_fo ?? fitFO(data, opts);
  const mk = (p, Td) => ({ type: 'so', K: p[0], wn_rad_s: Math.min(300, Math.max(0.5, Math.exp(p[1]))), zeta: Math.min(5, Math.max(0.05, Math.abs(p[2]))), Td_s: Td });
  // 1차 τ ≈ 2ζ/ωn 에서 출발
  const p0s = [0.6, 1.0].map((z) => [fo.K, Math.log(Math.min(300, (2 * z) / fo.tau_s)), z]);
  const r = delayGridFit(d, mk, p0s, [0.05 * Math.abs(fo.K || 1), 0.3, 0.15], { td_step: 0.005, inner_iter: 150, ...opts, td_max: opts.td_max ?? Math.max(0.03, fo.Td_s + 0.02) });
  return finish(d, mk(r.p, r.Td), r.f);
}

/**
 * 1차+지연+속도 한계 적합. opts { u0, init_fo, td_max, td_step, max_iter }
 * @returns { type: 'fo_slew', K, tau_s, Td_s, vmax_rad_s, fit_pct, sse }
 */
export function fitFOSlew(data, opts = {}) {
  const d = prep(data, opts);
  const fo = opts.init_fo ?? fitFO(data, opts);
  let vobs = 0; // 관측된 최대 속도에서 출발
  for (let i = 1; i < d.keep.length; i++) {
    const a = d.keep[i - 1], b = d.keep[i];
    vobs = Math.max(vobs, Math.abs(d.y[b] - d.y[a]) / (d.t[b] - d.t[a]));
  }
  const mk = (p, Td) => ({ type: 'fo_slew', K: p[0], tau_s: Math.exp(Math.min(3, Math.max(-9, p[1]))), Td_s: Td, vmax_rad_s: Math.exp(Math.min(6, p[2])) });
  const p0s = [[fo.K, Math.log(fo.tau_s), Math.log(Math.max(0.1, vobs))], [fo.K, Math.log(fo.tau_s * 0.6), Math.log(Math.max(0.1, vobs * 1.3))]];
  const r = delayGridFit(d, mk, p0s, [0.05 * Math.abs(fo.K || 1), 0.3, 0.3], { td_step: 0.005, ...opts, td_max: opts.td_max ?? Math.max(0.03, fo.Td_s + 0.02) });
  return finish(d, mk(r.p, r.Td), r.f);
}

// ------------------------------------------------------------------ ARX
function lstsq(rows, b) {
  const n = rows[0].length;
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0));
  const Atb = new Array(n).fill(0);
  rows.forEach((r, k) => { for (let i = 0; i < n; i++) { Atb[i] += r[i] * b[k]; for (let j = 0; j < n; j++) AtA[i][j] += r[i] * r[j]; } });
  return solve(AtA, Atb);
}

/**
 * ARX 최소제곱 + 영차 유지 역변환.
 *   y_k + a1 y_{k−1} + … + a_na y_{k−na} = b1 u_{k−nk} + … + b_nb u_{k−nk−nb+1}
 * 균일 샘플 가정(Ts_s 없으면 평균 간격). 편차 좌표(u − u0, y − y[0]).
 * 연속 변환: 극점 s = ln z / Ts, 분자(차수 ≤ na−1)는 연속 모델의 ZOH 스텝 응답이 ARX 스텝 응답과 같도록 최소제곱.
 *   지연 = (nk − 1)·Ts (ZOH 자체가 한 샘플 지연을 만든다).
 * @returns { type: 'arx', a, b, nk, Ts_s, cont: { num, den, delay_s } | null, warn, fit_pct }
 */
export function fitARX(data, opts = {}) {
  const na = opts.na ?? 2, nb = opts.nb ?? 2, nk = opts.nk ?? 1;
  const d = prep(data, opts);
  const N = d.t.length;
  const Ts = opts.Ts_s ?? (d.t[N - 1] - d.t[0]) / (N - 1);
  const yv = d.y.map((v) => v - d.y0), uv = d.u.map((v) => v - d.u0);
  const uAt = (j) => (j < 0 ? 0 : uv[j]);
  const rows = [], rhs = [];
  const start = Math.max(na, nk + nb - 1);
  for (let k = start; k < N; k++) {
    const r = [];
    let ok = Number.isFinite(yv[k]);
    for (let i = 1; i <= na; i++) { r.push(-yv[k - i]); if (!Number.isFinite(yv[k - i])) ok = false; }
    for (let j = 0; j < nb; j++) r.push(uAt(k - nk - j));
    if (ok) { rows.push(r); rhs.push(yv[k]); }
  }
  const th = lstsq(rows, rhs);
  const a = th.slice(0, na), b = th.slice(na);
  // 시뮬레이션(출력 오차) 적합도
  const ys = new Array(N).fill(0);
  for (let k = 0; k < N; k++) {
    let s = 0;
    for (let i = 1; i <= na; i++) if (k - i >= 0) s -= a[i - 1] * ys[k - i];
    for (let j = 0; j < nb; j++) s += b[j] * uAt(k - nk - j);
    ys[k] = s;
  }
  const fit_pct = yFit(d, ys.map((v) => v + d.y0));
  let cont = null, warn = null;
  try { cont = arxToCont(a, b, nk, Ts); } catch (e) { warn = e.message; }
  return { type: 'arx', a, b, nk, Ts_s: Ts, cont, warn, fit_pct, K: cont ? dcGain(cont) : null };
}

function arxToCont(a, b, nk, Ts) {
  const na = a.length;
  const zr = roots([1, ...a]);
  const sr = zr.map((z) => {
    const r = Math.hypot(z.re, z.im);
    if (r >= 1) throw new Error('arx: 불안정 극점 — 연속 변환 불가');
    if (Math.abs(z.im) < 1e-9 && z.re <= 0) throw new Error('arx: 음의 실수 극점 — 연속 변환 불가(샘플이 너무 빠르거나 모델 차수 과다)');
    return { re: Math.log(r) / Ts, im: Math.atan2(z.im, z.re) / Ts };
  });
  const den = polyFromRoots(sr);
  // ARX 스텝 응답(지연 nk−1 샘플 제거)
  const M = Math.max(60, 20 * na);
  const g = new Array(M).fill(0);
  for (let k = 0; k < M; k++) {
    let s = 0;
    for (let i = 1; i <= na; i++) if (k - i >= 0) s -= a[i - 1] * g[k - i];
    for (let j = 0; j < b.length; j++) if (k - 1 - j >= 0) s += b[j];
    g[k] = s;
  }
  // 기저 s^j / den 의 ZOH 스텝 응답
  const basis = [];
  for (let j = 0; j < na; j++) {
    const num = new Array(na).fill(0); num[na - 1 - j] = 1; // s^j
    const S = tf2ssCanon(num, den);
    const { Ad, Bd } = c2d(S.A, S.B, Ts);
    let x = new Array(na).fill(0);
    const resp = [];
    for (let k = 0; k < M; k++) {
      resp.push(S.C[0].reduce((s, c, i) => s + c * x[i], 0));
      x = Ad.map((r, i) => r.reduce((s, c, q) => s + c * x[q], 0) + Bd[i][0]);
    }
    basis.push(resp);
  }
  const rows = g.map((_, k) => basis.map((r) => r[k]));
  const coef = lstsq(rows, g);
  const num = new Array(na).fill(0);
  coef.forEach((c, j) => { num[na - 1 - j] = c; });
  while (num.length > 1 && Math.abs(num[0]) < 1e-12 * Math.max(...num.map(Math.abs))) num.shift();
  return { num, den, delay_s: Math.max(0, nk - 1) * Ts };
}

// ------------------------------------------------------------------ 합성과 결과
/** 전체 전달함수 P(s) = G_servo(s)·K_b/s² (지연 포함) */
export function composePlant(servo, K_b) {
  return plantTF(makeModel({ servo_tf: servo, ...(K_b ? { K_b } : {}) }));
}

/** 식별 결과(서보 객체)를 data-schema §4.3 servo 형식으로 정리 */
export function toServoObject(fit, extra = {}) {
  const s = { type: fit.type, K: fit.K ?? 1, tau_s: fit.tau_s ?? null, Td_s: fit.Td_s ?? (fit.cont ? fit.cont.delay_s : 0),
    wn_rad_s: fit.wn_rad_s ?? null, zeta: fit.zeta ?? null, vmax_rad_s: fit.vmax_rad_s ?? null,
    fit_pct: fit.fit_pct ?? null, valid_fit_pct: extra.valid_fit_pct ?? null, assumed: extra.assumed ?? false };
  if (fit.type === 'arx') s.cont = fit.cont;
  return s;
}

/**
 * data-schema §4.3 result.json 객체
 * @param o { servo, servo_model, calibration, K_b, data_sessions, provenance = 'real', created_at }
 */
export function buildResult(o) {
  if (!o.servo) throw new Error('buildResult: servo 필요');
  const provenance = o.provenance ?? 'real';
  // 적합 함수 결과(sse 등 부가 키 포함)를 §4.3 servo 형식으로 정리
  const servo = toServoObject(o.servo, { assumed: o.servo.assumed ?? false, valid_fit_pct: o.servo.valid_fit_pct ?? null });
  if (provenance === 'simulated') servo.assumed = true;
  const P = composePlant(servo, o.K_b);
  const K_b = o.K_b ?? makeModel().K_b;
  return {
    schema_ver: 1,
    created_at: o.created_at ?? new Date().toISOString(),
    servo_model: o.servo_model ?? null,
    provenance,
    servo,
    K_b,
    P_tf: P,
    P_poles: roots(P.den),
    calibration_ref: o.calibration ? (o.calibration.created_at ?? null) : null,
    data_sessions: o.data_sessions ?? [],
  };
}
