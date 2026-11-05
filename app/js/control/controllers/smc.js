// smc.js — 슬라이딩모드 제어 (14장)
//
// 오차 e = y − ref (상태 좌표, metrics의 e = ref − y 와 부호 반대),  ref 는 구간별 상수.
// 슬라이딩 면  s = ė + λ·e        (면 위: ė = −λe → e 가 시정수 1/λ 로 0)
// 플랜트(공칭) ë = K̂_b·θ  →   u = u_eq + u_sw
//   u_eq = −λ·ė / K̂_b                     (s 를 일정하게 유지하는 등가 입력)
//   u_sw = −η·sat(s/Φ) / K̂_b  (switch='sat',  경계층 Φ)
//        = −η·sign(s)   / K̂_b  (switch='sign', 실기 금지: 서보 채터링)
// 도달 조건 s·ṡ ≤ −η|s| 는 |K_b/K̂_b − 1|·|λė| < η 이면 성립(서보·지연 무시). K_b 불확실성 ±30% 가정.
// 경계층 안에서는 선형 PD 와 같다:  kp_eff = ηλ/(ΦK̂_b),  kd_eff = (λ + η/Φ)/K̂_b.
// 60 ms 샘플링에서는 이상적인 슬라이딩이 안 되고 이산 채터링이 생긴다(docs/theory).
// ė 추정: 'diff' = 필터된 후진 차분(Tf 0.1 s), 'luenberger' = [y, ẏ] 2차 관측기(극점 −10, −10 rad/s, K̂_b 사용)
import { mergeParams, saturate, dtValid, FilteredDiff } from './common.js';

const OBS_POLE = 10; // rad/s

export default class Smc {
  static meta = {
    id: 'smc',
    label: '슬라이딩모드',
    family: 'modern',
    linear: false,
    params: [
      { key: 'lambda', label: 'λ', unit: '1/s', type: 'number', min: 0.1, max: 5, step: 0.05, default: 1.0,
        help: '슬라이딩 면 기울기. 면 위에서 오차가 시정수 1/λ 로 줄어든다' },
      { key: 'eta', label: 'η', unit: 'm/s²', type: 'number', min: 0, max: 2, step: 0.01, default: 0.1,
        help: '도달 속도. 모델 불확실성 상한보다 커야 한다' },
      { key: 'phi', label: 'Φ (경계층)', unit: 'm/s', type: 'number', min: 0.005, max: 0.5, step: 0.005, default: 0.05,
        device_max: undefined, help: '경계층 두께. 작을수록 정확하지만 채터링이 커진다' },
      { key: 'switch', label: '스위칭 함수', unit: '–', type: 'enum', default: 'sat',
        options: [{ value: 'sat', label: 'sat (경계층)' }, { value: 'sign', label: 'sign (시뮬레이션 전용)' }],
        device_allowed: ['sat'], help: 'sign 은 서보를 고주파로 떨게 해 기어를 손상시킨다 — 실기 금지' },
      { key: 'kb_nominal', label: 'K̂_b (공칭)', unit: 'm/s²/rad', type: 'number', min: 0.3, max: 2, step: 0.01, default: 0.8709,
        help: '제어기가 믿는 플랜트 이득. 실제와 다르게 두고 강인성을 시험해 볼 수 있다' },
      { key: 'observer', label: 'ė 추정', unit: '–', type: 'enum', default: 'luenberger',
        options: [{ value: 'diff', label: '필터 차분' }, { value: 'luenberger', label: 'Luenberger' }],
        help: '속도는 측정되지 않는다' },
    ],
    debug_keys: ['s', 'u_eq', 'u_sw', 'saturated'],
    needs_model: false,
  };

  constructor(params = {}, env = {}) {
    this.env = { u_lim_rad: 0.5236, Ts_s: 0.06, ...env };
    this.params = this._guard(mergeParams(Smc.meta.params, params));
    this.diff = new FilteredDiff(0.1);
    this.reset();
  }
  setParams(partial) { this.params = this._guard(mergeParams(Smc.meta.params, partial, this.params)); }

  /**
   * 안전장치(2중): 실기 모드(env.mode = 'device')에서는 switch = 'sign' 을 받지 않는다.
   * 러너·UI 가 device_allowed 로 먼저 막지만, 우회 경로(세션 불러오기, 코드 호출)가 있어도 제어기 스스로
   * 'sat' 로 바꾸고 debug.sign_blocked = true 를 남긴다. 서보 기어 손상(고주파 채터링) 방지.
   */
  _guard(p) {
    this.signBlocked = false;
    if (this.env.mode === 'device' && p.switch === 'sign') {
      this.signBlocked = true;
      return { ...p, switch: 'sat' };
    }
    return p;
  }
  reset(state0 = {}) {
    const y0 = Number.isFinite(state0.y_m) ? state0.y_m : NaN;
    this.yh = y0; this.vh = 0;
    this.u = Number.isFinite(state0.u_rad) ? state0.u_rad : 0;
    this.diff.reset(y0);
    this._dbg = { s: 0, u_eq: 0, u_sw: 0, e: 0, edot: 0, saturated: false, lost: false, sign_blocked: this.signBlocked };
  }

  /** 2차 관측기 한 스텝 (예측 → 보정). 연속 이득 l1 = 2p, l2 = p² 를 dt로 근사 */
  observe(y, dt) {
    const Kb = this.params.kb_nominal;
    // 예측 (u 는 ZOH)
    const a = Kb * this.u;
    let yh = this.yh + this.vh * dt + 0.5 * a * dt * dt;
    let vh = this.vh + a * dt;
    if (Number.isFinite(y)) {
      if (!Number.isFinite(yh)) { yh = y; vh = 0; }
      // 이산 관측기 이득: 오차 극점 z = e^{−p dt} (중근)
      const z = Math.exp(-OBS_POLE * dt);
      const l1 = 1 - z * z;
      const l2 = ((1 - z) ** 2) / dt;
      const r = y - yh;
      yh += l1 * r; vh += l2 * r;
    }
    this.yh = yh; this.vh = vh;
    return vh;
  }

  update(ref_m, y_m, dt_s, aux = {}) {
    const lim = this.env.u_lim_rad;
    if (!dtValid(dt_s)) return this.u;
    const yv = Number.isFinite(aux.y_raw_m) ? aux.y_raw_m : y_m;
    const lost = !Number.isFinite(yv);
    const p = this.params;
    let edot;
    if (p.observer === 'luenberger') edot = this.observe(lost ? NaN : yv, dt_s);
    else if (lost) { this._dbg = { ...this._dbg, lost: true }; return this.u; }
    else edot = this.diff.update(yv, dt_s);
    const yUse = lost ? this.yh : yv;
    if (!Number.isFinite(yUse)) { this._dbg = { ...this._dbg, lost: true }; return this.u; }
    const e = yUse - ref_m;
    const s = edot + p.lambda * e;
    const sw = p.switch === 'sign' ? Math.sign(s) : Math.max(-1, Math.min(1, s / p.phi));
    const u_eq = (-p.lambda * edot) / p.kb_nominal;
    const u_sw = (-p.eta * sw) / p.kb_nominal;
    const r = saturate(u_eq + u_sw, lim);
    this.u = r.u;
    this._dbg = { s, u_eq, u_sw, e, edot, saturated: r.saturated, lost, sign_blocked: this.signBlocked };
    return r.u;
  }
  get debug() { return { ...this._dbg }; }

  /** 경계층 안 등가 PD 게인 (설명·비교용) */
  static equivalentPD(params) {
    const { lambda, eta, phi, kb_nominal } = params;
    return { kp: (eta * lambda) / (phi * kb_nominal), kd: (lambda + eta / phi) / kb_nominal };
  }
}
