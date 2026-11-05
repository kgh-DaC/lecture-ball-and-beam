// obs.js — 정책 관측 (ai-extension §2.3)
// 학습 환경(train_env.js)과 제어기(nn-policy, q-policy)가 같은 코드로 관측을 만든다.
// 그래야 시뮬레이터에서 학습한 정책이 러너(가상 장치·실기)에서도 같은 입력을 받는다.
//
//   e      = ref − y_meas                       [m]   (metrics 와 같은 부호)
//   v      = 필터된 후진 차분 ẏ̂ (Tf = 0.1 s)    [m/s] (초음파는 속도를 재지 않는다)
//   u_prev = 직전 명령각                          [rad] (서보 지연·관성의 정보)
// 유실 측정(NaN)이면 직전 y를 유지한다(관측이 NaN이 되지 않게). 몇 번 연속인지는 lost_count.

export const OBS_SPEC = Object.freeze({
  names: ['e', 'v', 'u_prev'],
  units: ['m', 'm/s', 'rad'],
  scale: [0.10, 0.30, 0.5236],
  Tf_s: 0.1,
});

export function normObs(o, spec = OBS_SPEC) { return o.map((v, i) => v / spec.scale[i]); }

export class PolicyObserver {
  constructor({ Tf_s = OBS_SPEC.Tf_s } = {}) { this.Tf = Tf_s; this.reset(); }
  reset(y0_m = NaN, u0_rad = 0) {
    this.yPrev = Number.isFinite(y0_m) ? y0_m : NaN;
    this.v = 0;
    this.uPrev = Number.isFinite(u0_rad) ? u0_rad : 0;
    this.lost_count = 0;
  }
  /** → [e, v, u_prev] */
  update(ref_m, y_m, dt_s, u_prev_rad = this.uPrev) {
    this.uPrev = Number.isFinite(u_prev_rad) ? u_prev_rad : this.uPrev;
    let y = y_m;
    if (!Number.isFinite(y)) { this.lost_count += 1; y = this.yPrev; } else this.lost_count = 0;
    if (Number.isFinite(y) && Number.isFinite(this.yPrev) && dt_s > 0 && Number.isFinite(y_m)) {
      const den = this.Tf + dt_s;
      this.v = (this.Tf / den) * this.v + (y - this.yPrev) / den;
    }
    if (Number.isFinite(y)) this.yPrev = y;
    const e = Number.isFinite(y) && Number.isFinite(ref_m) ? ref_m - y : 0;
    return [e, this.v, this.uPrev];
  }
}
