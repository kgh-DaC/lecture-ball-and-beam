// plant.js — 볼앤빔 플랜트 모델 (순수 함수, SI 단위)
//
// ■ 부호 규약 (architecture.md §3, controller-interface.md §1)
//   y  = 센서 면에서 공까지 거리 [m]
//   θ  = 서보 명령각(수평 0) [rad].  θ > 0  ⇒  공이 센서에서 멀어지는 방향(y 증가)으로 가속.
//   ÿ  = K_b · θ_servo,  K_b > 0.
//   슬라이드 45는 P_ball(s) = −m g d / (L (J/R² + m)) / s² 로 음수 부호를 쓴다. 이는 슬라이드가
//   "빔을 올리는 방향"을 + 각도로 잡았기 때문이며, 이 코드에서는 펌웨어 `dir`로 방향을 맞춰
//   K_b > 0 하나만 쓴다(제어기 코드에 부호 예외가 없도록).
//
// ■ K_b 유도 (docs/theory/model-derivation.md)
//   구름 운동: (J/R² + m) ÿ = m g sin α,  레버: sin α ≈ (d/L) θ  ⇒  ÿ = m g d / (L (J/R² + m)) · θ
//
// ■ 기구 파라미터 불일치 기록 (2026-11-03)
//   슬라이드 값 J = 5.625e-6 kg·m² 은 R = 0.026 m 중공구 (2/3)mR² 와 정확히 같고,
//   R = 0.025 m 에서는 J/(mR²) = 0.721 이다. 즉 슬라이드의 K_b = 0.8709 는 R=25 mm 와
//   R=26 mm 로 계산한 J 를 섞은 값이다. 기본값은 슬라이드와 같은 값(J=5.625e-6, R=0.025 →
//   K_b = 0.87088)을 유지한다(기존 MATLAB 결과·회귀 기준과 비교 가능하도록).
//   J/R² 를 중공구로 일관되게 쓰면 K_b = (3/5) g d / L = 0.89929 (R 과 무관) — 차이 3.3 %.
//   `J_kgm2: null` 을 주면 중공구 (2/3) m R² 를 쓴다.

export const DEFAULT_PLANT_PARAMS = Object.freeze({
  m_kg: 0.012482, R_m: 0.025, L_m: 0.34, d_m: 0.052, J_kgm2: 5.625e-6, g: 9.8,
});

/**
 * 서보 가정값 (식별 전 가상 장치·번들 샘플용). assumed: true — 실측이 아니다.
 * 근거: 1차+지연+속도 한계 구조(servo-identification §3). 값은 firmware/tools/fake_device.py 의
 * 가정값과 같다(K = 1, τ = 0.06 s, Td = 0.02 s, vmax = 400°/s = 6.981 rad/s) — 가상 장치로 식별
 * 실습을 하면 이 값이 복원되도록 맞췄다. 가짜 장치는 서보 PWM 프레임(20 ms)마다 명령을 받으므로
 * 실효 지연이 0~20 ms(평균 약 10 ms) 더 붙는다; 이 모델은 그 프레임 양자화를 넣지 않는다.
 * 실측이 아니다. 07장 식별 결과(data/identification/result.json, provenance real)가 생기면 그것으로 바꾼다.
 */
export const ASSUMED_SERVO = Object.freeze({
  type: 'fo_slew', K: 1.0, tau_s: 0.06, Td_s: 0.02, wn_rad_s: null, zeta: null,
  vmax_rad_s: (400 * Math.PI) / 180, fit_pct: null, valid_fit_pct: null, assumed: true,
});

export const DEFAULT_SENSOR = Object.freeze({
  Ts_s: 0.06, alpha: 0.2, noise_m: 0, quant_m: 0.003, lost_prob: 0,
});

/** 기구 파라미터 → { K_b, J_used } */
export function plantParams(p = {}) {
  const q = { ...DEFAULT_PLANT_PARAMS, ...p };
  const J = q.J_kgm2 == null ? (2 / 3) * q.m_kg * q.R_m ** 2 : q.J_kgm2;
  for (const k of ['m_kg', 'R_m', 'L_m', 'd_m', 'g']) {
    if (!(q[k] > 0)) throw new Error(`plantParams: ${k} 는 양수여야 함`);
  }
  const K_b = (q.m_kg * q.g * q.d_m) / (q.L_m * (J / q.R_m ** 2 + q.m_kg));
  return { K_b, J_used: J };
}

function normServo(s) {
  if (s == null) return null;
  const out = { K: 1, tau_s: null, Td_s: 0, wn_rad_s: null, zeta: null, vmax_rad_s: null, assumed: false, ...s };
  if (!['ideal', 'fo', 'so', 'fo_slew', 'arx'].includes(out.type)) throw new Error(`servo.type 알 수 없음: ${out.type}`);
  if ((out.type === 'fo' || out.type === 'fo_slew') && !(out.tau_s > 0)) throw new Error('servo.tau_s > 0 필요');
  if (out.type === 'so' && !(out.wn_rad_s > 0 && out.zeta > 0)) throw new Error('servo.wn_rad_s, zeta > 0 필요');
  if (out.type === 'arx' && !(out.cont && out.cont.den)) throw new Error('arx 서보는 cont {num, den, delay_s} 필요');
  if (out.type === 'arx') out.Td_s = out.cont.delay_s || 0;
  if (!(out.Td_s >= 0)) out.Td_s = 0;
  return out;
}

/**
 * 모델 객체 생성 (controller-interface.md §2)
 * @param {object} opts { plant_params, servo_tf, sensor, u_lim_rad }
 */
export function makeModel(opts = {}) {
  const plant_params = { ...DEFAULT_PLANT_PARAMS, ...(opts.plant_params || {}) };
  const { K_b } = plantParams(plant_params);
  const servo = normServo(opts.servo_tf ?? opts.servo ?? null);
  const sensor = { ...DEFAULT_SENSOR, ...(opts.sensor || {}) };
  const u_lim_rad = opts.u_lim_rad ?? (30 * Math.PI) / 180;
  const kind = servo == null || (servo.type === 'ideal' && !(servo.Td_s > 0)) ? 'ball_only' : 'ball_servo';
  return { K_b: opts.K_b ?? K_b, plant_params, servo, sensor, u_lim_rad, kind };
}

/** 서보 TF (지연 포함). 서보 없음 → 1 */
export function servoTF(servo) {
  if (!servo) return { num: [1], den: [1], delay: 0 };
  const K = servo.K ?? 1;
  switch (servo.type) {
    case 'ideal': return { num: [K], den: [1], delay: servo.Td_s || 0 };
    case 'fo':
    case 'fo_slew': // 속도 한계는 비선형이므로 TF에서는 빠진다(소신호 근사)
      return { num: [K], den: [servo.tau_s, 1], delay: servo.Td_s || 0 };
    case 'so': {
      const w = servo.wn_rad_s, z = servo.zeta;
      return { num: [K * w * w], den: [1, 2 * z * w, w * w], delay: servo.Td_s || 0 };
    }
    case 'arx': return { num: servo.cont.num.slice(), den: servo.cont.den.slice(), delay: servo.cont.delay_s || 0 };
    default: throw new Error('servoTF: 알 수 없는 type');
  }
}

/** P(s) = G_servo(s) · K_b / s² (지연 포함, 다항식은 내림차순) */
export function plantTF(model) {
  const S = servoTF(model.servo);
  const num = S.num.map((c) => c * model.K_b);
  const den = [];
  // den = S.den · s²
  for (const c of S.den) den.push(c);
  den.push(0, 0);
  return { num, den, delay: S.delay };
}

/**
 * 상태공간 (지연 제외; opts.pade_order > 0 이면 입력 앞에 Padé 지연 상태를 붙인다)
 *  서보 없음/ideal: x = [y, ydot]
 *  fo, fo_slew:     x = [y, ydot, theta]      θ̇ = (K u − θ)/τ
 *  so:              x = [y, ydot, theta, theta_dot]
 *  arx:             x = [y, ydot, s1..sn]     (서보 TF의 제어기 정준형)
 */
export function stateSpace(model, opts = {}) {
  const Kb = model.K_b;
  const s = model.servo;
  let A, B, Cm, states;
  if (!s || s.type === 'ideal') {
    const K = s ? s.K ?? 1 : 1;
    A = [[0, 1], [0, 0]]; B = [[0], [Kb * K]]; Cm = [[1, 0]]; states = ['y', 'ydot'];
  } else if (s.type === 'fo' || s.type === 'fo_slew') {
    const t = s.tau_s, K = s.K ?? 1;
    A = [[0, 1, 0], [0, 0, Kb], [0, 0, -1 / t]]; B = [[0], [0], [K / t]]; Cm = [[1, 0, 0]];
    states = ['y', 'ydot', 'theta'];
  } else if (s.type === 'so') {
    const w = s.wn_rad_s, z = s.zeta, K = s.K ?? 1;
    A = [[0, 1, 0, 0], [0, 0, Kb, 0], [0, 0, 0, 1], [0, 0, -w * w, -2 * z * w]];
    B = [[0], [0], [0], [K * w * w]]; Cm = [[1, 0, 0, 0]];
    states = ['y', 'ydot', 'theta', 'theta_dot'];
  } else if (s.type === 'arx') {
    const S = tf2ssCanon(s.cont.num, s.cont.den);
    const n = S.A.length;
    A = []; B = [];
    A.push([0, 1, ...new Array(n).fill(0)]);
    A.push([0, 0, ...S.C[0].map((c) => Kb * c)]);
    for (let i = 0; i < n; i++) A.push([0, 0, ...S.A[i]]);
    B = [[0], [Kb * S.D[0][0]], ...S.B];
    Cm = [[1, 0, ...new Array(n).fill(0)]];
    states = ['y', 'ydot', ...S.A.map((_, i) => `s${i + 1}`)];
  }
  const D = [[0]];
  const order = opts.pade_order || 0;
  const Td = s ? s.Td_s || 0 : 0;
  if (order > 0 && Td > 0) {
    // 입력 → Padé(Td) → 플랜트
    const P = padeCoeffs(Td, order);
    const S = tf2ssCanon(P.num, P.den);
    const n = A.length, m = S.A.length;
    const A2 = [];
    for (let i = 0; i < n; i++) A2.push([...A[i], ...S.C[0].map((c) => B[i][0] * c)]);
    for (let i = 0; i < m; i++) A2.push([...new Array(n).fill(0), ...S.A[i]]);
    const B2 = [...B.map((r) => [r[0] * S.D[0][0]]), ...S.B];
    const C2 = [[...Cm[0], ...new Array(m).fill(0)]];
    return { A: A2, B: B2, C: C2, D, states: [...states, ...S.A.map((_, i) => `pade${i + 1}`)] };
  }
  return { A, B, C: Cm, D, states };
}

/** Padé 근사 계수 (내림차순). e^{-sT} ≈ N(s)/D(s) */
export function padeCoeffs(T, order = 1) {
  const n = order;
  const fact = (k) => { let r = 1; for (let i = 2; i <= k; i++) r *= i; return r; };
  const num = [], den = [];
  for (let k = n; k >= 0; k--) {
    const c = (fact(2 * n - k) * fact(n)) / (fact(2 * n) * fact(k) * fact(n - k)) * T ** k;
    num.push((k % 2 === 0 ? 1 : -1) * c);
    den.push(c);
  }
  return { num, den };
}

/** 진분수 TF → 제어기 정준형 { A, B, C, D } (단일 입출력) */
export function tf2ssCanon(num, den) {
  let d = den.slice();
  while (d.length > 1 && d[0] === 0) d.shift();
  let nm = num.slice();
  while (nm.length > 1 && nm[0] === 0) nm.shift();
  const n = d.length - 1;
  if (nm.length - 1 > n) throw new Error('tf2ss: 분자 차수가 분모보다 큼(비진분수)');
  const a0 = d[0];
  d = d.map((x) => x / a0); nm = nm.map((x) => x / a0);
  // 분자를 분모 길이로 맞춤
  while (nm.length < d.length) nm.unshift(0);
  const Dv = nm[0];
  // 엄격 진분수 부분: nm − Dv·d
  const r = nm.map((x, i) => x - Dv * d[i]).slice(1); // 길이 n
  if (n === 0) return { A: [], B: [], C: [[]], D: [[Dv]] };
  const A = [];
  A.push(d.slice(1).map((x) => -x));
  for (let i = 1; i < n; i++) { const row = new Array(n).fill(0); row[i - 1] = 1; A.push(row); }
  const B = [[1], ...new Array(n - 1).fill(0).map(() => [0])];
  const Cm = [r];
  return { A, B, C: Cm, D: [[Dv]] };
}
