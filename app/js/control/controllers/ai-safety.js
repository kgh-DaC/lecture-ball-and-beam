// ai-safety.js — 학습 정책(nn-policy, q-policy) 공통 안전 래퍼 (ai-extension §5)
//
// 학습 정책은 학습 분포 밖에서 무엇을 할지 보장이 없다. 그래서 정책 출력을 그대로 쓰지 않고 아래 규칙으로 감싼다.
//   1) 관측: obs.PolicyObserver (학습 환경 train_env 와 같은 코드) → [e, v, u_prev],  e = ref − y_meas
//   2) 폴백 PD: pid(kp = fb_kp, ki = 0, kd = fb_kd, N = 8, 측정값 미분)를 매 스텝 "그림자"로 실행한다
//      (폴백 순간에 미분기가 이미 데워져 있어 전환이 매끄럽다).
//   3) 폴백 조건(우선순위 순):
//        no_policy  : 쓸 정책이 없음(번들·사용자 모두 없음)
//        nan_meas   : 측정 유실(NaN)이 3번 연속
//        range      : y_meas ∉ [y_lo, y_hi]
//        e_max      : |e| > e_max
//        nan_output : 정책 출력이 NaN/∞
//      조건이 생길 때마다 hold_s 타이머를 다시 건다. 복귀 = 타이머 끝 & |e| < e_max/2 & 범위 안 & 측정 정상 & 정책 출력 유한.
//   4) 유실 측정 1~2번: 직전 u 유지(controller-interface §3 규칙 2). nan_meas 폴백 중 계속 유실이면 u → 0(빔 수평):
//      측정 없이 기울기를 유지하면 이중 적분기 플랜트에서 공이 계속 가속되기 때문.
//   5) 출력 포화 |u| ≤ env.u_lim_rad (정책·폴백 모두). env.mode === 'device'(실기)일 때만 추가로
//      |u| ≤ angle_limit, |Δu| ≤ rate_limit·dt 를 강제한다(시뮬레이션·가상 장치는 학습 조건 그대로 u_lim 만).
//   6) 결정론적(난수 없음).
import { mergeParams, saturate, dtValid } from './common.js';
import Pid from './pid.js';
import { PolicyObserver } from '../ai/obs.js';

/** 안전 관련 ParamSpec (nn-policy, q-policy 공통; 키는 계약) */
export function aiSafetySpecs() {
  return [
    { key: 'e_max', label: '폴백 오차 한계', unit: 'm', type: 'number', min: 0.02, max: 0.30, step: 0.005, default: 0.12, device_max: 0.15,
      help: '|e| = |ref − y| 가 이 값을 넘으면 정책 대신 PD 로 폴백한다(학습 분포 밖 보호)' },
    { key: 'y_lo', label: '안전 범위 하한', unit: 'm', type: 'number', min: 0.0, max: 0.15, step: 0.005, default: 0.04,
      help: '측정 위치가 이 값보다 작으면 폴백(센서 쪽 빔 끝 보호)' },
    { key: 'y_hi', label: '안전 범위 상한', unit: 'm', type: 'number', min: 0.20, max: 0.34, step: 0.005, default: 0.31,
      help: '측정 위치가 이 값보다 크면 폴백(먼 쪽 빔 끝 보호)' },
    { key: 'fb_kp', label: '폴백 PD Kp', unit: 'rad/m', type: 'number', min: 0, max: 5, step: 0.01, default: 0.5,
      help: '폴백 제어기 = PD(kp, 0, kd, N 8, 측정값 미분). 기본값은 08장 서보 포함 재설계 PD' },
    { key: 'fb_kd', label: '폴백 PD Kd', unit: 'rad·s/m', type: 'number', min: 0, max: 5, step: 0.01, default: 1.25,
      help: '폴백 PD 미분 이득' },
    { key: 'angle_limit', label: '정책 각도 한계', unit: 'rad', type: 'number', min: 0.05, max: 0.5236, step: 0.005, default: 0.35, device_max: 0.35,
      help: '실기 모드에서만 강제하는 출력 각도 한계(시뮬레이션·가상 장치는 u_lim 만)' },
    { key: 'rate_limit', label: '정책 변화율 한계', unit: 'rad/s', type: 'number', min: 0.5, max: 20, step: 0.1, default: 4, device_max: 6,
      help: '실기 모드에서만 강제하는 출력 변화율 한계 |Δu|/dt' },
    { key: 'hold_s', label: '폴백 유지 시간', unit: 's', type: 'number', min: 0, max: 5, step: 0.1, default: 1.0,
      help: '폴백 조건이 사라진 뒤에도 이 시간 동안 PD 를 유지. 복귀 조건 |e| < e_max/2 & 범위 안' },
  ];
}

export const AI_DEBUG_KEYS = Object.freeze(['u_nn', 'u_pd', 'fallback', 'saturated']);
export const FALLBACK_REASONS = Object.freeze(['no_policy', 'nan_meas', 'range', 'e_max', 'nan_output']);
const LOST_LIMIT = 3;

/**
 * 공통 기반 클래스. 하위 클래스는 static meta 와 _resolvePolicy() → { policy: Policy|null, source: string } 만 정의한다.
 */
export class SafePolicyController {
  constructor(params = {}, env = {}) {
    this.env = { u_lim_rad: 0.5236, Ts_s: 0.06, mode: 'sim', ...env };
    this.params = mergeParams(this.constructor.meta.params, params);
    this._makePd();
    this.observer = new PolicyObserver();
    this._resolve();
    this.reset();
  }

  _makePd() {
    this.pd = new Pid({ kp: this.params.fb_kp, ki: 0, kd: this.params.fb_kd, n_filt: 8, d_on: 'measurement' }, this.env);
  }

  _resolve() {
    const r = this._resolvePolicy();
    this.policy = r.policy;
    this.policySource = r.source;
  }

  setParams(partial) {
    const old = this.params;
    this.params = mergeParams(this.constructor.meta.params, partial, this.params);
    if (old.fb_kp !== this.params.fb_kp || old.fb_kd !== this.params.fb_kd) {
      // PD 이득만 바꾸고 미분기 상태는 유지(그림자 실행 중이므로 전환 매끄러움 유지)
      this.pd.setParams({ kp: this.params.fb_kp, kd: this.params.fb_kd });
    }
    if (old.policy !== this.params.policy || old.smooth !== this.params.smooth) this._resolve();
  }

  reset(state0 = {}) {
    this._resolve(); // reset 때 사용자 정책(registerPolicy)이 새로 올라왔으면 반영
    this.pd.reset(state0);
    this.u = Number.isFinite(state0.u_rad) ? state0.u_rad : 0;
    this.observer.reset(NaN, this.u);
    this.t = 0;
    this.lostCount = 0;
    this.fb = false;
    this.fbUntil = -Infinity;
    this.fbReason = null;
    this._dbg = { u_nn: NaN, u_pd: 0, fallback: false, saturated: false, fallback_reason: null, policy_source: this.policySource,
      rate_limited: false, lost: false };
  }

  update(ref_m, y_m, dt_s, aux = {}) {
    if (!dtValid(dt_s)) return this.u; // 규칙 3
    const p = this.params;
    const lim = this.env.u_lim_rad;
    this.t += dt_s;
    const lost = !Number.isFinite(y_m) || !Number.isFinite(ref_m);
    this.lostCount = lost ? this.lostCount + 1 : 0;

    const uPd = this.pd.update(ref_m, y_m, dt_s, aux); // 그림자 PD (유실이면 PD 자체가 u 유지)
    const obs = this.observer.update(ref_m, y_m, dt_s, this.u);
    let uNn = NaN;
    if (this.policy) {
      try { uNn = this.policy.act(obs); } catch { uNn = NaN; }
    }

    const e = lost ? NaN : ref_m - y_m;
    let reason = null;
    if (!this.policy) reason = 'no_policy';
    else if (this.lostCount >= LOST_LIMIT) reason = 'nan_meas';
    else if (!lost && (y_m < p.y_lo || y_m > p.y_hi)) reason = 'range';
    else if (!lost && Math.abs(e) > p.e_max) reason = 'e_max';
    else if (!Number.isFinite(uNn)) reason = 'nan_output';

    if (reason) {
      this.fb = true;
      this.fbReason = reason;
      this.fbUntil = this.t + p.hold_s;
    } else if (this.fb) {
      const inRange = !lost && y_m >= p.y_lo && y_m <= p.y_hi;
      if (this.t >= this.fbUntil - 1e-9 && inRange && Math.abs(e) < p.e_max / 2) { this.fb = false; this.fbReason = null; }
    }

    let u;
    if (this.fb) {
      if (lost && this.lostCount >= LOST_LIMIT) u = 0; // 측정 없음: 빔 수평
      else u = uPd;
    } else if (lost) {
      u = this.u; // 유실 1~2번: 직전 u 유지
    } else {
      u = uNn;
    }
    if (!Number.isFinite(u)) u = this.u;

    // 포화와 (실기) 각도·변화율 제한
    let r = saturate(u, lim);
    u = r.u;
    let saturated = r.saturated;
    let rateLimited = false;
    if (this.env.mode === 'device') {
      const r2 = saturate(u, Math.min(lim, p.angle_limit));
      u = r2.u; saturated = saturated || r2.saturated;
      const du = p.rate_limit * dt_s;
      if (u > this.u + du) { u = this.u + du; rateLimited = true; }
      else if (u < this.u - du) { u = this.u - du; rateLimited = true; }
    }
    this.u = u;
    this._dbg = { u_nn: uNn, u_pd: uPd, fallback: this.fb, saturated, fallback_reason: this.fbReason, policy_source: this.policySource,
      rate_limited: rateLimited, lost };
    return u;
  }

  get debug() { return { ...this._dbg }; }
}
