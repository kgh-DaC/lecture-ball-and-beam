// scenario.js — 디지털 트윈 시나리오 실행기 (순수 모듈, Node 에서 시험)
//
// 한 시나리오(data/twin/scenarios/*.json) + 한 제어기 → 폐루프 실행 결과(센서 기록, 참 상태, 지표).
// 루프 규칙은 실제 장치 경로와 같게 둔다:
//   펌웨어(TwinLoop):  측정 주기 fs(+지터) → D 레코드(dist, filt, cmd, pot_raw, mode)
//                      S 명령: HOST 모드에서만, ±lim 으로 자르기(하드 3000 cdeg), 하트비트 500 ms, M,0 = 비상 정지
//   호스트(runner.js 와 같은 식): y = 유실이면 NaN, 아니면 filt(또는 raw)/1000, dt = Δt_ms/1000,
//                      aux.theta_rad = 포텐쇼미터 프리셋 변환, u = ctrl.update(...), 비유한 → 직전 u, 예외 → 비상 정지,
//                      u_cdeg = round(u·18000/π) 를 ±lim 으로 자른 뒤 latency 뒤에 장치에 적용
// 제어기는 TwinPlant 를 모른다. 받는 것은 D 레코드에서 만든 (ref, y, dt, aux) 뿐이다.
import { TwinPlant, applyVariation, VARIATION_KEYS, OFFSET_KEYS, centerMm } from './twin.js';
import { FirmwareFilter, potToCdeg, PRESET_POT_CAL, DESPIKE_MODES } from './sensor.js';
import { getController } from '../../control/registry.js';
import { makeModel, ASSUMED_SERVO, DEFAULT_SENSOR } from '../../control/plant.js';
import { profileRef, profileDuration } from '../../control/simulate.js';
import { stepInfo } from '../../store/metrics.js';

export const SCENARIO_SCHEMA_VER = 1;
const CDEG2RAD = Math.PI / 18000;
const RAD2CDEG = 18000 / Math.PI;

export const DISTURBANCE_TYPES = ['ball_push', 'ball_place', 'beam_knock', 'force', 'param_step'];
export const SAFETY_EVENT_TYPES = ['estop'];

// ------------------------------------------------------------------ 시나리오 형식
/**
 * 시나리오 검사·기본값 채움. 잘못된 형식이면 예외(메시지에 필드 이름).
 * @returns 정규화한 새 시나리오 객체
 */
export function normalizeScenario(sc) {
  if (!sc || typeof sc !== 'object') throw new Error('시나리오 객체가 필요함');
  if (!sc.id || typeof sc.id !== 'string') throw new Error('시나리오 id(문자열) 필요');
  const out = {
    schema_ver: sc.schema_ver ?? SCENARIO_SCHEMA_VER,
    id: sc.id, title: sc.title || sc.id, description: sc.description || '',
    seed: Number.isInteger(sc.seed) ? sc.seed : 1,
    setpoint_profile: sc.setpoint_profile || null,
    ref: sc.ref ? sc.ref.map((r) => ({ t: +r.t, y_mm: +r.y_mm })) : null,
    duration_s: sc.duration_s,
    y0_mm: sc.y0_mm ?? null,
    disturbance: (sc.disturbance || []).map((d) => ({ ...d })),
    sensor_fault: (sc.sensor_fault || []).map((f) => ({ ...f })),
    safety_events: (sc.safety_events || []).map((e) => ({ ...e })),
    param_scale: { ...(sc.param_scale || {}) },
    param_offset: { ...(sc.param_offset || {}) },
    param_variation: { ...(sc.param_variation || {}) },
    loop: { fs_ms: 60, alpha_milli: 200, lim_cdeg: 3000, y_source: 'filt', ...(sc.loop || {}) },
    success: { tol_mm: 10, window_s: 2, ...(sc.success || {}) },
    design_model: sc.design_model || 'ball_servo',
    notes: sc.notes || '',
  };
  if (!out.setpoint_profile && !out.ref) throw new Error(`시나리오 ${sc.id}: setpoint_profile 또는 ref 필요`);
  if (out.ref) {
    if (!out.ref.length || out.ref.some((r) => !Number.isFinite(r.t) || !Number.isFinite(r.y_mm))) throw new Error(`시나리오 ${sc.id}: ref 항목은 {t, y_mm}`);
    out.ref.sort((a, b) => a.t - b.t);
  }
  if (out.duration_s == null) out.duration_s = out.setpoint_profile ? profileDuration(out.setpoint_profile, 10) : 10;
  if (!(out.duration_s > 0 && out.duration_s <= 120)) throw new Error(`시나리오 ${sc.id}: duration_s 는 (0, 120]`);
  for (const d of out.disturbance) {
    if (!DISTURBANCE_TYPES.includes(d.type)) throw new Error(`시나리오 ${sc.id}: 외란 type '${d.type}' (허용 ${DISTURBANCE_TYPES.join(', ')})`);
    if (!Number.isFinite(d.t)) throw new Error(`시나리오 ${sc.id}: 외란 t 필요`);
    if (d.type === 'param_step' && !(VARIATION_KEYS[d.key] || String(d.key).includes('.'))) throw new Error(`시나리오 ${sc.id}: param_step key '${d.key}'`);
  }
  for (const f of out.sensor_fault) if (!Number.isFinite(f.t)) throw new Error(`시나리오 ${sc.id}: sensor_fault t 필요`);
  for (const e of out.safety_events) if (!SAFETY_EVENT_TYPES.includes(e.type)) throw new Error(`시나리오 ${sc.id}: safety_events type '${e.type}'`);
  for (const k of [...Object.keys(out.param_scale), ...Object.keys(out.param_variation)]) {
    if (!(VARIATION_KEYS[k] || OFFSET_KEYS[k] || k.includes('.'))) throw new Error(`시나리오 ${sc.id}: 변동 키 '${k}'`);
  }
  for (const k of Object.keys(out.param_offset)) if (!OFFSET_KEYS[k]) throw new Error(`시나리오 ${sc.id}: param_offset 키 '${k}'`);
  if (!(out.loop.fs_ms >= 60 && out.loop.fs_ms <= 200)) throw new Error(`시나리오 ${sc.id}: loop.fs_ms 60~200 (HC-SR04 제약)`);
  if (!(out.loop.lim_cdeg >= 0 && out.loop.lim_cdeg <= 3000)) throw new Error(`시나리오 ${sc.id}: loop.lim_cdeg 0~3000`);
  // loop.despike 는 선택: 없으면 트윈 파라미터 loop.despike(params.json) 를 쓴다
  if (out.loop.despike != null && !DESPIKE_MODES.includes(out.loop.despike)) throw new Error(`시나리오 ${sc.id}: loop.despike 0|1|2`);
  return out;
}

/** 시나리오 설정값 함수 t → mm */
export function scenarioRefFn(sc) {
  if (sc.setpoint_profile) return (t) => profileRef(sc.setpoint_profile, t) * 1000;
  const r = sc.ref;
  return (t) => { let v = r[0].y_mm; for (const x of r) { if (x.t <= t + 1e-9) v = x.y_mm; else break; } return v; };
}

/** 설정값이 바뀌는 시각 목록 (t > 0) */
export function refChangeTimes(sc) {
  const f = scenarioRefFn(sc);
  const out = [];
  const dt = 0.01;
  let prev = f(0);
  for (let t = dt; t <= sc.duration_s + 1e-9; t += dt) {
    const v = f(t);
    if (Math.abs(v - prev) > 0.5) { out.push(Math.round(t * 1000) / 1000); prev = v; }
  }
  return out;
}

/**
 * 시나리오 설정값을 data-schema §2.2 프로파일로 (러너·세션 메타용). 표현할 수 없으면 null.
 */
export function scenarioToProfile(sc) {
  const s = normalizeScenario(sc);
  if (s.setpoint_profile) return { ...s.setpoint_profile };
  const r = s.ref;
  if (r.length === 1) return { type: 'const', ref_mm: r[0].y_mm, duration_s: s.duration_s };
  if (r.length === 2 && r[0].t === 0) return { type: 'step', from_mm: r[0].y_mm, to_mm: r[1].y_mm, pre_s: r[1].t, hold_s: s.duration_s - r[1].t };
  return null;
}

// ------------------------------------------------------------------ 펌웨어 + 호스트 루프
/**
 * 펌웨어 안전 규칙을 트윈에서 그대로 동작시키는 루프(프로토콜 문자열 없이, 빠른 일괄 실행용).
 * 같은 규칙의 프로토콜 판은 twin-device.js(VirtualDevice 의 명령 처리 재사용).
 */
export class TwinLoop {
  /**
   * @param plant TwinPlant
   * @param cfg { fs_ms, alpha_milli, despike, lim_cdeg, hard_lim_cdeg=3000, hb_ms=500, rate_limit_cdeg_s=null, latency_s }
   *   despike 를 주지 않으면 plant.p.loop.despike(params.json)
   */
  constructor(plant, cfg = {}) {
    this.plant = plant;
    const L = plant.p.loop;
    this.cfg = {
      fs_ms: cfg.fs_ms ?? L.fs_ms, alpha_milli: cfg.alpha_milli ?? L.alpha_milli, despike: cfg.despike ?? L.despike ?? 0,
      hard_lim_cdeg: cfg.hard_lim_cdeg ?? L.hard_lim_cdeg, hb_ms: cfg.hb_ms ?? L.hb_ms,
      rate_limit_cdeg_s: cfg.rate_limit_cdeg_s ?? L.rate_limit_cdeg_s, latency_s: cfg.latency_s ?? L.latency_s,
    };
    this.cfg.lim_cdeg = Math.min(this.cfg.hard_lim_cdeg, cfg.lim_cdeg ?? 3000);
    this.filter = new FirmwareFilter(this.cfg.alpha_milli, true, this.cfg.despike);
    this.mode = 0;
    this.cmd_cdeg = 0;
    this.lastCmdT = plant.t;
    this.lastApplyT = plant.t;
    this.events = [];          // [{ t_s, type, ... }] 안전 장치 동작 기록
  }

  /** M,1 (HOST) */
  host() { this.mode = 1; this.lastCmdT = this.plant.t; }

  /** M,0 = 비상 정지: IDLE + 명령 0(수평) */
  estop(reason = 'estop') {
    if (this.mode !== 0 || this.cmd_cdeg !== 0) this.events.push({ t_s: this.plant.t, type: reason });
    this.mode = 0; this._apply(0);
  }

  _apply(v) {
    this.cmd_cdeg = v;
    this.lastApplyT = this.plant.t;
    this.plant.command(v * CDEG2RAD);
  }

  /**
   * S,<cdeg> 처리(펌웨어 규칙). 반환: 'ok' | 'E3'(HOST 아님) | 'E1'(정수 아님)
   * 변화율 제한(rate_limit_cdeg_s)은 펌웨어 v1.0 에 없는 트윈 선택 기능(기본 꺼짐).
   */
  servo(cdeg) {
    if (!Number.isInteger(cdeg)) return 'E1';
    if (this.mode !== 1) return 'E3';
    let v = Math.max(-this.cfg.lim_cdeg, Math.min(this.cfg.lim_cdeg, cdeg));
    const rl = this.cfg.rate_limit_cdeg_s;
    if (rl > 0) {
      const dmax = Math.max(1, Math.floor(rl * Math.max(1e-3, this.plant.t - this.lastApplyT)));
      v = Math.max(this.cmd_cdeg - dmax, Math.min(this.cmd_cdeg + dmax, v));
    }
    this.lastCmdT = this.plant.t;
    if (v !== cdeg && !this._clipLogged) { this.events.push({ t_s: this.plant.t, type: 'clipped', requested: cdeg, applied: v }); this._clipLogged = true; }
    this._apply(v);
    return 'ok';
  }

  /** B (하트비트) */
  beat() { this.lastCmdT = this.plant.t; }

  /** 하트비트 만료 시각(HOST 일 때) */
  get hbDeadline() { return this.mode === 1 ? this.lastCmdT + this.cfg.hb_ms / 1000 : Infinity; }

  /** 시각 t 까지 진행(하트비트 감시 포함) */
  advanceTo(t) {
    const P = this.plant;
    while (P.t < t - 1e-12 && !P.diverged) {
      const dl = this.hbDeadline;
      if (dl <= t) {
        if (dl > P.t) P.advance(dl - P.t);
        if (this.mode === 1) { this.events.push({ t_s: P.t, type: 'heartbeat' }); this.mode = 0; this._apply(0); }
        continue;
      }
      P.advance(t - P.t);
    }
  }

  /** 측정 1회 → D 레코드 */
  measure() {
    const m = this.plant.measure();
    // 펌웨어 D 줄은 정수 mm. 센서 quant_mm = 0(선형 극한 시험)일 때만 실수를 그대로 둔다
    const intMode = this.plant.p.sensor.quant_mm > 0;
    const dist = m.dist_mm >= 0 ? (intMode ? Math.round(m.dist_mm) : m.dist_mm) : -1;
    this.filter.integer = intMode;
    const filt = this.filter.push(dist);
    return {
      t_ms: Math.round(this.plant.t * 1000), dist_mm: dist, dist_raw_mm: m.dist_mm,
      filt_mm: filt, cmd_cdeg: this.cmd_cdeg, pot_raw: m.pot_raw, mode: this.mode,
      lost: m.lost, outlier: m.outlier, fault: m.fault, despiked: this.filter.lastRejected,
    };
  }
}

// ------------------------------------------------------------------ 설계 모델 (제어기용)
/**
 * 제어기 설계에 쓰는 모델 = 기존 설계 모델(plant.makeModel). 트윈 파라미터를 모른다(모델 불일치가 보이도록).
 * @param kind 'ball_servo' | 'ball_only', @param loop { fs_ms, alpha_milli }, @param servo 식별 결과 servo(없으면 ASSUMED_SERVO)
 */
export function designModel(kind, loop, servo = null) {
  const sensor = { ...DEFAULT_SENSOR, Ts_s: loop.fs_ms / 1000, alpha: loop.alpha_milli / 1000 };
  if (kind === 'ball_only') return makeModel({ sensor, u_lim_rad: loop.lim_cdeg * CDEG2RAD });
  return makeModel({ servo_tf: servo || ASSUMED_SERVO, sensor, u_lim_rad: loop.lim_cdeg * CDEG2RAD });
}

// ------------------------------------------------------------------ 실행
/**
 * 시나리오 1회 실행.
 * @param args {
 *   scenario,                       시나리오 객체(normalizeScenario 전/후 모두 가능)
 *   params,                         트윈 파라미터(paramsFromJson(...).params 또는 normalizeParams 결과)
 *   controller,                     { id, params } 또는 제어기 인스턴스(호출자가 reset 하지 않아도 됨 — 여기서 reset)
 *   seed?,                          기본 scenario.seed
 *   scales?, offsets?,              추가 변동(몬테카를로 표본). scenario.param_scale·param_offset 에 곱/더함
 *   design_model?,                  제어기 env.model (기본 designModel(scenario.design_model, loop))
 *   design_servo?,                  designModel 에 쓸 서보(식별 결과)
 *   controller_mode? = 'sim',       env.mode
 *   truth_dt_s? = 0,                > 0 이면 참 상태를 이 간격으로 촘촘히 기록(애니메이션용, 결과에 영향 없음)
 *   keep_debug? = true
 * }
 * @returns RunResult (docs/spec/digital-twin.md §6)
 */
export function runScenario(args) {
  const sc = normalizeScenario(args.scenario);
  const seed = (args.seed ?? sc.seed) >>> 0 || 1;
  const scales = { ...sc.param_scale };
  for (const [k, f] of Object.entries(args.scales || {})) scales[k] = (scales[k] ?? 1) * f;
  const offsets = { ...sc.param_offset };
  for (const [k, d] of Object.entries(args.offsets || {})) offsets[k] = (offsets[k] ?? 0) + d;
  const params = applyVariation(args.params, scales, offsets);
  const refFn = scenarioRefFn(sc);
  const loopCfg = { ...sc.loop };
  const plant = new TwinPlant(params, { seed });
  const y0_mm = sc.y0_mm ?? refFn(0);
  plant.reset({ y_m: y0_mm / 1000 });
  const loop = new TwinLoop(plant, loopCfg);

  // 제어기 (설계 모델만 안다)
  const model = args.design_model || designModel(sc.design_model, loopCfg, args.design_servo || null);
  const env = { model, Ts_s: loopCfg.fs_ms / 1000, u_lim_rad: loop.cfg.lim_cdeg * CDEG2RAD, mode: args.controller_mode || 'sim' };
  let ctrl = args.controller;
  let ctrlId, ctrlParams;
  if (!(ctrl && typeof ctrl.update === 'function')) {
    const C = getController(ctrl.id);
    ctrlId = C.meta.id; ctrlParams = { ...(ctrl.params || {}) };
    ctrl = new C(ctrlParams, env);
  } else {
    ctrlId = ctrl.constructor?.meta?.id ?? 'custom'; ctrlParams = ctrl.params ? { ...ctrl.params } : {};
  }
  ctrl.reset({ t_s: 0, ref_m: refFn(0) / 1000, y_m: NaN, u_rad: 0, theta_rad: NaN });

  // 시나리오 사건 큐
  const queue = [];
  for (const d of sc.disturbance) queue.push({ t: d.t, kind: 'dist', ev: d });
  for (const f of sc.sensor_fault) queue.push({ t: f.t, kind: 'fault', ev: f });
  for (const e of sc.safety_events) queue.push({ t: e.t, kind: 'safety', ev: e });
  queue.sort((a, b) => a.t - b.t);
  const applied = [];
  const applyEvent = (q) => {
    const e = q.ev;
    if (q.kind === 'dist') {
      switch (e.type) {
        case 'ball_push': plant.pushBall((e.dv_mm_s ?? 0) / 1000); break;
        case 'ball_place': plant.placeBall(e.y_mm / 1000); break;
        case 'beam_knock': plant.knockBeam(((e.dtheta_deg ?? 0) * Math.PI) / 180); break;
        case 'force': plant.addForce((e.a_mm_s2 ?? 0) / 1000, e.duration_s ?? 0.5); break;
        case 'param_step': plant.scaleParam(e.key, e.scale ?? 1); break;
        default: break;
      }
    } else if (q.kind === 'fault') plant.sensorFault({ ...e, t_s: plant.t });
    else if (q.kind === 'safety' && e.type === 'estop') loop.estop('estop');
    applied.push({ t_s: plant.t, kind: q.kind, ...e });
  };

  const pending = [];          // 장치에 도착할 S 명령 [{ t, cdeg }]
  const advanceTo = (t) => {
    for (;;) {
      let nt = Infinity, src = null;
      if (queue.length && queue[0].t <= t + 1e-12) { nt = queue[0].t; src = 'q'; }
      if (pending.length && pending[0].t <= t + 1e-12 && pending[0].t < nt) { nt = pending[0].t; src = 'p'; }
      if (!src) break;
      loop.advanceTo(nt);
      if (plant.diverged) return;
      if (src === 'q') applyEvent(queue.shift());
      else loop.servo(pending.shift().cdeg);
    }
    loop.advanceTo(t);
  };

  // 기록
  const R = {
    t_s: [], t_ms: [], ref_mm: [], dist_mm: [], filt_mm: [], y_meas_m: [], lost: [], outlier: [], fault: [], despiked: [],
    u_rad: [], u_cdeg: [], cmd_cdeg: [], pot_raw: [], mode: [], debug: [],
    truth: { y_m: [], center_mm: [], ydot_m_s: [], theta_servo_rad: [], theta_link_rad: [], alpha_rad: [], stuck: [], at_stop: [] },
    dense: null,
  };
  const dense = args.truth_dt_s > 0 ? { t_s: [], y_m: [], center_mm: [], theta_servo_rad: [], theta_link_rad: [], alpha_rad: [] } : null;
  let status = 'ok', error = null;
  let lastU = 0, prevTms = null, t0ms = null;
  loop.host();
  let tm = 0;
  const keepDebug = args.keep_debug !== false;
  // 촘촘한 기록(truth_dt_s): 적분을 쪼개지 않는다. 플랜트 내부 고정 스텝의 앞뒤 참 상태를 관찰해
  // 기록 시각 tDense 가 그 스텝 안에 들어오면 선형 보간으로 표본을 만든다. 따라서 truth_dt_s 와
  // 상관없이 물리 적분·제어 루프 순서·난수 소비가 같고, 결과(record·metrics)가 비트 단위로 같다.
  let tDense = 0, nDense = 0;
  const pushDenseSample = (t, s) => {
    dense.t_s.push(+t.toFixed(6)); dense.y_m.push(s.y_m); dense.center_mm.push(centerMm(params, s.y_m)); dense.theta_servo_rad.push(s.theta_servo_rad);
    dense.theta_link_rad.push(s.theta_link_rad); dense.alpha_rad.push(s.alpha_rad);
    nDense++; tDense = nDense * args.truth_dt_s;
  };
  if (dense) {
    pushDenseSample(0, plant._snap());
    plant.setSubstepObserver((ta, sa, tb, sb) => {
      while (tDense <= tb + 1e-9 && tDense <= sc.duration_s + 1e-9) {
        const w = tb > ta ? Math.max(0, Math.min(1, (tDense - ta) / (tb - ta))) : 1;
        const lerp = (k) => sa[k] + (sb[k] - sa[k]) * w;
        pushDenseSample(tDense, { y_m: lerp('y_m'), theta_servo_rad: lerp('theta_servo_rad'), theta_link_rad: lerp('theta_link_rad'), alpha_rad: lerp('alpha_rad') });
      }
    });
  }

  while (tm <= sc.duration_s + 1e-9) {
    advanceTo(tm);
    if (plant.diverged) { status = 'diverged'; break; }
    const D = loop.measure();
    if (t0ms == null) t0ms = D.t_ms;
    const tRel = (D.t_ms - t0ms) / 1000;
    const ref_mm = refFn(tRel);
    const dt_s = prevTms == null ? loopCfg.fs_ms / 1000 : (D.t_ms - prevTms) / 1000;
    prevTms = D.t_ms;
    const ymm = D.dist_mm < 0 ? NaN : (loopCfg.y_source === 'raw' ? D.dist_mm : D.filt_mm);
    const y_m = Number.isFinite(ymm) && ymm >= 0 ? ymm / 1000 : NaN;
    let u = NaN, u_cdeg = null;
    if (D.mode === 1) {
      const theta = potToCdeg(D.pot_raw, PRESET_POT_CAL) * CDEG2RAD;
      try {
        u = ctrl.update(ref_mm / 1000, y_m, dt_s, { theta_rad: theta, y_raw_m: D.dist_mm >= 0 ? D.dist_mm / 1000 : NaN });
      } catch (e) {
        status = 'controller_error'; error = e.message; loop.estop('controller_error');
      }
      if (status !== 'controller_error') {
        if (!Number.isFinite(u)) u = lastU;
        lastU = u;
        u_cdeg = Math.max(-loop.cfg.lim_cdeg, Math.min(loop.cfg.lim_cdeg, Math.round(u * RAD2CDEG)));
        pending.push({ t: plant.t + loop.cfg.latency_s, cdeg: u_cdeg });
      }
    }
    const tr = plant.truth();
    R.t_s.push(tRel); R.t_ms.push(D.t_ms); R.ref_mm.push(ref_mm); R.dist_mm.push(D.dist_mm); R.filt_mm.push(D.filt_mm);
    R.y_meas_m.push(y_m); R.lost.push(D.lost ? 1 : 0); R.outlier.push(D.outlier ? 1 : 0); R.fault.push(D.fault); R.despiked.push(D.despiked ? 1 : 0);
    R.u_rad.push(u); R.u_cdeg.push(u_cdeg); R.cmd_cdeg.push(D.cmd_cdeg); R.pot_raw.push(D.pot_raw); R.mode.push(D.mode);
    if (keepDebug) R.debug.push({ ...(ctrl.debug || {}) });
    R.truth.y_m.push(tr.y_m); R.truth.center_mm.push(tr.center_mm); R.truth.ydot_m_s.push(tr.ydot_m_s); R.truth.theta_servo_rad.push(tr.theta_servo_rad);
    R.truth.theta_link_rad.push(tr.theta_link_rad); R.truth.alpha_rad.push(tr.alpha_rad); R.truth.stuck.push(tr.stuck ? 1 : 0); R.truth.at_stop.push(tr.at_stop);
    if (status === 'controller_error') break;
    tm = plant.t + plant.sensor.nextInterval(loopCfg.fs_ms);
  }
  if (status === 'ok' && loop.events.some((e) => e.type === 'estop')) status = 'estop';
  if (status === 'ok' && loop.events.some((e) => e.type === 'heartbeat')) status = 'heartbeat';
  if (dense) { plant.setSubstepObserver(null); R.dense = dense; }

  const metrics = scenarioMetrics(sc, R, { lim_cdeg: loop.cfg.lim_cdeg, end_hits: plant.end_hits, status, events: applied });
  return {
    schema_ver: 1, kind: 'twin_run',
    scenario_id: sc.id, seed, status, error,
    diverged: status === 'diverged' ? { reason: plant.diverged_reason, t_s: plant.t, scenario_id: sc.id, seed } : null,
    controller: { id: ctrlId, params: ctrlParams, mode: env.mode, design_model_kind: model.kind },
    variation: { scales, offsets },
    params_effective: params,
    kb_twin: plant.kbEffective, kb_design: model.K_b,
    ball_radius_mm: plant.ballRadiusMm,   // center_mm = y_mm + ball_radius_mm (y = 센서→공 가까운 표면 거리)
    despike: { mode: loop.cfg.despike, n_rejected: loop.filter.despike.nRejected },
    events: applied, safety_events: loop.events,
    record: R, metrics,
  };
}

// ------------------------------------------------------------------ 지표
/**
 * 지표 (evaluate.compareControllers 와 같은 이름·단위: itae m·s², iae m·s, po %, ts s, u_tv_rad rad)
 * 오차는 참 위치 기준(e = ref − y_true). 측정 기반 지표가 아니다(채점용).
 */
export function scenarioMetrics(sc, R, { lim_cdeg, end_hits, status, events }) {
  const n = R.t_s.length;
  const changes = refChangeTimes(sc);
  const tStep = changes.length ? changes[0] : 0;
  const evTimes = [...sc.disturbance.map((d) => d.t), ...sc.sensor_fault.map((f) => f.t), ...sc.safety_events.map((e) => e.t)].filter((t) => t > tStep).sort((a, b) => a - b);
  const tWinEnd = Math.min(evTimes.length ? evTimes[0] : Infinity, changes.length > 1 ? changes[1] : Infinity, sc.duration_s + 1);
  let itae = 0, iae = 0, utv = 0, nfb = 0, nsat = 0, nu = 0, nlost = 0, nout = 0;
  const tt = [], yy = [];
  for (let k = 0; k < n; k++) {
    const t = R.t_s[k];
    if (k > 0 && t > tStep + 1e-9) {
      const dt = t - R.t_s[k - 1];
      const ae = Math.abs(R.ref_mm[k] / 1000 - R.truth.y_m[k]);
      iae += ae * dt;
      itae += (t - tStep) * ae * dt;
    }
    if (k > 0 && Number.isFinite(R.u_rad[k]) && Number.isFinite(R.u_rad[k - 1])) utv += Math.abs(R.u_rad[k] - R.u_rad[k - 1]);
    if (R.debug[k] && R.debug[k].fallback) nfb++;
    if (R.u_cdeg[k] != null) { nu++; if (Math.abs(R.u_cdeg[k]) >= lim_cdeg - 0.5) nsat++; }
    if (R.lost[k]) nlost++;
    if (R.outlier[k]) nout++;
    if (t >= tStep - 1e-9 && t < tWinEnd) { tt.push(t); yy.push(R.truth.y_m[k]); }
  }
  let si = { tr: null, po: null, ts: null, ess: null, ts_settled: false };
  if (changes.length && tt.length > 3) {
    const refTo = R.ref_mm[R.t_s.findIndex((t) => t >= tStep - 1e-9)] / 1000;
    const k0 = R.t_s.findIndex((t) => t >= tStep - 1e-9);
    const yInit = k0 > 0 ? R.truth.y_m[k0 - 1] : R.truth.y_m[0];
    const s = stepInfo(tt, yy, refTo, { y_initial: yInit });
    si = { tr: s.tr, po: s.po, ts: s.ts, ess: s.ess, ts_settled: !!s.ts_settled };
  }
  // 마지막 window_s 동안 |e| ≤ tol
  const tol = sc.success.tol_mm, win = sc.success.window_s;
  const tLast = n ? R.t_s[n - 1] : 0;
  const errLast = [];
  for (let k = 0; k < n; k++) if (R.t_s[k] >= tLast - win - 1e-9) errLast.push(Math.abs(R.ref_mm[k] - R.truth.y_m[k] * 1000));
  const finalErr = errLast.length ? Math.max(...errLast) : null;
  const completed = n > 0 && tLast >= sc.duration_s - (sc.loop.fs_ms / 1000) * 2;
  const end_hit = end_hits > 0;
  const success = status === 'ok' && completed && !end_hit && finalErr != null && finalErr <= tol;
  // 외란별 응답: 사건 뒤 최대 |e|와 회복 시간(그 뒤로 계속 tol 안에 머무는 첫 시각 − 사건 시각)
  const disturbances = [];
  const evs = (events || []).filter((e) => e.kind === 'dist' || e.kind === 'fault');
  for (let i = 0; i < evs.length; i++) {
    const t0 = evs[i].t_s, t1 = i + 1 < evs.length ? evs[i + 1].t_s : Infinity;
    let peak = 0, lastOut = null;
    for (let k = 0; k < n; k++) {
      const t = R.t_s[k];
      if (t < t0 || t >= t1) continue;
      const e = Math.abs(R.ref_mm[k] - R.truth.y_m[k] * 1000);
      if (e > peak) peak = e;
      if (e > tol) lastOut = t;
    }
    const ks = R.t_s.filter((t) => t >= t0 && t < t1);
    const recovered = lastOut == null ? 0 : (ks.length && lastOut < ks[ks.length - 1] ? +(R.t_s[R.t_s.indexOf(lastOut) + 1] - t0).toFixed(3) : null);
    disturbances.push({ t_s: t0, type: evs[i].type, peak_err_mm: +peak.toFixed(2), recovery_s: recovered });
  }
  return {
    success, status, completed,
    stepinfo: si, t_step_s: tStep,
    itae, iae, u_tv_rad: utv,
    u_sat_ratio: nu ? nsat / nu : 0,
    fallback_ratio: n ? nfb / n : 0,
    lost_ratio: n ? nlost / n : 0,
    outlier_ratio: n ? nout / n : 0,
    end_hit, end_hits,
    final_err_mm: finalErr,
    meas_err_rms_mm: rmsMeasErr(R),
    disturbances,
    n,
  };
}

/** 측정(제어기가 본 값) − 참값 RMS [mm]: 센서 경로가 얼마나 흐린지 */
function rmsMeasErr(R) {
  let s = 0, c = 0;
  for (let k = 0; k < R.t_s.length; k++) {
    const y = R.y_meas_m[k];
    if (Number.isFinite(y)) { const d = (y - R.truth.y_m[k]) * 1000; s += d * d; c++; }
  }
  return c ? Math.sqrt(s / c) : null;
}

