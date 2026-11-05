// pid.js — PID (D 필터, 측정값 미분, 조건부 적분 와인드업 방지)
//
//   u = kp·e + I + D,   e = ref − y
//   I  : 사다리꼴 적분  I += ki·dt·(e + e_prev)/2   (포화 중 같은 방향이면 적분 정지, |I| ≤ u_lim)
//   D  : d_on = 'measurement' →  D = −kd · ẏ_f     (설정값 킥 없음, 기본)
//        d_on = 'error'       →  D = +kd · ė_f
//        ẋ_f = s/(Tf s + 1)·x,  Tf = kd/(n_filt·kp)  (kp = 0 이면 kd/n_filt)
//   연속 등가 TF(analysis.controllerTF): C(s) = kp + ki/s + kd s/(Tf s + 1)
import { mergeParams, saturate, dtValid, FilteredDiff, pidSpecs } from './common.js';

export function pidTf(p) {
  if (!(p.kd > 0)) return 0;
  return p.kp > 0 ? p.kd / (p.n_filt * p.kp) : p.kd / p.n_filt;
}

export default class Pid {
  static meta = {
    id: 'pid',
    label: 'PID',
    family: 'classical',
    linear: true,
    params: [
      ...pidSpecs('', { kp: 0.574, ki: 0, kd: 0.994 }),
      { key: 'n_filt', label: 'N (D 필터)', unit: '–', type: 'number', min: 1, max: 50, step: 1, default: 10,
        help: 'D 필터 Tf = Kd/(N·Kp). 작을수록 잡음에 강하지만 위상 앞섬이 줄어든다(5~10 권장)' },
      { key: 'd_on', label: 'D 입력', unit: '–', type: 'enum', default: 'measurement',
        options: [{ value: 'measurement', label: '측정값 미분(킥 없음)' }, { value: 'error', label: '오차 미분' }],
        help: '오차 미분은 설정값이 바뀌는 순간 D 항이 튄다(설정값 킥)' },
    ],
    debug_keys: ['p', 'i', 'd', 'saturated'],
    needs_model: false,
  };

  constructor(params = {}, env = {}) {
    this.env = { u_lim_rad: 0.5236, Ts_s: 0.06, ...env };
    this.params = mergeParams(Pid.meta.params, params);
    this.diff = new FilteredDiff(pidTf(this.params));
    this.reset();
  }

  setParams(partial) {
    this.params = mergeParams(Pid.meta.params, partial, this.params);
    this.diff.Tf = pidTf(this.params);
    // 상태(I, 미분기)는 유지한다. kp 변경으로 생기는 출력 계단은 그대로 둔다(학습 관찰 대상).
  }

  reset(state0 = {}) {
    this.I = 0;
    this.ePrev = NaN;
    this.u = Number.isFinite(state0.u_rad) ? state0.u_rad : 0;
    const x0 = this.params.d_on === 'error'
      ? (Number.isFinite(state0.ref_m) && Number.isFinite(state0.y_m) ? state0.ref_m - state0.y_m : NaN)
      : (Number.isFinite(state0.y_m) ? state0.y_m : NaN);
    this.diff.reset(x0);
    this._dbg = { p: 0, i: 0, d: 0, saturated: false, lost: false };
  }

  update(ref_m, y_m, dt_s) {
    const lim = this.env.u_lim_rad;
    if (!Number.isFinite(y_m) || !Number.isFinite(ref_m)) {
      this._dbg = { ...this._dbg, lost: true };
      return this.u; // 규칙 2: 직전 u 유지, 적분 정지
    }
    if (!dtValid(dt_s)) { this._dbg = { ...this._dbg, lost: false }; return this.u; }
    const { kp, ki, kd, d_on } = this.params;
    const e = ref_m - y_m;
    const P = kp * e;
    const rate = this.diff.update(d_on === 'error' ? e : y_m, dt_s);
    const D = d_on === 'error' ? kd * rate : -kd * rate;
    // 적분 후보
    let Inew = this.I;
    if (ki > 0 && Number.isFinite(this.ePrev)) Inew += ki * dt_s * 0.5 * (e + this.ePrev);
    else if (ki > 0) Inew += ki * dt_s * e;
    Inew = Math.max(-lim, Math.min(lim, Inew));
    const uTry = P + Inew + D;
    // 조건부 적분: 포화되고 적분이 포화를 더 깊게 만드는 방향이면 적분을 갱신하지 않는다
    if (ki > 0 && Math.abs(uTry) > lim && Math.sign(uTry) === Math.sign(Inew - this.I)) Inew = this.I;
    if (ki === 0) Inew = 0;
    this.I = Inew;
    this.ePrev = e;
    const r = saturate(P + this.I + D, lim);
    this.u = r.u;
    this._dbg = { p: P, i: this.I, d: D, saturated: r.saturated, lost: false };
    return r.u;
  }

  get debug() { return { ...this._dbg }; }

  /**
   * 서보 무시 극점 배치 설계 (04장): 특성식 s² + K_b·kd·s + K_b·kp = s² + 2ζωn s + ωn²
   *   ζ = −ln(OS)/√(π² + ln²OS),  ωn = 4/(ζ·ts)  (2% 정착 근사)
   *   kp = ωn²/K_b,  kd = 2ζωn/K_b
   * 주의: PD 영점(−kp/kd) 때문에 실제 오버슈트는 사양보다 크다. designPD()가 예측 지표를 함께 준다.
   * @param specs { ts_s=3, po_pct=5, n_filt=10 }
   */
  static design(model, specs = {}) { return designPD(model, specs).params; }
}

/** specs: { ts_s, po_pct } 또는 { zeta, wn_rad_s } (04장 근궤적 위젯이 극점을 직접 고를 때) */
export function designPD(model, specs = {}) {
  let zeta, wn;
  if (specs.zeta > 0 && specs.wn_rad_s > 0) { zeta = specs.zeta; wn = specs.wn_rad_s; }
  else {
    const ts = specs.ts_s ?? 3, po = (specs.po_pct ?? 5) / 100;
    const L = Math.log(po);
    zeta = -L / Math.sqrt(Math.PI ** 2 + L * L);
    wn = 4 / (zeta * ts);
  }
  const Kb = model.K_b;
  const kp = (wn * wn) / Kb, kd = (2 * zeta * wn) / Kb;
  return {
    params: { kp, ki: 0, kd, n_filt: specs.n_filt ?? 10, d_on: specs.d_on ?? 'measurement' },
    zeta, wn_rad_s: wn, zero: -kp / kd,
    note: '서보·센서 필터·샘플링 무시(ball_only) 설계. 영점 때문에 실제 OS는 사양보다 크다.',
  };
}
