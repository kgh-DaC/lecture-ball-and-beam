// gain-schedule.js — 게인 스케줄링 PID (12장, 슬라이드 50 재현 + 보간 + bumpless)
//
//   d = |ref − y|.  d < boundary → near 게인, 아니면 far 게인 (blend = 'switch', 슬라이드 50 그대로)
//   blend = 'linear'  : boundary ± blend_width/2 구간에서 선형 보간
//   blend = 'sigmoid' : w_far = 1/(1 + exp(−(d − boundary)/(blend_width/6)))
//   u = kp·e + I − kd·ẏ_f + b       (D는 측정값 미분, ẏ_f = s/(0.1 s + 1)·y)
//   bumpless = true : 게인이 바뀌어 출력이 튀려 하면 그 차이를 b 로 흡수하고 b 를 시정수 0.5 s 로 0에 감쇠.
//      (적분기로 흡수하면 Ki = 0 영역에서 영원히 남아 정상상태 오차가 되므로 감쇠 항을 따로 둔다.)
//   슬라이드 50 의 게인 단위(SI 인지 deg/cm 인지)는 미확정(controller-interface §9) — SI 로 가정한다.
import { mergeParams, saturate, dtValid, FilteredDiff, pidSpecs } from './common.js';

const TAU_BUMP = 0.5;
const TF_D = 0.1;

export default class GainSchedule {
  static meta = {
    id: 'gain-schedule',
    label: '게인 스케줄링',
    family: 'adaptive',
    linear: false,
    params: [
      ...pidSpecs('_near', { kp: 2.3884, ki: 0, kd: 2.0684 }, ' (가까움)'),
      ...pidSpecs('_far', { kp: 0.66861, ki: 0.023404, kd: 4.7753 }, ' (멂)'),
      { key: 'boundary', label: '경계 |e|', unit: 'm', type: 'number', min: 0.01, max: 0.3, step: 0.005, default: 0.10,
        help: '슬라이드 50: 10 cm' },
      { key: 'blend', label: '전환 방식', unit: '–', type: 'enum', default: 'switch',
        options: [{ value: 'switch', label: '즉시 전환(슬라이드)' }, { value: 'linear', label: '선형 보간' }, { value: 'sigmoid', label: '시그모이드' }],
        help: '즉시 전환은 경계에서 출력이 튈 수 있다' },
      { key: 'blend_width', label: '보간 폭', unit: 'm', type: 'number', min: 0.005, max: 0.2, step: 0.005, default: 0.04,
        help: '선형/시그모이드 보간이 일어나는 오차 폭' },
      { key: 'bumpless', label: 'bumpless 전환', unit: '–', type: 'bool', default: false,
        help: '게인 전환 순간의 출력 계단을 없애고 0.5 s 동안 서서히 넘긴다' },
    ],
    debug_keys: ['kp', 'ki', 'kd', 'region', 'i', 'saturated'],
    needs_model: false,
  };

  constructor(params = {}, env = {}) {
    this.env = { u_lim_rad: 0.5236, Ts_s: 0.06, ...env };
    this.params = mergeParams(GainSchedule.meta.params, params);
    this.diff = new FilteredDiff(TF_D);
    this.reset();
  }
  setParams(partial) { this.params = mergeParams(GainSchedule.meta.params, partial, this.params); }
  reset(state0 = {}) {
    this.I = 0; this.b = 0; this.ePrev = NaN; this.prevGains = null;
    this.u = Number.isFinite(state0.u_rad) ? state0.u_rad : 0;
    this.diff.reset(Number.isFinite(state0.y_m) ? state0.y_m : NaN);
    this._dbg = { kp: 0, ki: 0, kd: 0, region: 'near', w_far: 0, i: 0, saturated: false, lost: false };
  }

  /** 오차 크기 → far 가중치 0~1 */
  weight(d) {
    const { boundary, blend, blend_width } = this.params;
    if (blend === 'switch') return d < boundary ? 0 : 1;
    if (blend === 'linear') return Math.min(1, Math.max(0, (d - (boundary - blend_width / 2)) / blend_width));
    return 1 / (1 + Math.exp(-(d - boundary) / (blend_width / 6)));
  }

  update(ref_m, y_m, dt_s) {
    const lim = this.env.u_lim_rad;
    if (!Number.isFinite(y_m) || !Number.isFinite(ref_m)) { this._dbg = { ...this._dbg, lost: true }; return this.u; }
    if (!dtValid(dt_s)) return this.u;
    const p = this.params;
    const e = ref_m - y_m;
    const w = this.weight(Math.abs(e));
    const kp = (1 - w) * p.kp_near + w * p.kp_far;
    const ki = (1 - w) * p.ki_near + w * p.ki_far;
    const kd = (1 - w) * p.kd_near + w * p.kd_far;
    const ydot = this.diff.update(y_m, dt_s);
    // 적분 (사다리꼴 + 조건부)
    let In = this.I;
    if (ki > 0) In += ki * dt_s * (Number.isFinite(this.ePrev) ? 0.5 * (e + this.ePrev) : e);
    In = Math.max(-lim, Math.min(lim, In));
    // bumpless: 게인 변화로 생긴 출력 차이를 b로 흡수
    if (p.bumpless && this.prevGains) {
      const g = this.prevGains;
      const changed = g.kp !== kp || g.kd !== kd;
      if (changed) {
        const uOld = g.kp * e + In - g.kd * ydot;
        const uNew = kp * e + In - kd * ydot;
        this.b += uOld - uNew;
      }
      this.b *= Math.exp(-dt_s / TAU_BUMP);
    } else this.b = 0;
    const uTry = kp * e + In - kd * ydot + this.b;
    if (ki > 0 && Math.abs(uTry) > lim && Math.sign(uTry) === Math.sign(In - this.I)) In = this.I;
    this.I = ki > 0 ? In : this.I; // ki = 0 영역에서는 적분값을 고정(다른 영역의 적분을 보존)
    this.ePrev = e;
    this.prevGains = { kp, kd };
    const r = saturate(kp * e + this.I - kd * ydot + this.b, lim);
    this.u = r.u;
    this._dbg = { kp, ki, kd, region: w < 0.5 ? 'near' : 'far', w_far: w, i: this.I, bump: this.b, saturated: r.saturated, lost: false };
    return r.u;
  }
  get debug() { return { ...this._dbg }; }
}
