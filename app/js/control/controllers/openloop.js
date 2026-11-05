// openloop.js — 개루프 각도 출력 (03장 개루프 굴림)
import { mergeParams, saturate } from './common.js';

export default class OpenLoop {
  static meta = {
    id: 'openloop',
    label: '개루프 각도',
    family: 'utility',
    linear: false,
    params: [
      { key: 'theta', label: 'θ', unit: 'rad', type: 'number', min: -0.5236, max: 0.5236, step: 0.0017, default: 0.0349,
        device_max: 0.0873, help: '고정 서보 명령각. 0.0349 rad = 2°. 실기에서는 ±5° 이내(공이 빔 끝에 빠르게 닿는다)' },
    ],
    debug_keys: ['saturated'],
    needs_model: false,
  };

  constructor(params = {}, env = {}) {
    this.env = { u_lim_rad: 0.5236, ...env };
    this.params = mergeParams(OpenLoop.meta.params, params);
    this.reset();
  }
  setParams(partial) { this.params = mergeParams(OpenLoop.meta.params, partial, this.params); }
  reset() { this._dbg = { saturated: false, lost: false }; }
  update(ref_m, y_m) {
    const r = saturate(this.params.theta, this.env.u_lim_rad);
    this._dbg = { saturated: r.saturated, lost: Number.isNaN(y_m) };
    return r.u;
  }
  get debug() { return { ...this._dbg }; }
}
