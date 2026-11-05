// mrac.js — 모델 기준 적응 PD (MIT rule, 정규화 + 투영) — 12장
//
// 기준 모델:   ÿ_m = ωn²(r − y_m) − 2ζωn ẏ_m          (원하는 폐루프 응답)
// 제어 법칙:   u = kp·(r − y) − kd·ẏ_f
// 감도 근사:   ∂y/∂kp ≈ F(s)·(r − y),  ∂y/∂kd ≈ F(s)·(−ẏ_f),   F(s) = ωn²/(s² + 2ζωn s + ωn²)
// MIT rule:    k̇p = −γ·e_m·σp / (1 + σp² + σd²·…),  k̇d = −γ·e_m·σd / (…),   e_m = y − y_m
//              (정규화로 신호 크기에 덜 민감하게; 단위를 맞추기 위해 σ를 0.05 m 기준으로 나눈다)
// 투영:        kp ∈ [kp_min, kp_max], kd ∈ [kd_min, kd_max]
// γ가 크면 적응이 빨라지지만 지연·포화와 겹쳐 게인이 진동·발산할 수 있다(12장 과제).
import { mergeParams, saturate, dtValid, FilteredDiff, U } from './common.js';

const SIG_REF = 0.05; // 정규화 기준 크기 [m]

export default class Mrac {
  static meta = {
    id: 'mrac',
    label: 'MRAC (MIT rule)',
    family: 'adaptive',
    linear: false,
    params: [
      { key: 'zeta_ref', label: 'ζ (기준 모델)', unit: '–', type: 'number', min: 0.3, max: 1.5, step: 0.05, default: 0.9, help: '기준 모델 감쇠비' },
      { key: 'wn_ref', label: 'ωn (기준 모델)', unit: 'rad/s', type: 'number', min: 0.3, max: 4, step: 0.05, default: 1.2, help: '기준 모델 고유진동수. 서보·센서 지연 때문에 너무 빠르게 잡으면 따라갈 수 없다' },
      { key: 'gamma', label: 'γ (적응 이득)', unit: '–', type: 'number', min: 0, max: 20, step: 0.1, default: 3.0, device_max: 5,
        help: '크면 빠르게 적응하지만 불안정해질 수 있다. 시뮬레이션(가정 서보)에서 3 이면 계단 4~5번 뒤 기준 모델 추종 오차가 고정 게인보다 작아진다' },
      { key: 'kp0', label: 'Kp 초기값', unit: U.kp, type: 'number', min: 0, max: 10, step: 0.01, default: 1.0, help: '' },
      { key: 'kd0', label: 'Kd 초기값', unit: U.kd, type: 'number', min: 0, max: 10, step: 0.01, default: 1.5, help: '' },
      { key: 'kp_min', label: 'Kp 하한', unit: U.kp, type: 'number', min: 0, max: 10, step: 0.01, default: 0.2, help: '투영 하한' },
      { key: 'kp_max', label: 'Kp 상한', unit: U.kp, type: 'number', min: 0, max: 10, step: 0.01, default: 4, help: '투영 상한' },
      { key: 'kd_min', label: 'Kd 하한', unit: U.kd, type: 'number', min: 0, max: 10, step: 0.01, default: 0.5, help: '투영 하한' },
      { key: 'kd_max', label: 'Kd 상한', unit: U.kd, type: 'number', min: 0, max: 10, step: 0.01, default: 5, help: '투영 상한' },
    ],
    debug_keys: ['kp', 'kd', 'y_ref_model', 'saturated'],
    needs_model: false,
  };

  constructor(params = {}, env = {}) {
    this.env = { u_lim_rad: 0.5236, Ts_s: 0.06, ...env };
    this.params = mergeParams(Mrac.meta.params, params);
    this.diff = new FilteredDiff(0.1);
    this.reset();
  }
  setParams(partial) { this.params = mergeParams(Mrac.meta.params, partial, this.params); }
  reset(state0 = {}) {
    const p = this.params;
    this.kp = Math.min(p.kp_max, Math.max(p.kp_min, p.kp0));
    this.kd = Math.min(p.kd_max, Math.max(p.kd_min, p.kd0));
    const y0 = Number.isFinite(state0.y_m) ? state0.y_m : NaN;
    this.ym = y0; this.ymd = 0;              // 기준 모델 상태
    this.sp = [0, 0]; this.sd = [0, 0];      // 감도 필터 상태 [값, 미분]
    this.u = Number.isFinite(state0.u_rad) ? state0.u_rad : 0;
    this.diff.reset(y0);
    this._dbg = { kp: this.kp, kd: this.kd, y_ref_model: y0, e_m: 0, saturated: false, lost: false };
  }

  /** 2차 필터 F(s) 한 스텝 (반암시적 오일러) */
  static filt(st, x, wn, z, dt) {
    const acc = wn * wn * (x - st[0]) - 2 * z * wn * st[1];
    st[1] += acc * dt;
    st[0] += st[1] * dt;
  }

  update(ref_m, y_m, dt_s, aux = {}) {
    const lim = this.env.u_lim_rad;
    if (!Number.isFinite(y_m) || !Number.isFinite(ref_m)) { this._dbg = { ...this._dbg, lost: true }; return this.u; }
    if (!dtValid(dt_s)) return this.u;
    const p = this.params;
    if (!Number.isFinite(this.ym)) this.ym = y_m;
    // 기준 모델 (작은 내부 스텝으로 적분해 dt = 60 ms에서도 정확하게)
    const nsub = Math.max(1, Math.ceil(dt_s / 0.01));
    const h = dt_s / nsub;
    for (let k = 0; k < nsub; k++) {
      const acc = p.wn_ref ** 2 * (ref_m - this.ym) - 2 * p.zeta_ref * p.wn_ref * this.ymd;
      this.ymd += acc * h; this.ym += this.ymd * h;
    }
    const ydot = this.diff.update(Number.isFinite(aux.y_raw_m) ? aux.y_raw_m : y_m, dt_s);
    const e = ref_m - y_m;
    for (let k = 0; k < nsub; k++) {
      Mrac.filt(this.sp, e, p.wn_ref, p.zeta_ref, h);
      Mrac.filt(this.sd, -ydot, p.wn_ref, p.zeta_ref, h);
    }
    const em = y_m - this.ym;
    const sp = this.sp[0] / SIG_REF, sd = this.sd[0] / SIG_REF; // 무차원화
    const norm = 1 + sp * sp + sd * sd;
    // 포화 중에는 적응을 멈춘다(포화된 입력은 게인 변화의 효과를 가린다)
    if (!this._dbg.saturated) {
      this.kp += (-p.gamma * (em / SIG_REF) * sp / norm) * dt_s;
      this.kd += (-p.gamma * (em / SIG_REF) * sd / norm) * dt_s;
    }
    this.kp = Math.min(p.kp_max, Math.max(p.kp_min, this.kp));
    this.kd = Math.min(p.kd_max, Math.max(p.kd_min, this.kd));
    const r = saturate(this.kp * e - this.kd * ydot, lim);
    this.u = r.u;
    this._dbg = { kp: this.kp, kd: this.kd, y_ref_model: this.ym, e_m: em, saturated: r.saturated, lost: false };
    return r.u;
  }
  get debug() { return { ...this._dbg }; }
}
