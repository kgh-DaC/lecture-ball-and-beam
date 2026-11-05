// twin-device.js — 디지털 트윈을 실제 장치와 같은 전송 인터페이스로 노출한다 (모드 이름 'twin').
//
// - 펌웨어 프로토콜 처리(H/C/D/A/E 줄, M·S·B·P·I 명령, 하트비트 500 ms, lim·hard_lim, ID 모드)는
//   sim/virtual-device.js 의 VirtualDevice 를 그대로 물려받는다. 그래서 안전 규칙과 줄 형식이 가상 장치·펌웨어와 같다.
// - 바꾸는 것은 물리와 측정뿐이다: stepPlant(설계 모델) 대신 TwinPlant(비선형 + 비이상성).
// - 제어기는 D 줄(센서 출력)만 받는다. 참 상태는 별도 콜백 onTruth / getTruth()(화면·채점용)로만 나간다.
//   선택적으로 프로토콜을 깨지 않는 확장 줄 '#T,…'·'#E,…'를 낼 수 있다(emit_ext_lines, 기본 끔 — 파서는 '#' 줄을 버린다).
// - 시나리오의 외란·센서 고장·파라미터 변화는 첫 HOST 진입(M,1 수락) 시각을 0 으로 해 실행한다.
//   설정값(ref)은 장치가 아닌 호스트(러너) 몫이므로 scenarioProfile() 로 프로파일을 꺼내 러너에 준다.
import { VirtualDevice } from '../virtual-device.js';
import { TwinPlant, applyVariation, normalizeParams } from './twin.js';
import { normalizeScenario, scenarioToProfile } from './scenario.js';
import { PRESET_POT_CAL, potRaw, makeRng, subSeed, FirmwareFilter, DESPIKE_MODES } from './sensor.js';

export const TWIN_FW_VER = 'twin-1.0.0';

export class TwinDevice extends VirtualDevice {
  /**
   * @param opts {
   *   params,                 트윈 파라미터(paramsFromJson(...).params) — 필수
   *   params_ref = 'unknown', params.json 의 id(세션 메타 기록용)
   *   seed = 1, scenario = null, y0_m = 0.17,
   *   realtime = true, speed = 1,
   *   emit_ext_lines = false, truth_every_ms = 20
   * }
   */
  constructor(opts = {}) {
    if (!opts.params) throw new Error('TwinDevice: params(트윈 파라미터)가 필요합니다');
    // stepPlant 는 쓰지 않는다(물리는 TwinPlant). VirtualDevice.open() 검사만 통과시키는 자리표시.
    super({ ...opts, sim: { stepPlant: () => null, initPlantState: null }, model: opts.design_model ?? null, seed: opts.seed ?? 1 });
    this.kind = 'twin';
    this.fw_ver = TWIN_FW_VER;
    this.baseParams = normalizeParams(opts.params);
    // 펌웨어 1.1.0 거리 필터(despike → 재귀 필터). 부팅 값은 params loop.despike (C,despike 로 보고, P,despike 로 변경)
    this.cfg.despike = this.baseParams.loop.despike;
    this.fwFilter = new FirmwareFilter(this.cfg.alpha, true, this.cfg.despike);
    this.params_ref = opts.params_ref || 'unknown';
    this.twinSeed = (opts.seed ?? 1) >>> 0 || 1;
    this.emitExt = !!opts.emit_ext_lines;
    this.truthEveryMs = opts.truth_every_ms ?? 20;
    this.truthListeners = new Set();
    this.eventListeners = new Set();
    this.measureListeners = new Set();
    this.designModel = opts.design_model ?? null;
    this.scenario = null;
    this._buildTwin(opts.scenario ? normalizeScenario(opts.scenario) : null);
  }

  _buildTwin(scenario) {
    this.scenario = scenario;
    const p = scenario ? applyVariation(this.baseParams, scenario.param_scale, scenario.param_offset) : this.baseParams;
    this.twin = new TwinPlant(p, { seed: this.twinSeed });
    // 시나리오 loop.despike 가 있으면 호스트가 P,despike 를 보낸 것처럼 적용(없으면 params 값). 상태만 비우고 filt 유지
    if (this.fwFilter) {
      const d = scenario && scenario.loop.despike != null ? scenario.loop.despike : this.baseParams.loop.despike;
      if (d !== this.cfg.despike || d !== this.fwFilter.despikeMode) { this.cfg.despike = d; this.fwFilter.setDespike(d); }
    }
    this.rPot = makeRng(subSeed(this.twinSeed, 'device.pot'));
    this._scReset();
  }

  _scReset() {
    this.scT0 = null;
    this.scQueue = [];
    if (this.scenario) {
      for (const d of this.scenario.disturbance) this.scQueue.push({ t: d.t, kind: 'dist', ev: d });
      for (const f of this.scenario.sensor_fault) this.scQueue.push({ t: f.t, kind: 'fault', ev: f });
      for (const e of this.scenario.safety_events) this.scQueue.push({ t: e.t, kind: 'safety', ev: e });
      this.scQueue.sort((a, b) => a.t - b.t);
    }
    this.nextTruthMs = 0;
    this._lastU = NaN;
    this._divergedSent = false;
  }

  // ---------------------------------------------------------------- 이벤트 구독
  onTruth(fn) { this.truthListeners.add(fn); return () => this.truthListeners.delete(fn); }
  onEvent(fn) { this.eventListeners.add(fn); return () => this.eventListeners.delete(fn); }
  /** D 줄 하나마다 { D 필드, lost, outlier, fault, truth } — 측정 vs 참값 그래프용 */
  onMeasure(fn) { this.measureListeners.add(fn); return () => this.measureListeners.delete(fn); }
  _emitSet(set, x) { for (const f of set) { try { f(x); } catch (e) { console.error(e); } } }
  _event(ev) {
    const e = { t_ms: Math.round(this.t_ms ?? 0), ...ev };
    this._emitSet(this.eventListeners, e);
    if (this.emitExt) this._out(`#E,${e.t_ms},${e.type}`);
  }

  // ---------------------------------------------------------------- VirtualDevice 재정의
  async open(o) {
    this._scReset();
    this.fwFilter.reset();
    const r = await super.open(o);
    return { ...r, twin: true };
  }

  _resetPlant() {
    this.twin.reset({ y_m: this.y0_m, ydot_m_s: 0, theta_rad: 0, t_s: (this.t_ms || 0) / 1000 });
    this._lastU = NaN;
  }

  /** 설계 모델 교체 요청(러너가 챕터 모델을 넘김): 트윈 물리는 바꾸지 않는다(모델 불일치가 핵심) */
  setModel(model) { this.designModel = model; this.model = model; }

  /** 공을 손으로 옮겨 놓기: 서보·시나리오 상태는 그대로, 펌웨어 필터는 새 위치에서 다시 시작 */
  placeBall(y_m) {
    this.y0_m = y_m;
    this.twin.placeBall(y_m, 0);
    this.filt = -1;
    this.fwFilter.reset();
  }

  /** P,despike (펌웨어 1.1.0, 모든 모드에서 허용) 만 여기서 처리하고 나머지는 VirtualDevice 규칙 그대로 */
  _param(f) {
    if (f[1] !== 'despike') return super._param(f);
    if (f.length !== 3) return this._out('E,1,format');
    if (!/^-?\d+$/.test(f[2])) return this._out('E,1,format');
    const v = +f[2];
    if (!DESPIKE_MODES.includes(v)) return this._out('E,2,range');
    this.cfg.despike = v;
    this.fwFilter.setDespike(v);     // 이상값 제거 상태만 비우고 filt 값은 유지
    this._out('A,P,despike'); this._out(`C,despike,${v}`);
  }

  _hello() {
    this._out(`H,1,${this.fw_ver}`);
    for (const [k, v] of Object.entries(this.cfg)) this._out(`C,${k},${v}`);
    for (const [k, v] of Object.entries(this.ro)) this._out(`C,${k},${v}`);
  }

  _physics(dt) {
    if (this.twin.diverged) {
      if (!this._divergedSent) { this._divergedSent = true; this._event({ type: 'diverged', reason: this.twin.diverged_reason, seed: this.twinSeed, scenario: this.scenario?.id ?? null }); }
      return;
    }
    const u = this._beamCmdRad();
    if (u !== this._lastU) { this.twin.command(u); this._lastU = u; }
    if (this.scenario && this.scT0 == null && this.mode === 1) { this.scT0 = this.t_ms; this._event({ type: 'scenario_start', scenario: this.scenario.id }); }
    while (this.scT0 != null && this.scQueue.length && (this.t_ms - this.scT0) / 1000 >= this.scQueue[0].t - 1e-9) this._applyScenarioEvent(this.scQueue.shift());
    this.twin.advance(dt);
    if (this.truthListeners.size && this.t_ms >= this.nextTruthMs) {
      this.nextTruthMs = this.t_ms + this.truthEveryMs;
      this._emitSet(this.truthListeners, this.getTruth());
    }
  }

  _applyScenarioEvent(q) {
    const e = q.ev;
    if (q.kind === 'dist') {
      switch (e.type) {
        case 'ball_push': this.twin.pushBall((e.dv_mm_s ?? 0) / 1000); break;
        case 'ball_place': this.twin.placeBall(e.y_mm / 1000); break;
        case 'beam_knock': this.twin.knockBeam(((e.dtheta_deg ?? 0) * Math.PI) / 180); break;
        case 'force': this.twin.addForce((e.a_mm_s2 ?? 0) / 1000, e.duration_s ?? 0.5); break;
        case 'param_step': this.twin.scaleParam(e.key, e.scale ?? 1); break;
        default: break;
      }
    } else if (q.kind === 'fault') this.twin.sensorFault({ ...e, t_s: this.twin.t });
    else if (q.kind === 'safety' && e.type === 'estop') this._handle('M,0'); // 호스트가 M,0 을 보낸 것과 같은 경로
    this._event({ type: e.type, kind: q.kind, scenario_t_s: e.t });
  }

  _potRaw() {
    return potRaw(this.twin.servo.theta_m, PRESET_POT_CAL, this.twin.p.servo.pot_noise_lsb, this.rPot);
  }

  _measure() {
    const m = this.twin.measure(PRESET_POT_CAL);
    const dist = m.dist_mm >= 0 ? Math.round(m.dist_mm) : -1;
    this.fwFilter.alpha_milli = this.cfg.alpha;
    const filt = this.fwFilter.push(dist);
    this.filt = this.fwFilter.f;
    const tMeas = Math.round(this.t_ms);
    this._out(`D,${tMeas},${dist},${filt},${this.cmd},${m.pot_raw},${this.mode}`);
    const truth = this.getTruth();
    if (this.emitExt) {
      const c = (r) => Math.round((r * 18000) / Math.PI);
      this._out(`#T,${tMeas},${Math.round(truth.y_m * 1e6)},${Math.round(truth.ydot_m_s * 1e6)},${c(truth.theta_servo_rad)},${c(truth.theta_link_rad)},${c(truth.alpha_rad)},${truth.at_stop}`);
    }
    if (this.measureListeners.size) {
      this._emitSet(this.measureListeners, { t_ms: tMeas, dist_mm: dist, filt_mm: filt, cmd_cdeg: this.cmd, pot_raw: m.pot_raw, mode: this.mode, lost: m.lost, outlier: m.outlier, fault: m.fault, despiked: this.fwFilter.lastRejected, truth });
    }
  }

  // ---------------------------------------------------------------- 트윈 전용 조작(화면 버튼)
  /** 참 상태(화면·채점 전용) */
  getTruth() {
    const t = this.twin.truth();
    return { ...t, t_ms: Math.round(this.t_ms ?? 0), scenario_t_s: this.scT0 == null ? null : (this.t_ms - this.scT0) / 1000 };
  }
  pushBall(dv_mm_s) { this.twin.pushBall(dv_mm_s / 1000); this._event({ type: 'ball_push', kind: 'manual', dv_mm_s }); }
  knockBeam(dtheta_deg) { this.twin.knockBeam((dtheta_deg * Math.PI) / 180); this._event({ type: 'beam_knock', kind: 'manual', dtheta_deg }); }
  applyForce(a_mm_s2, duration_s = 0.5) { this.twin.addForce(a_mm_s2 / 1000, duration_s); this._event({ type: 'force', kind: 'manual', a_mm_s2, duration_s }); }
  injectFault(fault) { this.twin.sensorFault({ ...fault, t_s: this.twin.t }); this._event({ type: fault.type, kind: 'fault_manual' }); }
  clearFaults() { this.twin.sensor.clearFaults(); }

  /** 시나리오 교체(공·서보 상태 유지, 파라미터는 시나리오 배율로 다시 계산, 시나리오 시계는 다음 M,1 에서 0) */
  setScenario(scenario) {
    const tr = this.twin.truth();
    const t = this.twin.t;
    this._buildTwin(scenario ? normalizeScenario(scenario) : null);
    this.twin.reset({ y_m: tr.y_m, ydot_m_s: tr.ydot_m_s, theta_rad: tr.theta_servo_rad, t_s: t });
  }

  /** 러너에 줄 설정값 프로파일(data-schema §2.2). 시나리오가 없거나 표현 불가면 null */
  scenarioProfile() { return this.scenario ? scenarioToProfile(this.scenario) : null; }

  /** 세션 메타에 합칠 값 (docs/spec/digital-twin.md §5) */
  sessionMeta() {
    return {
      source: 'virtual',
      provenance: 'simulated',
      device_patch: { mode: 'twin', fw_ver: this.fw_ver, scenario: this.scenario ? this.scenario.id : null, seed: this.twinSeed, params_ref: this.params_ref },
      badges: ['디지털 트윈', '시뮬레이션'],
      notes: '디지털 트윈(시뮬레이션) 세션',
    };
  }
}
