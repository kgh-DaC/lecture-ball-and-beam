// 거리 이상값 제거(despike) + 재귀 필터 — firmware/ball_beam/dist_filter.h 의 JS 판(protocol.md 1.1.0 §3.1).
// firmware/tools/fake_device.py 의 DistFilter 와 같은 규칙·상수. 부동소수는 Math.fround 로 C float(32 비트)를 흉내 낸다.
// 가상 장치(virtual-device.js)와 장치 점검 위젯의 "호스트에서 다시 거르기"가 함께 쓴다.

export const DF_OFF = 0;
export const DF_MED3 = 1;
export const DF_GATE = 2;
export const DF_MODE_MAX = 2;
export const DF_GATE_MM = 60;
export const DF_GATE_MAX_REJ = 3;
export const DF_RESET_LOST = 3;
export const DEFAULT_DESPIKE = DF_GATE;
/** 화면 이름 */
export const DESPIKE_LABEL = { 0: '꺼짐', 1: '중간값 3 (median3)', 2: '게이트 (gate, 기본)' };

const f32 = Math.fround;
export const median3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

export class DistFilter {
  constructor() { this.init(); }
  /** 전체 초기화(부팅) */
  init() { this.f = 0; this.fValid = false; this.lostRun = 0; this.nRejected = 0; this.resetDespike(); }
  /** despike 상태만 비운다(재귀 필터 값 유지) */
  resetDespike() { this.win = [0, 0, 0]; this.n = 0; this.head = 0; this.ref = 0; this.hasRef = false; this.rej = 0; }
  /** 손으로 놓고 충분히 기다린 상태로 맞춘다(가상 장치 placeBall 전용 — 펌웨어에는 없음) */
  settle(x_mm) {
    const x = Math.round(x_mm);
    this.resetDespike();
    this.win = [x, x, x]; this.n = 3; this.ref = x; this.hasRef = true;
    this.f = f32(x); this.fValid = true; this.lostRun = 0;
  }

  /** despike 한 단계. 반환: 필터에 넣을 값(≥ 0), 넣지 않으면 -1 */
  despike(x, mode) {
    if (x < 0) {
      if (this.lostRun < 255) this.lostRun++;
      if (this.lostRun >= DF_RESET_LOST) this.resetDespike();
      return -1;
    }
    this.lostRun = 0;
    if (mode === DF_MED3) {
      this.win[this.head] = x;
      this.head = (this.head + 1) % 3;
      if (this.n < 3) this.n++;
      if (this.n < 3) return -1;
      const m = median3(this.win[0], this.win[1], this.win[2]);
      if (m !== x) this.nRejected++;
      return m;
    }
    if (mode === DF_GATE) {
      if (!this.hasRef) {
        this.win[this.n] = x;
        this.n++;
        if (this.n < 3) return -1;
        this.ref = median3(this.win[0], this.win[1], this.win[2]);
        this.hasRef = true; this.rej = 0; this.n = 0;
        if (Math.abs(x - this.ref) > DF_GATE_MM) { this.nRejected++; return this.ref; }
        this.ref = x;
        return x;
      }
      if (Math.abs(x - this.ref) > DF_GATE_MM && this.rej < DF_GATE_MAX_REJ) {
        this.rej++; this.nRejected++;
        return -1;
      }
      this.rej = 0;
      this.ref = x;
      return x;
    }
    return x; // DF_OFF (또는 알 수 없는 값)
  }

  /** 한 측정 처리: despike → 재귀 필터. alpha = 1~1000 (×1/1000) */
  update(x, mode, alpha) {
    const y = this.despike(x, mode);
    if (y < 0) return;
    if (!this.fValid) { this.f = f32(y); this.fValid = true; return; }
    const a = f32(alpha / 1000);
    this.f = f32(f32(this.f * f32(1 - a)) + f32(y * a));
  }

  /** D 줄 filt_mm: (long)(f + 0.5), 한 번도 없으면 -1 */
  output() { return this.fValid ? Math.trunc(f32(this.f + 0.5)) : -1; }
}

/** 배열 전체를 거른다(순수). xs: 원측정(-1 = 유실), 반환 filt 배열(-1 = 아직 없음) */
export function filterSeries(xs, mode = DEFAULT_DESPIKE, alpha = 200) {
  const d = new DistFilter();
  return xs.map((x) => { d.update(Number.isFinite(x) ? x : -1, mode, alpha); return d.output(); });
}
