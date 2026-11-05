// simulate.js — 볼앤빔 폐루프 시뮬레이션 (controller-interface.md §4)
//
// 연속 플랜트(공 + 서보 + 지연 + 속도 한계)를 RK4로 적분하고, 제어기는 Ts마다 ZOH로 갱신한다.
// 측정 경로는 펌웨어와 같다: 거리 측정 → (잡음 → 양자화 → 유실) → 재귀 필터 f ← f(1−α) + xα.
// 모든 제어기가 이 함수를 공유한다(비교 공정성). 가상 장치는 stepPlant / initPlantState를 재사용한다.
import { getController } from './registry.js';
import { rng } from './linalg.js';

/**
 * 플랜트 초기 상태
 * @returns {{ t_s, y_m, ydot_m_s, theta_rad, theta_dot_rad_s, xs, cmd_hist, end_hit }}
 *  - theta_rad: 서보 실제각(포텐쇼미터가 재는 값)
 *  - xs: arx 서보 내부 상태(그 외 [])
 *  - cmd_hist: 지연 처리용 명령 이력 [{ t_s, u_rad }] (오래된 것은 자동 삭제)
 */
export function initPlantState(model, init = {}) {
  const th = init.theta_rad ?? 0;
  const s = model.servo;
  let xs = [];
  if (s && s.type === 'arx') {
    // 정상상태 θ = th 에 해당하는 내부 상태 (정준형: 마지막 상태가 출력 계수 곱)
    const n = s.cont.den.length - 1;
    xs = new Array(n).fill(0);
    const dc = dcGain(s.cont.num, s.cont.den);
    if (n > 0 && dc !== 0) {
      // u_ss = th/dc 일 때 정준형 정상상태: x_n = u_ss / a_n, 나머지 0
      const a = s.cont.den.map((x) => x / s.cont.den[0]);
      xs[n - 1] = (th / dc) / a[n];
    }
  }
  return {
    t_s: init.t_s ?? 0,
    y_m: init.y_m ?? init.y0_m ?? 0.15,
    ydot_m_s: init.ydot_m_s ?? init.ydot0_m_s ?? 0,
    theta_rad: th,
    theta_dot_rad_s: 0,
    xs,
    cmd_hist: [{ t_s: -1e9, u_rad: init.u_rad ?? (s ? th / (s.K || 1) : th) }],
    end_hit: false,
  };
}

function dcGain(num, den) {
  const n = num[num.length - 1], d = den[den.length - 1];
  return d === 0 ? Infinity : n / d;
}

/** 시각 t에서 서보에 도달한 (지연된) 명령 */
function delayedCmd(hist, t, delay) {
  const tt = t - delay + 1e-12;
  let u = hist[0].u_rad;
  for (const h of hist) { if (h.t_s <= tt) u = h.u_rad; else break; }
  return u;
}

/** 연속 상태 미분. x = [y, ydot, theta, theta_dot, ...xs] */
function deriv(x, ud, model, kbs) {
  const s = model.servo;
  const Kb = model.K_b * kbs;
  const dx = new Array(x.length).fill(0);
  dx[0] = x[1];
  if (!s || s.type === 'ideal') {
    const th = (s ? s.K ?? 1 : 1) * ud;
    dx[1] = Kb * th;
    return dx;
  }
  if (s.type === 'fo' || s.type === 'fo_slew') {
    let v = ((s.K ?? 1) * ud - x[2]) / s.tau_s;
    if (s.type === 'fo_slew' && s.vmax_rad_s > 0) v = Math.max(-s.vmax_rad_s, Math.min(s.vmax_rad_s, v));
    dx[1] = Kb * x[2];
    dx[2] = v;
    return dx;
  }
  if (s.type === 'so') {
    const w = s.wn_rad_s, z = s.zeta;
    dx[1] = Kb * x[2];
    dx[2] = x[3];
    dx[3] = w * w * ((s.K ?? 1) * ud - x[2]) - 2 * z * w * x[3];
    return dx;
  }
  if (s.type === 'arx') {
    // 정준형: xs' = A xs + B u, θ = C xs + D u (plant.tf2ssCanon과 같은 구조)
    const den = s.cont.den.map((c) => c / s.cont.den[0]);
    const numRaw = s.cont.num.map((c) => c / s.cont.den[0]);
    const n = den.length - 1;
    const nm = numRaw.slice(); while (nm.length < den.length) nm.unshift(0);
    const Dv = nm[0];
    const r = nm.map((c, i) => c - Dv * den[i]).slice(1);
    const xs = x.slice(4);
    let th = Dv * ud;
    for (let i = 0; i < n; i++) th += r[i] * xs[i];
    dx[1] = Kb * th;
    let top = ud;
    for (let i = 0; i < n; i++) top -= den[i + 1] * xs[i];
    dx[4] = top;
    for (let i = 1; i < n; i++) dx[4 + i] = xs[i - 1];
    return dx;
  }
  throw new Error('deriv: 알 수 없는 서보 type');
}

function arxTheta(xs, ud, s) {
  const den = s.cont.den.map((c) => c / s.cont.den[0]);
  const nm = s.cont.num.map((c) => c / s.cont.den[0]); while (nm.length < den.length) nm.unshift(0);
  const Dv = nm[0];
  const r = nm.map((c, i) => c - Dv * den[i]).slice(1);
  let th = Dv * ud;
  for (let i = 0; i < r.length; i++) th += r[i] * xs[i];
  return th;
}

/**
 * 플랜트를 dt_s 만큼 진행 (state를 갱신해 반환).
 * u_rad는 시각 state.t_s 에 내려진 명령이다. 서보는 Td(+ opts.delay_s) 뒤에 이를 받는다.
 * @param {object} opts { substeps=10, kb_scale=1, delay_s=0, ends=true, y_min_m=0, y_max_m=L }
 *   ends: 공이 [y_min_m, y_max_m] 밖으로 나가면 멈춘다(비탄성 정지, state.end_hit = true).
 */
export function stepPlant(state, u_rad, dt_s, model, opts = {}) {
  const sub = Math.max(1, opts.substeps ?? 10);
  const kbs = opts.kb_scale ?? 1;
  const s = model.servo;
  const delay = (s ? s.Td_s || 0 : 0) + (opts.delay_s || 0);
  const t0 = state.t_s, t1 = t0 + dt_s;
  const hist = state.cmd_hist;
  hist.push({ t_s: t0, u_rad });
  // 경계(명령이 서보에 도달하는 시각)로 구간을 나눈다
  const cuts = [t0];
  for (const h of hist) { const ta = h.t_s + delay; if (ta > t0 + 1e-12 && ta < t1 - 1e-12) cuts.push(ta); }
  cuts.push(t1);
  cuts.sort((a, b) => a - b);
  let x = [state.y_m, state.ydot_m_s, state.theta_rad, state.theta_dot_rad_s, ...state.xs];
  const hmax = dt_s / sub;
  for (let c = 0; c < cuts.length - 1; c++) {
    const ta = cuts[c], tb = cuts[c + 1];
    const len = tb - ta;
    if (len <= 0) continue;
    const ud = delayedCmd(hist, ta + 1e-9, delay);
    const nst = Math.max(1, Math.ceil(len / hmax - 1e-9));
    const h = len / nst;
    for (let k = 0; k < nst; k++) {
      const k1 = deriv(x, ud, model, kbs);
      const k2 = deriv(x.map((v, i) => v + 0.5 * h * k1[i]), ud, model, kbs);
      const k3 = deriv(x.map((v, i) => v + 0.5 * h * k2[i]), ud, model, kbs);
      const k4 = deriv(x.map((v, i) => v + h * k3[i]), ud, model, kbs);
      x = x.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
      if (opts.ends !== false) {
        const lo = opts.y_min_m ?? 0, hi = opts.y_max_m ?? model.plant_params.L_m;
        if (x[0] < lo) { x[0] = lo; if (x[1] < 0) x[1] = 0; state.end_hit = true; }
        if (x[0] > hi) { x[0] = hi; if (x[1] > 0) x[1] = 0; state.end_hit = true; }
      }
    }
  }
  state.t_s = t1;
  state.y_m = x[0];
  state.ydot_m_s = x[1];
  if (!s || s.type === 'ideal') {
    state.theta_rad = (s ? s.K ?? 1 : 1) * delayedCmd(hist, t1, delay);
  } else if (s.type === 'arx') {
    state.xs = x.slice(4);
    state.theta_rad = arxTheta(state.xs, delayedCmd(hist, t1, delay), s);
  } else {
    state.theta_rad = x[2];
    state.theta_dot_rad_s = x[3];
  }
  // 오래된 명령 이력 정리 (지연보다 오래된 것 중 마지막 하나만 남김)
  while (hist.length > 2 && hist[1].t_s + delay <= t1) hist.shift();
  return state;
}

// ---------------------------------------------------------------- 설정값 프로파일 (mm → m)
/** 프로파일 길이 [s] */
export function profileDuration(profile, fallback = 10) {
  if (!profile) return fallback;
  switch (profile.type) {
    case 'const': return profile.duration_s ?? fallback;
    case 'step': return (profile.pre_s ?? 0) + (profile.hold_s ?? 0);
    case 'square': return 2 * profile.half_period_s * (profile.cycles ?? 1);
    case 'staircase': return profile.levels_mm.length * profile.hold_s;
    default: throw new Error(`알 수 없는 프로파일 type: ${profile.type}`);
  }
}
/** 시각 t의 설정값 [m] */
export function profileRef(profile, t) {
  switch (profile.type) {
    case 'const': return profile.ref_mm / 1000;
    case 'step': return (t < (profile.pre_s ?? 0) ? profile.from_mm : profile.to_mm) / 1000;
    case 'square': {
      const k = Math.floor(t / profile.half_period_s);
      return (k % 2 === 0 ? profile.low_mm : profile.high_mm) / 1000;
    }
    case 'staircase': {
      const k = Math.min(profile.levels_mm.length - 1, Math.max(0, Math.floor(t / profile.hold_s)));
      return profile.levels_mm[k] / 1000;
    }
    default: throw new Error(`알 수 없는 프로파일 type: ${profile.type}`);
  }
}

/**
 * 폐루프 시뮬레이션
 * @param model     plant.makeModel 결과
 * @param controller 제어기 인스턴스(호출자가 reset) 또는 { id, params }
 * @param profile   data-schema §2.2 프로파일 (mm)
 * @param opts { t_end_s, y0_m, ydot0_m_s, Ts_s, substeps=10, noise=true, seed=1, delay_s=0,
 *               kb_scale=1, y_source='filt'|'raw', theta_meas=true, pot_noise_rad=0, ends=true }
 *   noise=false 이면 센서 잡음·양자화·유실을 끈다(필터 α는 model.sensor.alpha 그대로).
 */
export function simulate(model, controller, profile, opts = {}) {
  const Ts = opts.Ts_s ?? model.sensor.Ts_s;
  const t_end = opts.t_end_s ?? profileDuration(profile, 10);
  const N = Math.floor(t_end / Ts + 1e-9) + 1;
  const sens = model.sensor;
  const noisy = opts.noise !== false;
  const R = rng(opts.seed ?? 1);
  const alpha = sens.alpha ?? 1;
  const ySource = opts.y_source ?? 'filt';
  const ulim = model.u_lim_rad;

  let ctrl = controller;
  const env = { model, Ts_s: Ts, u_lim_rad: ulim, mode: 'sim' };
  const ref0 = profile ? profileRef(profile, 0) : 0.15;
  // 초기 위치 기본값: step은 from_mm(사전 구간이 0초여도), 나머지는 t=0 설정값
  const y0 = opts.y0_m ?? (profile && profile.type === 'step' ? profile.from_mm / 1000 : ref0);
  if (!(controller && typeof controller.update === 'function')) {
    const Cls = getController(controller.id);
    ctrl = new Cls(controller.params || {}, env);
    ctrl.reset({ t_s: 0, ref_m: ref0, y_m: y0, u_rad: 0, theta_rad: 0 });
  }

  const st = initPlantState(model, { y_m: y0, ydot_m_s: opts.ydot0_m_s ?? 0 });
  const out = { t_s: [], ref_m: [], y_m: [], y_raw_m: [], y_meas_m: [], u_rad: [], theta_rad: [], debug: [], model_kind: model.kind, end_hit: false };
  let filt = NaN;
  let uPrev = 0;
  const stepOpts = { substeps: opts.substeps ?? 10, kb_scale: opts.kb_scale ?? 1, delay_s: opts.delay_s ?? 0, ends: opts.ends,
    y_min_m: opts.y_min_m, y_max_m: opts.y_max_m };

  for (let k = 0; k < N; k++) {
    const t = k * Ts;
    const ref = profile ? profileRef(profile, t) : ref0;
    // 측정
    let raw = st.y_m;
    let lost = false;
    if (noisy) {
      if ((sens.noise_m || 0) > 0) raw += sens.noise_m * R.normal();
      if ((sens.quant_m || 0) > 0) raw = Math.round(raw / sens.quant_m) * sens.quant_m;
      if ((sens.lost_prob || 0) > 0 && R.uniform() < sens.lost_prob) lost = true;
    }
    if (!lost) filt = Number.isNaN(filt) ? raw : filt * (1 - alpha) + raw * alpha;
    const yRaw = lost ? NaN : raw;
    const yMeas = lost ? NaN : (ySource === 'raw' ? raw : filt);
    let th = st.theta_rad;
    if ((opts.pot_noise_rad || 0) > 0) th += opts.pot_noise_rad * R.normal();
    const aux = { theta_rad: opts.theta_meas === false ? NaN : th, y_raw_m: yRaw };
    let u = ctrl.update(ref, yMeas, Ts, aux);
    if (!Number.isFinite(u)) u = uPrev;
    u = Math.max(-ulim, Math.min(ulim, u));
    uPrev = u;

    out.t_s.push(t); out.ref_m.push(ref); out.y_m.push(st.y_m); out.y_raw_m.push(yRaw);
    out.y_meas_m.push(yMeas); out.u_rad.push(u); out.theta_rad.push(st.theta_rad);
    out.debug.push({ ...ctrl.debug });
    if (k < N - 1) stepPlant(st, u, Ts, model, stepOpts);
  }
  out.end_hit = st.end_hit;
  return out;
}
