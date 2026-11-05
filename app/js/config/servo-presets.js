// 서보 프리셋 (architecture.md §4). 펌웨어 상단 프리셋 표와 같은 값을 가진다. 모르는 값은 null(실측 필요).
//
// 포텐쇼미터 기본 보정(pot_preset)은 '서보 혼 각도' 기준이다:
//   앱 좌표 규약 deg_servo = 90 + trim/100 + dir·cmd/100 (firmware/ball_beam/ball_beam.ino, cmdToMicros)
//   → 직선이 주는 값 horn = (서보각 − 90°)·100 [cdeg]. 명령 좌표 θ 는 이것을 뒤집어 θ_cmd = dir·(horn − trim) 으로 얻는다
//   (loop/runner.js potToCdeg, data-schema §4.2). 빔의 실제 수평은 조립 후 trim(level-trim 위젯)으로 맞춘다.
//   조립 방법(혼을 끼운 각도)에 따라 수평 서보각은 90°에서 벗어날 수 있다(사용자 장치 실측 83° → trim −700, LEVEL_MEASURED_USER).

/**
 * HS-5645MG 포텐쇼미터 실측(사용자 제공, 2026-11-04): 서보각 0/90/180°로 각각 10회 이동 → 매번 A0 를 읽어 평균.
 * σ 는 사용자가 기록하지 않았다(null). 이 데이터에서 raw 는 서보각과 함께 '증가'한다.
 * 예전 슬라이드 67 임시값 map(pot, 555, 60.9, 0, 180)은 raw 가 '감소'하는 방향이었다 — 포텐쇼미터 양 끝(5V/GND) 배선 방향이
 * 그 장치와 반대이기 때문이다. 이 앱은 실측을 기준으로 한다(LEGACY_SLIDE67_POT 은 비교용으로만 남긴다).
 */
export const POT_MEASURED_HS5645MG = Object.freeze({
  date: '2026-11-04',
  servo_model: 'HS5645MG',
  method: '서보각 0/90/180°를 각 10회 이동·정착 후 A0 측정, 점별 평균(사용자 실측)',
  source: '사용자 실측(2026-11-04, 0/90/180°, 각 n=10)',
  provenance: 'measured',
  points: Object.freeze([
    Object.freeze({ servo_deg: 0, raw_mean: 60, raw_sd: null, n: 10 }),
    Object.freeze({ servo_deg: 90, raw_mean: 330, raw_sd: null, n: 10 }),
    Object.freeze({ servo_deg: 180, raw_mean: 598, raw_sd: null, n: 10 }),
  ]),
});

/** 예전 임시값(슬라이드 67, raw 감소 방향). 비교·문서용 — 앱 변환에는 쓰지 않는다 */
export const LEGACY_SLIDE67_POT = Object.freeze({ order: 1, a_cdeg_per_lsb: -18000 / (555 - 60.9), b_cdeg: (18000 / (555 - 60.9)) * 555 - 9000, c: 0, source: '슬라이드 67 (캘리브레이션 전 임시값, raw 감소 방향)' });

/**
 * 서보각(°) → raw 최소제곱 직선(순수). 서보각은 명령이라 오차가 없다고 보고 raw 를 서보각에 회귀한다(raw = r0 + k·deg).
 * points: [{ servo_deg, raw_mean }] (2점 이상, 서보각이 모두 같으면 null)
 * 반환 { slope_lsb_per_deg: k, raw_at_0, raw_at_90, a_cdeg_per_lsb, b_cdeg, c: 0, order: 1, residuals_lsb, residual_max_lsb, monotonic: 'up'|'down'|'none' }
 *   a, b 는 명령 좌표 변환식 cdeg = a·raw + b (data-schema §4.2, trim 0·dir 1 기준 혼 각도)
 */
export function fitPotLine(points) {
  const P = (points || []).filter((p) => Number.isFinite(p.servo_deg) && Number.isFinite(p.raw_mean));
  if (P.length < 2) return null;
  const n = P.length;
  const mx = P.reduce((s, p) => s + p.servo_deg, 0) / n;
  const my = P.reduce((s, p) => s + p.raw_mean, 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of P) { sxy += (p.servo_deg - mx) * (p.raw_mean - my); sxx += (p.servo_deg - mx) ** 2; }
  if (sxx === 0) return null;
  const k = sxy / sxx;
  const r0 = my - k * mx;
  const r90 = r0 + k * 90;
  const residuals = P.map((p) => p.raw_mean - (r0 + k * p.servo_deg));
  const S = P.slice().sort((a, b) => a.servo_deg - b.servo_deg);
  let up = true, down = true;
  for (let i = 1; i < S.length; i++) { if (!(S[i].raw_mean > S[i - 1].raw_mean)) up = false; if (!(S[i].raw_mean < S[i - 1].raw_mean)) down = false; }
  return {
    order: 1, c: 0,
    slope_lsb_per_deg: k, raw_at_0: r0, raw_at_90: r90,
    a_cdeg_per_lsb: k !== 0 ? 100 / k : NaN,
    b_cdeg: k !== 0 ? -(100 / k) * r90 : NaN,
    residuals_lsb: residuals,
    residual_max_lsb: Math.max(...residuals.map(Math.abs)),
    monotonic: up ? 'up' : down ? 'down' : 'none',
  };
}

/** 보정 직선(cdeg = a·raw + b)에서 서보각(°)일 때 기대 raw(순수, 혼 각도 기준) */
export function rawAtServoDeg(deg, cal) {
  if (!cal || !Number.isFinite(cal.a_cdeg_per_lsb) || cal.a_cdeg_per_lsb === 0) return NaN;
  return ((deg - 90) * 100 - cal.b_cdeg) / cal.a_cdeg_per_lsb;
}

// 실측에서 계산: 기울기 ≈ 2.989 LSB/° (≈ +33.457 cdeg/LSB), 90° raw ≈ 329.33, 잔차 최대 ≈ 0.67 LSB(90° 점)
const MEASURED_FIT = fitPotLine(POT_MEASURED_HS5645MG.points);

// ------------------------------------------------------------------ 서보각 ↔ trim ↔ cmd 환산 (펌웨어 deg_servo = 90 + trim/100 + dir·cmd/100)
export const TRIM_LIMIT_CDEG = 1500; // protocol §4: trim ±15°

/** 수평 서보각(°) → trim(cdeg). cmd 0 에서 deg_servo = 90 + trim/100 이므로 trim = (deg − 90)·100 (dir 와 무관) */
export function levelDegToTrim(deg) { return Math.round((Number(deg) - 90) * 100); }
/** trim(cdeg) → cmd 0 일 때 서보각(°) = 90 + trim/100 */
export function trimToServoDeg(trim_cdeg) { return 90 + Number(trim_cdeg) / 100; }
/**
 * 서보 혼 각도(서보각 °) → 명령 좌표 cmd(cdeg). 펌웨어 식을 뒤집은 것: cmd = dir·((deg − 90)·100 − trim)
 * (dir = ±1 이라 1/dir = dir)
 */
export function servoDegToCmd(deg, { trim_cdeg = 0, dir = 1 } = {}) { return (dir || 1) * ((deg - 90) * 100 - (trim_cdeg || 0)); }
/** 명령 좌표 cmd(cdeg) → 서보 혼 각도(°) = 90 + trim/100 + dir·cmd/100 (자르지 않음) */
export function cmdToServoDeg(cmd_cdeg, { trim_cdeg = 0, dir = 1 } = {}) { return 90 + (trim_cdeg || 0) / 100 + (dir || 1) * cmd_cdeg / 100; }

/**
 * 사용자 장치 수평 실측(사용자 제공, 2026-11-04): 조립한 장치에서 공이 흘러가지 않는 서보각을 찾았더니 83°(서보 90° 중앙에서 −7° 쪽).
 * cmd 0 이 수평이 되려면 trim = (83 − 90)·100 = −700 cdeg (dir 1; trim 은 dir 과 무관). 이 서보각에서 A0 기대값 ≈ 308.4(위 보정 직선).
 * 이 값은 '그 장치'의 기구 조립(혼을 끼운 각도)에 묶인 값이라 번들 기본 장치 설정(DEFAULT_DEVICE.trim = 0)에는 넣지 않는다 —
 * 저장된 장치 설정이 없을 때 '사용자 장치 프로필'로 제안하고 한 번 클릭으로 적용한다. 가상 장치·디지털 트윈 기구는 trim 0 이 수평이다.
 */
export const LEVEL_MEASURED_USER = Object.freeze({
  date: '2026-11-04',
  servo_model: 'HS5645MG',
  level_servo_deg: 83,
  dir: 1,
  trim_cdeg: -700,
  method: '공이 굴러가지 않는 서보각 탐색(조립 후, 사용자 실측)',
  source: '사용자 제공 실측(2026-11-04)',
  provenance: 'measured',
});

export const SERVO_PRESETS = {
  HS5645MG: {
    id: 'HS5645MG',
    label: 'HS-5645MG',
    pmin_us: 544,
    pmax_us: 2400,
    nominal_pulse: null,        // 실측 필요 (제조사 문서 확인 후 기입)
    supply_v: '4.8~6 V, 이 장치는 5.0 V 이하 권장(와이퍼 보호)', // 정격 4.8~6 V(제조사 문서 확인). 포텐쇼미터 양 끝이 서보 전원에 걸려 와이퍼 → A0 전압이 전원을 따라가므로 5.0 V 이하로 쓴다
    speed_nominal: null,        // 실측 필요
    // 실측 3점 최소제곱(서보 혼 각도 기준, raw 증가 방향): cdeg = a·raw + b, a ≈ +33.457, b ≈ −11018.6 → 서보 90° raw ≈ 329.3
    // 빔 수평은 조립 후 trim 으로 맞춘다(이 직선은 혼 각도만 말한다). 예전 슬라이드 67 값(감소 방향)은 LEGACY_SLIDE67_POT.
    pot_preset: {
      order: 1, a_cdeg_per_lsb: MEASURED_FIT.a_cdeg_per_lsb, b_cdeg: MEASURED_FIT.b_cdeg, c: 0,
      source: POT_MEASURED_HS5645MG.source, provenance: 'measured', basis: 'servo_horn',
      slope_lsb_per_deg: MEASURED_FIT.slope_lsb_per_deg, raw_at_90: MEASURED_FIT.raw_at_90, residual_max_lsb: MEASURED_FIT.residual_max_lsb,
    },
    note: '기본 서보. 펄스 범위는 Servo.h attach(pin) 기본값(기존 실험과 같은 대응). 포텐쇼미터 기본 보정은 사용자 실측(혼 각도 기준), 빔 수평은 trim으로.',
  },
  SG90: {
    id: 'SG90',
    label: 'SG90',
    pmin_us: 544,
    pmax_us: 2400,
    nominal_pulse: null,        // 판매처마다 표기 다름
    supply_v: '4.8~6 V, 개조 시 5.0 V 이하 권장(와이퍼 보호)', // 포텐쇼미터를 A0에 잇는 개조라면 HS-5645MG와 같은 이유로 5.0 V 이하
    speed_nominal: '0.12 s/60° @4.8 V ≈ 500°/s (무부하 공칭)',
    pot_preset: null,           // 기본값 없음(실측 필요)
    note: '소형 서보. 포텐쇼미터 기본 캘리브레이션 없음 — 07장 캘리브레이션 필요.',
  },
};

export const SERVO_IDS = Object.keys(SERVO_PRESETS);

/** 명령각(cdeg, 수평 0) → 펄스폭(µs) — architecture §3 규약. pwm-demo 표시용 */
export function cmdToPulse(cmd_cdeg, { trim_cdeg = 0, dir = 1, pmin_us = 544, pmax_us = 2400 } = {}) {
  const degServo = 90 + trim_cdeg / 100 + dir * cmd_cdeg / 100;
  return pmin_us + (degServo / 180) * (pmax_us - pmin_us);
}

/** 펄스폭(µs) → 서보 각(0~180°) */
export function pulseToServoDeg(us, { pmin_us = 544, pmax_us = 2400 } = {}) {
  return ((us - pmin_us) / (pmax_us - pmin_us)) * 180;
}
