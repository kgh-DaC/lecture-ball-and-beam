// sensor.js — 디지털 트윈의 초음파 센서(HC-SR04) + 펌웨어 필터 + 포텐쇼미터 (순수 모듈)
//
// 한 번의 측정(펌웨어 주기 fs ≥ 60 ms, 지터 jitter_ms):
//   참값 y(t − T_sensor) [mm] × scale(음속 오차)   — y = 센서 면→공의 가까운 표면 거리(HC-SR04 첫 반사).
//                                                     공 중심이 아니다(중심 = y + R, twin.js centerMm)
//   → 고장 상태(stuck/dropout/bias/outlier_burst/outlier_rate)
//   → 이상값: 확률 p_out 으로 y_out ± σ_out (과거 실기에서 ~304 mm로 튀던 값을 흉내)
//   → 가우시안 잡음 σ → 정수 mm 양자화(quant_mm)
//   → 유실: 확률 p_lost 또는 유효 범위(range_min_mm ~ range_max_mm) 밖이면 −1 (펌웨어는 클램프하지 않는다)
// 펌웨어 1.1.0 거리 필터: 이상값 제거 despike(0 끔 / 1 median3 / 2 gate) → 재귀 필터 f ← f(1−α) + yα
//   (유실·버림이면 갱신 안 함, protocol §3·§3.1, firmware/ball_beam/dist_filter.h 와 같은 규칙)
// 포텐쇼미터: θ_m(출력축) → 캘리브레이션 역변환 raw + 잡음(LSB) → 0~1023 정수
//
// 난수는 독립 스트림(noise / event / jitter / pot)으로 나눠, 한 요소를 바꿔도 다른 요소의 난수열이 밀리지 않게 한다.

/** 결정론적 난수(mulberry32) + 정규분포 */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0;
    while (u === 0) u = uniform();
    const v = uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { uniform, normal };
}

/** 시드 + 스트림 이름 → 하위 시드(FNV-1a 섞기) */
export function subSeed(seed, name) {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= seed >>> 16; h = Math.imul(h, 0x01000193) >>> 0;
  return h || 1;
}

export const FAULT_TYPES = ['outlier_burst', 'outlier_rate', 'dropout', 'stuck', 'bias'];

export class UltrasonicSensor {
  /** @param sensor normalizeParams(...).sensor, @param seed 정수 */
  constructor(sensor, seed = 1) {
    this.p = sensor;
    this.seed = seed;
    this.reset();
  }

  reset() {
    this.rNoise = makeRng(subSeed(this.seed, 'sensor.noise'));
    this.rEvent = makeRng(subSeed(this.seed, 'sensor.event'));
    this.rJitter = makeRng(subSeed(this.seed, 'sensor.jitter'));
    this.faults = [];          // [{ type, t0, t1, n_left, value_mm, prob, offset_mm }]
    this.last_valid_mm = -1;
    this.n = 0;
  }

  /** 다음 측정까지의 간격 [s] (fs + 지터) */
  nextInterval(fs_ms) {
    const j = this.p.jitter_ms > 0 ? this.rJitter.uniform() * this.p.jitter_ms : 0;
    return (fs_ms + j) / 1000;
  }

  /**
   * 고장 주입. fault = { type, t_s, duration_s?, n?, prob?, value_mm?, offset_mm? }
   *  outlier_burst: 다음 n 번 측정이 이상값(value_mm, 기본 p.outlier_mm)
   *  outlier_rate : duration_s 동안 이상값 확률을 prob 로
   *  dropout      : duration_s 동안 모든 측정 유실(−1)
   *  stuck        : duration_s 동안 마지막 유효값을 반복
   *  bias         : duration_s 동안 offset_mm 더함(센서가 밀림·기울어짐)
   */
  addFault(fault, t_s) {
    if (!FAULT_TYPES.includes(fault.type)) throw new Error(`센서 고장 type 알 수 없음: ${fault.type}`);
    const t0 = fault.t_s ?? t_s;
    const dur = fault.duration_s ?? (fault.type === 'outlier_burst' ? Infinity : 1);
    this.faults.push({
      type: fault.type, t0, t1: t0 + dur,
      n_left: fault.type === 'outlier_burst' ? (fault.n ?? 3) : Infinity,
      value_mm: fault.value_mm ?? this.p.outlier_mm,
      prob: fault.prob ?? 0.15,
      offset_mm: fault.offset_mm ?? 0,
    });
  }

  clearFaults() { this.faults = []; }

  _active(t) { return this.faults.filter((f) => t >= f.t0 && t < f.t1 && f.n_left > 0); }

  /**
   * 한 번 측정
   * @param t_s 측정 시각, @param y_true_m 센서가 보는 참값(지연 반영해 호출자가 준다)
   * @returns {{ dist_mm: number, lost: boolean, outlier: boolean, fault: string|null }}
   */
  sample(t_s, y_true_m) {
    const p = this.p;
    this.n++;
    const act = this._active(t_s);
    let fault = null;
    // 난수는 항상 같은 개수만큼 뽑는다(고장 유무와 무관하게 이후 난수열이 같도록)
    const uLost = this.rEvent.uniform();
    const uOut = this.rEvent.uniform();
    const gOut = this.rNoise.normal();
    const gNoise = this.rNoise.normal();

    if (act.some((f) => f.type === 'dropout')) return { dist_mm: -1, lost: true, outlier: false, fault: 'dropout' };
    if (act.some((f) => f.type === 'stuck') && this.last_valid_mm >= 0) {
      return { dist_mm: this.last_valid_mm, lost: false, outlier: false, fault: 'stuck' };
    }
    let mm = y_true_m * 1000 * (p.scale ?? 1);
    for (const f of act) if (f.type === 'bias') { mm += f.offset_mm; fault = 'bias'; }
    let outlier = false;
    const burst = act.find((f) => f.type === 'outlier_burst');
    let pOut = p.outlier_prob || 0;
    for (const f of act) if (f.type === 'outlier_rate') { pOut = Math.max(pOut, f.prob); fault = 'outlier_rate'; }
    let outVal = p.outlier_mm;
    if (burst) { outlier = true; outVal = burst.value_mm; burst.n_left--; fault = 'outlier_burst'; }
    else if (uOut < pOut) outlier = true;
    if (outlier) mm = outVal + (p.outlier_sd_mm || 0) * gOut;
    else if (p.noise_mm > 0) mm += p.noise_mm * gNoise;
    // quant_mm > 0 이면 양자화(공칭 1 mm = 펌웨어 정수 mm). 0 이면 실수 그대로(선형 극한 시험용)
    const dist = p.quant_mm > 0 ? Math.round(mm / p.quant_mm) * p.quant_mm : mm;
    const lost = (!outlier && uLost < (p.lost_prob || 0)) || dist < p.range_min_mm || dist > p.range_max_mm;
    if (lost) return { dist_mm: -1, lost: true, outlier: false, fault };
    this.last_valid_mm = dist;
    return { dist_mm: dist, lost: false, outlier, fault };
  }
}

// ------------------------------------------------------------------ 펌웨어 거리 필터 (1.1.0)
// firmware/ball_beam/dist_filter.h 를 그대로 옮긴 것(protocol §3.1). 상수·분기 순서가 같아야 한다.
//   x ──► [despike] ──► y ──► [재귀 필터 f ← f(1−α) + yα] ──► filt_mm
//   despike 0 끔(1.0.0 과 같음) / 1 median3 / 2 gate(기본 펌웨어 값)
// 난수를 쓰지 않는 결정적 단계라 센서 난수 스트림에 영향이 없다.
export const DESPIKE_OFF = 0;
export const DESPIKE_MED3 = 1;
export const DESPIKE_GATE = 2;
export const DESPIKE_MODES = Object.freeze([DESPIKE_OFF, DESPIKE_MED3, DESPIKE_GATE]);
export const DF_GATE_MM = 60;        // gate 문턱 [mm]
export const DF_GATE_MAX_REJ = 3;    // gate 연속 버림 최대 횟수
export const DF_RESET_LOST = 3;      // 유실이 이만큼 이어지면 despike 상태 초기화

/** dist_filter.h df_median3 와 같은 결과 */
export function median3(a, b, c) {
  if (a > b) { const t = a; a = b; b = t; }
  if (b > c) b = c;
  return a > b ? a : b;
}

export function checkDespike(mode) {
  if (!DESPIKE_MODES.includes(mode)) throw new Error(`despike 는 0(끔) | 1(median3) | 2(gate) (받은 값 ${mode})`);
  return mode;
}

/** 이상값 제거 단계만 (dist_filter.h df_despike). push(x) → 필터에 넣을 값, 넣지 않으면 −1 */
export class Despike {
  constructor(mode = DESPIKE_OFF) { this.mode = checkDespike(mode); this.lostRun = 0; this.nRejected = 0; this.resetState(); }
  /** despike 상태만 비운다(df_resetDespike) */
  resetState() { this.win = [0, 0, 0]; this.n = 0; this.head = 0; this.ref = 0; this.hasRef = false; this.rej = 0; }
  /** 전체 초기화(df_init 중 despike 부분) */
  reset() { this.lostRun = 0; this.nRejected = 0; this.resetState(); }
  /** P,despike 변경: 상태만 비운다(펌웨어와 같음) */
  setMode(mode) { this.mode = checkDespike(mode); this.resetState(); }
  push(x) {
    if (!(x >= 0)) {                                  // 유실
      if (this.lostRun < 255) this.lostRun++;
      if (this.lostRun >= DF_RESET_LOST) this.resetState();
      return -1;
    }
    this.lostRun = 0;
    if (this.mode === DESPIKE_MED3) {
      this.win[this.head] = x;
      this.head = (this.head + 1) % 3;
      if (this.n < 3) this.n++;
      if (this.n < 3) return -1;                       // 창이 차기 전에는 넣지 않는다
      const m = median3(this.win[0], this.win[1], this.win[2]);
      if (m !== x) this.nRejected++;
      return m;
    }
    if (this.mode === DESPIKE_GATE) {
      if (!this.hasRef) {                              // 시작: 유효 측정 3개의 중앙값을 기준으로
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
        this.rej++;
        this.nRejected++;
        return -1;                                     // 버림: 필터 갱신 안 함
      }
      this.rej = 0;
      this.ref = x;
      return x;
    }
    return x;                                          // 끔
  }
}

/**
 * 펌웨어 거리 필터 (protocol §3 D 필드 filt_mm, §3.1 despike)
 * @param alpha_milli 1~1000, @param integer 정수 mm 출력(펌웨어), @param despike 0|1|2 (기본 0 = 1.0.0 과 비트 단위 같음)
 * 재귀 필터는 배정밀도로 계산한다(펌웨어는 float32 — 출력 반올림에서 드물게 1 mm 차이 가능).
 */
export class FirmwareFilter {
  constructor(alpha_milli = 200, integer = true, despike = DESPIKE_OFF) {
    this.alpha_milli = alpha_milli; this.integer = integer; this.f = -1;
    this.despike = new Despike(despike);
    this.lastRejected = false;   // 직전 push 에서 despike 가 원측정을 바꾸거나 버렸나(dist_filter.h nRejected 가 늘었나)
  }
  get despikeMode() { return this.despike.mode; }
  setDespike(mode) { this.despike.setMode(mode); }
  reset() { this.f = -1; this.despike.reset(); this.lastRejected = false; }
  push(dist_mm) {
    const n0 = this.despike.nRejected;
    const y = this.despike.push(dist_mm);              // 끔이면 x 그대로(유실 연속 횟수만 센다 — 펌웨어와 같음)
    this.lastRejected = this.despike.nRejected !== n0; // 펌웨어 nRejected 와 같은 뜻(시작 기준 모으기는 세지 않음)
    if (y >= 0) {
      const a = this.alpha_milli / 1000;
      this.f = this.f < 0 ? y : this.f * (1 - a) + y * a;
    }
    if (this.f < 0) return -1;
    return this.integer ? Math.round(this.f) : this.f;
  }
}

/** 포텐쇼미터 원값: 출력축 θ_m [rad] → raw (캘리브레이션 cdeg = c·raw² + a·raw + b 의 1차 역변환) */
export function potRaw(theta_m_rad, cal, noise_lsb, rng) {
  const cdeg = (theta_m_rad * 18000) / Math.PI;
  const raw = (cdeg - cal.b_cdeg) / cal.a_cdeg_per_lsb + (noise_lsb > 0 && rng ? rng.normal() * noise_lsb : 0);
  return Math.max(0, Math.min(1023, Math.round(raw)));
}

/** raw → cdeg (러너와 같은 식, identification.potToCdeg 와 동일) */
export function potToCdeg(raw, cal) {
  return (cal.c || 0) * raw * raw + cal.a_cdeg_per_lsb * raw + cal.b_cdeg;
}

/** HS5645MG 프리셋 캘리브레이션(슬라이드 67, servo-presets.js 와 같은 식) */
export const PRESET_POT_CAL = Object.freeze({
  order: 1, a_cdeg_per_lsb: -18000 / (555 - 60.9), b_cdeg: (18000 / (555 - 60.9)) * 555 - 9000, c: 0,
});
