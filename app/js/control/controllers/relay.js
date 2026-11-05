// relay.js — 릴레이 피드백 (11장 오토튜닝, Åström–Hägglund)
//
//   e = ref − y,  릴레이 상태 r ∈ {−1, +1}:  e > eps → +1,  e < −eps → −1,  그 사이 → 유지(히스테리시스)
//   u = bias + h·r − kd_stab·ẏ_f
//
// ■ 왜 kd_stab 인가 (docs/theory/autotune-relay.md)
//   이중 적분기 K_b/s² 의 위상은 모든 주파수에서 −180°이고, 서보·필터·샘플 지연은 위상을 더 늦춘다.
//   릴레이의 기술함수 −1/N(a) 는 음의 실축(히스테리시스가 있으면 그보다 아래, 3사분면)에 있으므로
//   G(jω) 와 만나지 않는다 → 안정한 극한 사이클이 없고 진동 진폭이 커져 공이 빔 끝에 닿는다.
//   측정값 미분 되먹임 −kd_stab·ẏ 를 안쪽 루프로 두면 릴레이가 보는 대상은
//   G'(s) = K_b/(s(s + K_b·kd_stab)) (위상 −90°~−180°) 가 되어 지연과 함께 −180° 를 지나는
//   주파수에서 극한 사이클이 생긴다. kd_stab = 0 이면 고전 릴레이 시험(이중 적분기에서는 발산 — 시뮬레이션 학습용).
//   G' 의 위상 −180° 교차 주파수에서 Ku, Tu 를 찾고, PID 결과의 kd 에 kd_stab 을 더한다(autotune.applyRule).
//   max_time 이 지나면 u = bias 로 멈추고 debug.done = true.
import { mergeParams, saturate, dtValid, FilteredDiff } from './common.js';

export const KD_STAB_DEVICE_MIN = 0.3;

export default class Relay {
  static meta = {
    id: 'relay',
    label: '릴레이(오토튜닝)',
    family: 'autotune',
    linear: false,
    params: [
      { key: 'h', label: '릴레이 진폭 h', unit: 'rad', type: 'number', min: 0.005, max: 0.2, step: 0.005, default: 0.05,
        device_max: 0.1, help: '±h 로 기울인다. 0.05 rad ≈ 2.9°. 사이클이 빔 끝에 닿으면 줄인다' },
      { key: 'eps', label: '히스테리시스 ε', unit: 'm', type: 'number', min: 0, max: 0.03, step: 0.001, default: 0.006,
        help: '센서 분해능(3 mm)의 2배 정도. 잡음으로 릴레이가 떨리지 않게 한다' },
      { key: 'bias', label: '바이어스', unit: 'rad', type: 'number', min: -0.1, max: 0.1, step: 0.001, default: 0,
        help: '빔 수평 오차 보정. 사이클이 비대칭이면 조정' },
      { key: 'max_time', label: '최대 시간', unit: 's', type: 'number', min: 5, max: 60, step: 1, default: 40,
        help: '이 시간이 지나면 릴레이를 멈춘다(안전). 사이클 주기가 약 4 s 이므로 분석에 필요한 7사이클(버림 2 + 5)을 얻으려면 40 s 정도 필요' },
      { key: 'kd_stab', label: '안정화 미분 kd_stab', unit: 'rad·s/m', type: 'number', min: 0, max: 5, step: 0.05, default: 1.5,
        help: '이중 적분기는 순수 릴레이로 극한 사이클이 생기지 않는다(발산). 측정값 미분 되먹임으로 안정화한 뒤 릴레이를 건다. 0 = 고전 릴레이(시뮬레이션 전용, 실기에서는 0.3 이상으로 강제). 튜닝 규칙 결과의 kd 에 이 값이 더해진다(autotune.applyRule)' },
    ],
    debug_keys: ['relay_state', 'saturated'],
    needs_model: false,
  };

  constructor(params = {}, env = {}) {
    this.env = { u_lim_rad: 0.5236, Ts_s: 0.06, ...env };
    this.params = this._guard(mergeParams(Relay.meta.params, params));
    this.diff = new FilteredDiff(0.1);
    this.reset();
  }
  setParams(partial) { this.params = this._guard(mergeParams(Relay.meta.params, partial, this.params)); }
  /** 안전장치: 실기에서 kd_stab < 0.3 이면 사이클이 커져 공이 빔 끝에 부딪힌다 → 0.3 으로 올린다(debug.kd_stab_raised) */
  _guard(p) {
    this.kdRaised = false;
    if (this.env.mode === 'device' && p.kd_stab < KD_STAB_DEVICE_MIN) { this.kdRaised = true; return { ...p, kd_stab: KD_STAB_DEVICE_MIN }; }
    return p;
  }
  reset(state0 = {}) {
    this.r = 1;
    if (Number.isFinite(state0.ref_m) && Number.isFinite(state0.y_m) && state0.ref_m - state0.y_m < 0) this.r = -1;
    this.t = 0;
    this.u = this.params.bias;
    this.diff.reset(Number.isFinite(state0.y_m) ? state0.y_m : NaN);
    this._dbg = { relay_state: this.r, saturated: false, lost: false, done: false };
  }
  update(ref_m, y_m, dt_s, aux = {}) {
    if (!Number.isFinite(y_m) || !Number.isFinite(ref_m)) { this._dbg = { ...this._dbg, lost: true }; return this.u; }
    if (!dtValid(dt_s)) return this.u;
    this.t += dt_s;
    const { h, eps, bias, max_time, kd_stab } = this.params;
    if (this.t > max_time) {
      this.u = saturate(bias, this.env.u_lim_rad).u;
      this._dbg = { relay_state: 0, saturated: false, lost: false, done: true };
      return this.u;
    }
    const yv = Number.isFinite(aux.y_raw_m) ? aux.y_raw_m : y_m;
    const e = ref_m - y_m;
    if (e > eps) this.r = 1; else if (e < -eps) this.r = -1;
    const ydot = this.diff.update(yv, dt_s);
    const r = saturate(bias + h * this.r - kd_stab * ydot, this.env.u_lim_rad);
    this.u = r.u;
    this._dbg = { relay_state: this.r, saturated: r.saturated, lost: false, done: false, kd_stab_raised: this.kdRaised };
    return r.u;
  }
  get debug() { return { ...this._dbg }; }
}
