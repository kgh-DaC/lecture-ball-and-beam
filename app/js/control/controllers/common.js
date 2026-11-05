// common.js — 제어기 공통 도구 (controller-interface.md §3 규칙 구현)

/** meta.params 기본값 + 사용자 값 병합. 모르는 키는 무시하고, number는 min/max로 자른다. */
export function mergeParams(specs, given = {}, base = null) {
  const out = {};
  for (const sp of specs) {
    let v = given[sp.key];
    if (v === undefined) v = base ? base[sp.key] : sp.default;
    if (sp.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) v = base ? base[sp.key] : sp.default;
      if (sp.min !== undefined) v = Math.max(sp.min, v);
      if (sp.max !== undefined) v = Math.min(sp.max, v);
    } else if (sp.type === 'bool') {
      v = Boolean(v);
    } else if (sp.type === 'enum') {
      if (!sp.options.some((o) => o.value === v)) v = base ? base[sp.key] : sp.default;
    }
    out[sp.key] = v;
  }
  return out;
}

/** 포화: |u| ≤ lim → { u, saturated } */
export function saturate(u, lim) {
  if (u > lim) return { u: lim, saturated: true };
  if (u < -lim) return { u: -lim, saturated: true };
  return { u, saturated: false };
}

/** dt 유효성 (규칙 3): dt ≤ 0 또는 > 1 이면 false */
export function dtValid(dt) { return Number.isFinite(dt) && dt > 0 && dt <= 1; }

/**
 * 필터된 후진 차분 미분기: v ≈ s/(Tf s + 1) · x
 * 이산화(후진 오일러): v_k = Tf/(Tf+dt) · v_{k−1} + (x_k − x_{k−1})/(Tf+dt)
 * Tf = 0 이면 순수 후진 차분.
 */
export class FilteredDiff {
  constructor(Tf = 0) { this.Tf = Tf; this.reset(NaN); }
  reset(x0) { this.prev = x0; this.v = 0; }
  update(x, dt) {
    if (!Number.isFinite(this.prev)) { this.prev = x; return this.v; }
    const den = this.Tf + dt;
    this.v = (this.Tf / den) * this.v + (x - this.prev) / den;
    this.prev = x;
    return this.v;
  }
}

/** 단위 문자열 상수 (ParamSpec.unit) */
export const U = {
  kp: 'rad/m', ki: 'rad/(m·s)', kd: 'rad·s/m', m: 'm', rad: 'rad', s: 's', none: '–',
};

/** 공통 PID 계열 ParamSpec 생성기 */
export function pidSpecs(prefix = '', defaults = { kp: 0.574, ki: 0, kd: 0.994 }, labelSuffix = '') {
  return [
    { key: `kp${prefix}`, label: `Kp${labelSuffix}`, unit: U.kp, type: 'number', min: 0, max: 10, step: 0.01, default: defaults.kp,
      help: '비례 이득. 1 rad/m = 공이 1 cm 벗어나면 0.57° 기울임' },
    { key: `ki${prefix}`, label: `Ki${labelSuffix}`, unit: U.ki, type: 'number', min: 0, max: 5, step: 0.001, default: defaults.ki,
      device_max: 2, help: '적분 이득. 이중 적분기 플랜트는 계단 입력에 정상상태 오차가 없으므로 Ki는 기울기 편차(영점 오프셋) 제거용으로만 약하게' },
    { key: `kd${prefix}`, label: `Kd${labelSuffix}`, unit: U.kd, type: 'number', min: 0, max: 10, step: 0.01, default: defaults.kd,
      help: '미분 이득. 이중 적분기에서는 감쇠를 만드는 필수 항' },
  ];
}
