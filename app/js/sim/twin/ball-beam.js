// ball-beam.js — 디지털 트윈의 공·빔 동역학 (순수 함수, SI 단위, DOM·시리얼 의존 없음)
//
// 설계 모델(plant.js)은 ÿ = K_b·θ (선형, 마찰 없음, 끝 없음)이다. 트윈은 일부러 다르게 둔다.
//
//   유효 질량      m_eff = m·(1 + κ),  κ = J/(m R²)  (inertia_ratio, 중공구 2/3 · 속찬 공 2/5)
//   빔 각          레버 'sin':    sin α_l = (d/L)·sin θ_b       (θ_b = 백래시 뒤 링크 출력각)
//                  레버 'linear': α_l = (d/L)·θ_b               (선형 극한 시험용)
//                  α = α_l + α_0                                 (α_0 = 빔 수평 오차 level_offset_rad)
//   공             m_eff·ÿ = m g sin α − μ_r m g cos α·sgn_ε(ẏ) − m_eff·b·ẏ + m·(y − y_p)·α̇² + m·a_ext
//                  (a_ext = 외력/공 질량 = 외란 'force' 의 a_mm_s2. 공의 실제 가속 기여는 a_ext/(1+κ))
//                  sgn_ε(v) = tanh(v/ε)  (쿨롱 구름 저항의 매끄러운 근사, ε = v_stick/4)
//                  'linear' 레버에서는 sin α → α, cos α → 1 (설계 모델과 같은 식이 되도록)
//   정지 마찰      |ẏ| < v_stick 이고 |m g sin α + m a_ext| ≤ μ_s·μ_r m g cos α 이면 ẏ ← 0 (적분 스텝 끝에서)
//   끝 멈춤판      y < y_min 또는 y > y_max 이면 반사: y ← 경계 + e·(경계 − y), ẏ ← −e·ẏ (반발계수 e)
//                  반사 후 |ẏ| < v_rest 이면 멈춤판에 붙어 정지.
//
// 작은 각도·마찰 0·α_0 = 0·κ 를 설계 J 에 맞추면 ÿ = (m g d/(L m_eff))·θ = K_b·θ 로 설계 모델과 같아진다
// (tests/twin/test_twin.mjs 의 '선형 극한' 시험).

export const V_REST_M_S = 0.005;

/** 유효 질량 비 m_eff/m = 1 + κ */
export function massRatio(ball) {
  return 1 + ball.inertia_ratio;
}

/** 작은 각도 등가 이득 K_b,twin = g d /(L (1+κ)) [m/s²/rad] — 트윈 공칭값이 설계 K_b 와 얼마나 다른지 보고용 */
export function kbEffective(p) {
  return (p.beam.g * p.beam.d_m) / (p.beam.L_m * massRatio(p.ball));
}

/**
 * 링크 출력각 θ_b → 빔 각 α (수평 오차 포함)
 * @returns {{ alpha, dalpha_dtheta }}
 */
export function beamAngle(beam, theta_b) {
  const r = beam.d_m / beam.L_m;
  if (beam.lever === 'linear') return { alpha: r * theta_b + beam.level_offset_rad, dalpha_dtheta: r };
  const s = Math.max(-1, Math.min(1, r * Math.sin(theta_b)));
  const al = Math.asin(s);
  const ca = Math.cos(al);
  return { alpha: al + beam.level_offset_rad, dalpha_dtheta: ca > 1e-9 ? (r * Math.cos(theta_b)) / ca : 0 };
}

/** 중력 성분 가속 (마찰 제외) [m/s²] */
export function gravityAccel(p, alpha) {
  const s = p.beam.lever === 'linear' ? alpha : Math.sin(alpha);
  return (p.beam.g * s) / massRatio(p.ball);
}

/** 쿨롱 구름 저항 가속 크기 [m/s²] (정지 마찰이 아닌 운동 중 값) */
export function rollingAccelMag(p, alpha) {
  const c = p.beam.lever === 'linear' ? 1 : Math.cos(alpha);
  return (p.ball.mu_roll * p.beam.g * c) / massRatio(p.ball);
}

/**
 * 공 가속도 ÿ
 * @param p     트윈 파라미터(twin.js normalizeParams 결과)
 * @param y,ydot 공 위치·속도
 * @param alpha 빔 각, alphaDot 빔 각속도
 * @param extra 외력/공 질량 a_ext [m/s²] (외란 'force'). 다른 힘과 같이 m_eff 로 나뉘어 ÿ 에 a_ext/(1+κ) 로 들어간다
 */
export function ballAccel(p, y, ydot, alpha, alphaDot, extra = 0) {
  const ball = p.ball;
  const kr = massRatio(ball);
  let a = gravityAccel(p, alpha) + extra / kr;
  if (ball.mu_roll > 0) {
    const eps = Math.max(1e-6, ball.v_stick_m_s / 4);
    a -= rollingAccelMag(p, alpha) * Math.tanh(ydot / eps);
  }
  if (ball.b_visc_1_s > 0) a -= ball.b_visc_1_s * ydot;
  if (alphaDot !== 0 && p.beam.lever !== 'linear') a += ((y - p.beam.pivot_y_m) * alphaDot * alphaDot) / kr;
  return a;
}

/**
 * 정지 마찰 처리(적분 스텝 끝). state = { y, ydot } 를 직접 고친다.
 * @returns {boolean} 붙어 있으면 true
 */
export function applyStiction(p, state, alpha, extra = 0) {
  const ball = p.ball;
  if (!(ball.mu_roll > 0)) return false;
  if (Math.abs(state.ydot) >= ball.v_stick_m_s) return false;
  // 구동 힘/m_eff 와 정지 마찰 한계/m_eff 를 같은 기준으로 비교 (extra = a_ext = F/m)
  const drive = Math.abs(gravityAccel(p, alpha) + extra / massRatio(ball));
  if (drive <= ball.mu_static_ratio * rollingAccelMag(p, alpha)) { state.ydot = 0; return true; }
  return false;
}

/**
 * 끝 멈춤판 충돌. state = { y, ydot } 를 직접 고친다. 반사 후에도 범위를 벗어나지 않게 한다.
 * @returns {0|-1|1} 충돌 없음 / 센서 쪽 / 먼 쪽
 */
export function applyStops(p, state) {
  const { y_min_m: lo, y_max_m: hi } = p.beam;
  const e = Math.max(0, Math.min(1, p.ball.restitution));
  let side = 0;
  if (state.y < lo) {
    state.y = Math.min(hi, lo + e * (lo - state.y));
    if (state.ydot < 0) state.ydot = -e * state.ydot;
    if (Math.abs(state.ydot) < V_REST_M_S) { state.ydot = 0; state.y = lo; }
    side = -1;
  } else if (state.y > hi) {
    state.y = Math.max(lo, hi - e * (state.y - hi));
    if (state.ydot > 0) state.ydot = -e * state.ydot;
    if (Math.abs(state.ydot) < V_REST_M_S) { state.ydot = 0; state.y = hi; }
    side = 1;
  }
  return side;
}

/**
 * 고정 각 α에서의 공 에너지(빔 좌표). 마찰 0, 끝 미접촉이면 보존된다.
 *   E/m = ½(1+κ)ẏ² − g·y·sin α
 */
export function ballEnergyPerMass(p, y, ydot, alpha) {
  const s = p.beam.lever === 'linear' ? alpha : Math.sin(alpha);
  return 0.5 * massRatio(p.ball) * ydot * ydot - p.beam.g * y * s;
}
