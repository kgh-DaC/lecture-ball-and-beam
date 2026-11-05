// twin.js — 디지털 트윈 플랜트 TwinPlant: 공·빔(ball-beam.js) + 서보(servo.js) + 센서(sensor.js)
//
// 규칙 (docs/spec/digital-twin.md)
//  - 순수 모듈: DOM·시리얼·저장소 접근 없음. Node 에서 그대로 import.
//  - 고정 내부 스텝 h ≤ 1 ms(기본 0.5 ms), RK4. 상태 x = [y, ẏ, θ_m].
//  - 제어기는 TwinPlant 를 직접 보지 않는다. 호출자(scenario.js TwinLoop, twin-device.js)가
//    measure() 결과(센서 출력)만 제어기에 넘기고 truth() 는 화면·채점에만 쓴다.
//  - 결정론: 같은 params·seed·명령열이면 비트 단위로 같은 궤적.
import { beamAngle, ballAccel, applyStops, applyStiction, kbEffective, V_REST_M_S } from './ball-beam.js';
import { ServoModel } from './servo.js';
import { UltrasonicSensor, makeRng, subSeed, potRaw, PRESET_POT_CAL, checkDespike } from './sensor.js';

export const TWIN_VERSION = '1.0.0';
const H_MAX_S = 0.001;

// ------------------------------------------------------------------ 파라미터
const PROVENANCES = ['measured', 'documented', 'assumed'];

/**
 * data/twin/params.json(값마다 { value, unit, provenance, basis }) → 숫자 파라미터 + 출처 표
 * @param json params.json 객체
 * @param opts { identification?: data/identification/result.json 객체 }
 *   식별 결과가 provenance 'real' 이고 servo.assumed 가 아니면 서보 K·τ·Td·vmax 를 그 값으로 바꾸고 출처를 measured 로.
 * @returns {{ params, provenance: { [path]: 'measured'|'documented'|'assumed' }, basis: { [path]: string }, ref: string }}
 */
export function paramsFromJson(json, opts = {}) {
  if (!json || typeof json !== 'object') throw new Error('paramsFromJson: params.json 객체가 필요함');
  const params = {}, provenance = {}, basis = {};
  for (const group of ['ball', 'beam', 'servo', 'sensor', 'loop', 'integration']) {
    const g = json[group];
    if (!g) throw new Error(`params.json: '${group}' 그룹 없음`);
    params[group] = {};
    for (const [k, leaf] of Object.entries(g)) {
      if (leaf && typeof leaf === 'object' && 'value' in leaf) {
        params[group][k] = leaf.value === null ? null : leaf.value;
        const pv = leaf.provenance;
        if (!PROVENANCES.includes(pv)) throw new Error(`params.json: ${group}.${k} provenance 는 ${PROVENANCES.join('|')}`);
        provenance[`${group}.${k}`] = pv;
        basis[`${group}.${k}`] = leaf.basis || '';
      } else {
        params[group][k] = leaf;
      }
    }
  }
  const id = opts.identification;
  if (id && id.provenance === 'real' && id.servo && !id.servo.assumed && (id.servo.type === 'fo' || id.servo.type === 'fo_slew')) {
    const s = id.servo;
    const set = (k, v, path) => { if (Number.isFinite(v)) { params.servo[k] = v; provenance[path] = 'measured'; basis[path] = `data/identification/result.json (${id.created_at || ''})`; } };
    set('K', s.K, 'servo.K'); set('tau_s', s.tau_s, 'servo.tau_s'); set('Td_s', s.Td_s, 'servo.Td_s');
    if (s.type === 'fo_slew') set('vmax_rad_s', s.vmax_rad_s, 'servo.vmax_rad_s');
  }
  return { params: normalizeParams(params), provenance, basis, ref: json.id || 'unknown' };
}

/** 누락 기본값 채우기 + 검사. 입력을 바꾸지 않고 새 객체를 돌려준다 */
export function normalizeParams(p) {
  const q = clone(p);
  const ball = { inertia_ratio: 2 / 3, mu_roll: 0, mu_static_ratio: 1.5, b_visc_1_s: 0, v_stick_m_s: 0.002, restitution: 0.3, ...q.ball };
  const beam = { g: 9.8, level_offset_rad: 0, pivot_y_m: 0, lever: 'sin', y_min_m: 0.02, y_max_m: 0.33, ...q.beam };
  const servo = {
    K: 1, tau_s: 0.06, Td_s: 0.02, vmax_rad_s: 0, deadband_rad: 0, backlash_rad: 0, theta_lim_rad: Infinity,
    pwm_frame_s: 0, pwm_phase_s: 0, pwm_quantize: false, pmin_us: 544, pmax_us: 2400, pot_noise_lsb: 0, ...q.servo,
  };
  if (servo.theta_lim_rad == null) servo.theta_lim_rad = Infinity;
  const sensor = {
    noise_mm: 0, quant_mm: 0, delay_s: 0, lost_prob: 0, outlier_prob: 0, outlier_mm: 304, outlier_sd_mm: 0,
    range_min_mm: 20, range_max_mm: 500, jitter_ms: 0, scale: 1, ...q.sensor,
  };
  // despike: 펌웨어 1.1.0 거리 이상값 제거(protocol §3.1). 키가 없으면 0(끔 = 1.0.0 동작). params.json 이 실제 값을 정한다
  const loop = { latency_s: 0, hard_lim_cdeg: 3000, hb_ms: 500, rate_limit_cdeg_s: null, fs_ms: 60, alpha_milli: 200, despike: 0, ...q.loop };
  const integration = { h_s: 0.0005, ...q.integration };
  for (const [k, v] of Object.entries({ m_kg: ball.m_kg, R_m: ball.R_m, L_m: beam.L_m, d_m: beam.d_m, g: beam.g })) {
    if (!(v > 0)) throw new Error(`트윈 파라미터 ${k} 는 양수여야 함 (받은 값 ${v})`);
  }
  if (!(servo.tau_s >= 0)) throw new Error('servo.tau_s ≥ 0 필요');
  if (!(servo.Td_s >= 0)) throw new Error('servo.Td_s ≥ 0 필요');
  if (!(integration.h_s > 0 && integration.h_s <= H_MAX_S)) throw new Error(`integration.h_s 는 (0, ${H_MAX_S}] s`);
  if (!(beam.y_min_m < beam.y_max_m)) throw new Error('beam.y_min_m < y_max_m 필요');
  if (!['sin', 'linear'].includes(beam.lever)) throw new Error("beam.lever 는 'sin' | 'linear'");
  if (loop.despike == null) loop.despike = 0;
  checkDespike(loop.despike);
  return { ball, beam, servo, sensor, loop, integration };
}

function clone(o) {
  if (Array.isArray(o)) return o.map(clone);
  if (o && typeof o === 'object') { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = clone(v); return r; }
  return o;
}

/** 경로('servo.tau_s')로 값 읽기/쓰기 */
export function getPath(p, path) { const [g, k] = path.split('.'); return p[g] ? p[g][k] : undefined; }
export function setPath(p, path, v) {
  const [g, k] = path.split('.');
  if (!p[g] || !(k in p[g])) throw new Error(`알 수 없는 트윈 파라미터: ${path}`);
  p[g][k] = v;
}

/**
 * 변동 키 → 파라미터 경로 (상대 변동: 값 × (1 + δ)). docs/spec/digital-twin.md §4
 * 'mass' 는 구르는 공에서 중력·관성 항이 함께 커져 상쇄되므로(κ 고정) 운동에 거의 영향이 없다 — 교재 관찰 거리.
 */
export const VARIATION_KEYS = Object.freeze({
  mass: ['ball.m_kg'],
  inertia_ratio: ['ball.inertia_ratio'],
  friction: ['ball.mu_roll', 'ball.b_visc_1_s'],
  restitution: ['ball.restitution'],
  tau_servo: ['servo.tau_s'],
  delay_servo: ['servo.Td_s'],
  servo_gain: ['servo.K'],
  slew: ['servo.vmax_rad_s'],
  deadband: ['servo.deadband_rad'],
  backlash: ['servo.backlash_rad'],
  sensor_noise: ['sensor.noise_mm'],
  sensor_scale: ['sensor.scale'],
  outlier_prob: ['sensor.outlier_prob'],
  lost_prob: ['sensor.lost_prob'],
  latency: ['loop.latency_s'],
});
/** 절대 변동 키: 공칭값에 ±범위 값을 더한다 */
export const OFFSET_KEYS = Object.freeze({ level_offset_deg: ['beam.level_offset_rad', Math.PI / 180] });

/**
 * 배율·오프셋 적용 (새 객체)
 * @param scales { [변동키 또는 경로]: 배율 }, @param offsets { level_offset_deg: 더할 도 }
 */
export function applyVariation(params, scales = {}, offsets = {}) {
  const p = clone(params);
  for (const [key, f] of Object.entries(scales)) {
    const paths = VARIATION_KEYS[key] || (key.includes('.') ? [key] : null);
    if (!paths) throw new Error(`알 수 없는 변동 키: ${key}`);
    for (const path of paths) { const v = getPath(p, path); if (Number.isFinite(v)) setPath(p, path, v * f); }
  }
  for (const [key, d] of Object.entries(offsets)) {
    const spec = OFFSET_KEYS[key];
    if (!spec) throw new Error(`알 수 없는 오프셋 키: ${key}`);
    setPath(p, spec[0], getPath(p, spec[0]) + d * spec[1]);
  }
  return normalizeParams(p);
}

/**
 * 설계 모델(plant.makeModel 결과)과 같은 물리를 내는 트윈 파라미터(선형 극한 시험용).
 * 레버 linear, 마찰·수평오차·데드밴드·백래시·PWM 프레임·양자화·센서 비이상성 0, 멈춤판 [0, L] 비탄성.
 */
export function linearLimitParams(model) {
  const pp = model.plant_params;
  const J = pp.J_kgm2 == null ? (2 / 3) * pp.m_kg * pp.R_m ** 2 : pp.J_kgm2;
  const s = model.servo;
  let servo;
  if (!s || s.type === 'ideal') servo = { K: s ? s.K ?? 1 : 1, tau_s: 0, Td_s: s ? s.Td_s || 0 : 0, vmax_rad_s: 0 };
  else if (s.type === 'fo' || s.type === 'fo_slew') servo = { K: s.K ?? 1, tau_s: s.tau_s, Td_s: s.Td_s || 0, vmax_rad_s: s.type === 'fo_slew' ? s.vmax_rad_s || 0 : 0 };
  else throw new Error(`linearLimitParams: 서보 type ${s.type} 는 트윈 서보 구조(1차)로 표현할 수 없음`);
  return normalizeParams({
    ball: { m_kg: pp.m_kg, R_m: pp.R_m, inertia_ratio: J / (pp.m_kg * pp.R_m ** 2), mu_roll: 0, b_visc_1_s: 0, restitution: 0 },
    beam: { L_m: pp.L_m, d_m: pp.d_m, g: pp.g, lever: 'linear', level_offset_rad: 0, y_min_m: 0, y_max_m: pp.L_m },
    servo,
    sensor: { noise_mm: 0, quant_mm: 0, lost_prob: 0, outlier_prob: 0, delay_s: 0, jitter_ms: 0, range_min_mm: -Infinity, range_max_mm: Infinity },
    loop: { latency_s: 0, fs_ms: Math.round(model.sensor.Ts_s * 1000), alpha_milli: Math.round((model.sensor.alpha ?? 1) * 1000), despike: 0 },
    integration: { h_s: 0.0005 },
  });
}

// ------------------------------------------------------------------ 플랜트
export class TwinPlant {
  /**
   * @param params normalizeParams / paramsFromJson(...).params
   * @param opts { seed = 1, record_dense = false (truth 를 내부 스텝마다 남기지 않음) }
   */
  constructor(params, opts = {}) {
    this.p = normalizeParams(params);
    this.seed = (opts.seed ?? 1) >>> 0 || 1;
    this.servo = new ServoModel(this.p.servo);
    this.sensor = new UltrasonicSensor(this.p.sensor, this.seed);
    this.substepObserver = null;
    this.reset();
  }

  /** 소신호 등가 K_b (보고용) */
  get kbEffective() { return kbEffective(this.p); }

  reset(init = {}) {
    this.t = init.t_s ?? 0;
    this.st = { y: init.y_m ?? 0.15, ydot: init.ydot_m_s ?? 0 };
    this.servo.p = this.p.servo;
    this.servo.reset(init.theta_rad ?? 0, this.t);
    this.sensor.p = this.p.sensor;
    this.sensor.reset();
    this.rPot = makeRng(subSeed(this.seed, 'pot'));
    this.yhist = [{ t: this.t, y: this.st.y }];
    this.forces = [];          // [{ t0, t1, a_m_s2 }]
    this.end_hits = 0;
    this.at_stop = 0;
    this.stuck = false;
    this.diverged = false;
    this.diverged_reason = null;
    this.alpha = beamAngle(this.p.beam, this.servo.theta_b).alpha;
    return this;
  }

  /** 시각 this.t 에 서보 명령(펌웨어가 적용한 각, rad) */
  command(u_rad) {
    if (!Number.isFinite(u_rad)) throw new Error('TwinPlant.command: 유한한 각이 필요함');
    this.servo.command(this.t, u_rad);
  }

  _extra(t) {
    let a = 0;
    for (const f of this.forces) if (t >= f.t0 && t < f.t1) a += f.a_m_s2;
    return a;
  }

  _deriv(y, ydot, thm, target, extra) {
    const sv = this.servo;
    const v = this.p.servo.tau_s > 0 ? sv.velocity(thm, target) : 0;
    const thb = sv.linkOut(thm);
    const { alpha, dalpha_dtheta } = beamAngle(this.p.beam, thb);
    const engaged = !(this.p.servo.backlash_rad > 0) || thb !== sv.theta_b;
    const alphaDot = engaged ? dalpha_dtheta * v : 0;
    return [ydot, ballAccel(this.p, y, ydot, alpha, alphaDot, extra), v];
  }

  /** RK4 한 번 (상태를 바꾸지 않고 결과만) */
  _rk4(y0, v0, th0, h, target, extra) {
    const k1 = this._deriv(y0, v0, th0, target, extra);
    const k2 = this._deriv(y0 + 0.5 * h * k1[0], v0 + 0.5 * h * k1[1], th0 + 0.5 * h * k1[2], target, extra);
    const k3 = this._deriv(y0 + 0.5 * h * k2[0], v0 + 0.5 * h * k2[1], th0 + 0.5 * h * k2[2], target, extra);
    const k4 = this._deriv(y0 + h * k3[0], v0 + h * k3[1], th0 + h * k3[2], target, extra);
    let th = th0 + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    // 1차 서보가 목표를 지나치지 않게(데드밴드가 없을 때만 — 데드밴드 경계는 velocity 가 처리)
    if (this.p.servo.tau_s > 0 && !(this.p.servo.deadband_rad > 0) && (target - th0) * (target - th) < 0) th = target;
    return {
      y: y0 + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      v: v0 + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      th,
    };
  }

  _substep(t, h) {
    const sv = this.servo;
    const target = sv.targetAt(t + 1e-9);
    if (!(this.p.servo.tau_s > 0)) { sv.theta_m = target; sv.theta_b = sv.linkOut(target); }
    const extra = this._extra(t + 1e-9);
    const y0 = this.st.y, v0 = this.st.ydot, th0 = sv.theta_m;
    let r = this._rk4(y0, v0, th0, h, target, extra);
    const { y_min_m: lo, y_max_m: hi } = this.p.beam;
    // 멈춤판 충돌: 선형 보간으로 충돌 시각을 찾아 그 시각까지 적분 → 반사(ẏ ← −e·ẏ) → 남은 시간 적분.
    // (위치 거울 반사만 하면 일정 가속 아래에서 충돌마다 에너지가 조금씩 늘어난다)
    if ((r.y < lo && y0 >= lo) || (r.y > hi && y0 <= hi)) {
      const b = r.y < lo ? lo : hi;
      let s = Math.max(0, Math.min(1, (b - y0) / (r.y - y0)));
      let r1 = this._rk4(y0, v0, th0, s * h, target, extra);
      // 뉴턴 보정(충돌 시각 정밀화): s ← s − (y(s) − b)/(ẏ(s)·h)
      for (let it = 0; it < 3 && Math.abs(r1.v) > 1e-9; it++) {
        const s2 = Math.max(0, Math.min(1, s - (r1.y - b) / (r1.v * h)));
        if (s2 === s) break;
        s = s2; r1 = this._rk4(y0, v0, th0, s * h, target, extra);
      }
      const e = Math.max(0, Math.min(1, this.p.ball.restitution));
      let vr = -e * r1.v;
      if (Math.abs(vr) < V_REST_M_S) vr = 0;
      this.st.y = b; this.st.ydot = vr;
      const r2 = this._rk4(b, vr, r1.th, (1 - s) * h, target, extra);
      r = r2;
      this.end_hits += this.at_stop === (b === lo ? -1 : 1) ? 0 : 1;
      this.at_stop = b === lo ? -1 : 1;
    }
    const omega = this.p.servo.tau_s > 0 ? (r.th - th0) / h : 0;
    if (this.p.servo.tau_s > 0) sv.commit(r.th, omega);
    this.st.y = r.y; this.st.ydot = r.v;
    if (!Number.isFinite(r.y) || !Number.isFinite(r.v) || !Number.isFinite(sv.theta_m)) {
      this.diverged = true; this.diverged_reason = 'non_finite_state';
      return false;
    }
    // 남은 시간 안에 다시 넘었거나(멈춤판에 눌린 공) 위의 보간이 못 잡은 경우: 경계로 되돌림(applyStops)
    const side = applyStops(this.p, this.st);
    if (side !== 0) { if (this.at_stop !== side) this.end_hits++; this.at_stop = side; }
    else if (this.st.y > lo + 1e-6 && this.st.y < hi - 1e-6) this.at_stop = 0;
    this.alpha = beamAngle(this.p.beam, sv.theta_b).alpha;
    this.stuck = applyStiction(this.p, this.st, this.alpha, extra);
    return true;
  }

  /** dt_s 만큼 진행(내부 고정 스텝). 발산하면 멈추고 diverged = true */
  advance(dt_s) {
    if (!(dt_s > 0) || this.diverged) return this;
    const h0 = this.p.integration.h_s;
    const n = Math.max(1, Math.ceil(dt_s / h0 - 1e-9));
    const h = dt_s / n;
    const t0 = this.t;
    const obs = this.substepObserver;
    for (let i = 0; i < n; i++) {
      const s0 = obs ? this._snap() : null;
      if (!this._substep(t0 + i * h, h)) { this.t = t0 + (i + 1) * h; return this; }
      const tt = t0 + (i + 1) * h;
      this.yhist.push({ t: tt, y: this.st.y });
      if (obs) obs(t0 + i * h, s0, tt, this._snap());
    }
    this.t = t0 + dt_s;
    // 센서 지연용 이력(최근 0.2 s + 지연)만 유지
    const keep = this.t - Math.max(0.2, 2 * (this.p.sensor.delay_s || 0));
    let cut = 0;
    while (cut < this.yhist.length - 2 && this.yhist[cut + 1].t < keep) cut++;
    if (cut > 0) this.yhist.splice(0, cut);
    this.servo.prune(this.t);
    return this;
  }

  /** 시각 t 의 참 위치(이력 선형 보간) */
  yAt(t) {
    const h = this.yhist;
    if (t >= h[h.length - 1].t) return h[h.length - 1].y;
    if (t <= h[0].t) return h[0].y;
    let lo = 0, hi = h.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (h[m].t <= t) lo = m; else hi = m; }
    const a = h[lo], b = h[hi];
    return a.y + ((b.y - a.y) * (t - a.t)) / (b.t - a.t || 1);
  }

  /**
   * 센서 1회 측정(현재 시각). 제어기에 갈 수 있는 정보는 이것뿐이다.
   * @returns {{ t_s, dist_mm, lost, outlier, fault, pot_raw }}
   */
  measure(cal = PRESET_POT_CAL) {
    const yS = this.yAt(this.t - (this.p.sensor.delay_s || 0));
    const m = this.sensor.sample(this.t, yS);
    return { t_s: this.t, ...m, pot_raw: potRaw(this.servo.theta_m, cal, this.p.servo.pot_noise_lsb, this.rPot) };
  }

  /** 기록용 참 상태 스냅샷(substepObserver 에 넘김) */
  _snap() {
    const sv = this.servo;
    return { y_m: this.st.y, theta_servo_rad: sv.theta_m, theta_link_rad: sv.theta_b, alpha_rad: this.alpha };
  }

  /**
   * 기록 전용 관찰자: substepObserver = (t0, s0, t1, s1) => void 를 두면 advance() 의 내부 고정 스텝마다
   * 스텝 앞뒤 참 상태를 넘긴다. 적분 격자·상태를 바꾸지 않으므로 결과에 영향이 없다(runScenario 의 truth_dt_s).
   */
  setSubstepObserver(fn) { this.substepObserver = typeof fn === 'function' ? fn : null; }

  /** 참 상태(화면·채점 전용 — 제어기에 넘기지 않는다) */
  truth() {
    const sv = this.servo;
    return {
      t_s: this.t, y_m: this.st.y, ydot_m_s: this.st.ydot,
      theta_servo_rad: sv.theta_m, theta_link_rad: sv.theta_b, alpha_rad: this.alpha,
      target_rad: sv.targetAt(this.t + 1e-9),
      at_stop: this.at_stop, end_hits: this.end_hits, stuck: this.stuck,
      diverged: this.diverged,
    };
  }

  /** 스킬 계약 형태: 명령 → dt 진행 → { truth, meas } (meas = 진행 끝 시각의 센서 1회 측정) */
  step(u_rad, dt_s) {
    this.command(u_rad);
    this.advance(dt_s);
    return { truth: this.truth(), meas: this.measure() };
  }

  // ---------------------------------------------------------------- 외란·변동
  /** 공 밀기: 속도 변화 dv [m/s] */
  pushBall(dv_m_s) { this.st.ydot += dv_m_s; this.stuck = false; }
  /** 공을 위치 y 에 정지 상태로 놓기 */
  placeBall(y_m, ydot_m_s = 0) {
    this.st.y = Math.max(this.p.beam.y_min_m, Math.min(this.p.beam.y_max_m, y_m));
    this.st.ydot = ydot_m_s;
    this.yhist.push({ t: this.t, y: this.st.y });
  }
  /** 빔 충격: 링크·출력축을 dθ 만큼 밀어냄(서보가 복귀) */
  knockBeam(dtheta_rad) { this.servo.knock(dtheta_rad); }
  /**
   * 일정 외력을 duration 동안. a = F/m [m/s²] (외력 ÷ 공 질량, docs/theory/digital-twin.md §2.1 의 a_ext).
   * 구름 관성 때문에 공의 실제 가속은 a/(1+κ) 이다.
   */
  addForce(a_m_s2, duration_s, t0 = this.t) { this.forces.push({ t0, t1: t0 + duration_s, a_m_s2 }); }
  /** 파라미터 즉시 변경(경로 또는 변동 키, 배율) */
  scaleParam(key, factor) {
    const paths = VARIATION_KEYS[key] || [key];
    for (const path of paths) { const v = getPath(this.p, path); if (Number.isFinite(v)) setPath(this.p, path, v * factor); }
  }
  setParam(path, value) { setPath(this.p, path, value); }
  /** 센서 고장 주입(sensor.js addFault) */
  sensorFault(fault) { this.sensor.addFault(fault, this.t); }
}
