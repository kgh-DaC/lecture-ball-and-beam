// 제어 루프 러너 (controller-interface.md §8, architecture §2).
// - D 줄 수신 이벤트 구동(타이머 아님). dt = 장치 시각 t_ms 차이.
// - mm·cdeg ↔ m·rad 변환은 이 파일 한 곳에서만 한다.
// - 하트비트 B, 비상 정지, 2 s 자동 저장, 연결 끊김 시 complete=false로 마무리.
// - 그래프는 ring을 rAF에서 읽는다(렌더링과 제어 분리).

import { heartbeatHint, disconnectHint } from '../serial/troubleshoot.js';
import { Ring, Stat } from './clock.js';
import { refAt, durationOf } from '../store/profile.js';
import { newSessionId } from '../store/session.js';
import { cmd } from '../serial/writer.js';
import { HEARTBEAT_MS, AUTOSAVE_MS, RING_SIZE } from '../config/defaults.js';
import { withTrimDir } from '../config/hw-records.js';

const RAD2CDEG = 18000 / Math.PI;
const CDEG2RAD = Math.PI / 18000;

/**
 * 포텐쇼미터 원값 → 서보 혼 각도(서보각 − 90°)·100 [cdeg] (data-schema §4.2).
 * 직선 v = c·raw² + a·raw + b. basis 'servo_horn'(기본: 보정 기록·프리셋·트윈) 이면 v 가 곧 혼 각도,
 * basis 'cmd'(07장 마법사: 명령각에 맞춤) 이면 맞춘 때의 cal_trim_cdeg·cal_dir 로 혼 각도 = cal_trim + cal_dir·v (그 값이 없으면 null → 변환 불가 표시)
 */
export function potToHornCdeg(raw, cal) {
  if (!cal || !Number.isFinite(raw)) return NaN;
  const v = (cal.c || 0) * raw * raw + cal.a_cdeg_per_lsb * raw + cal.b_cdeg;
  if (cal.basis === 'cmd') return Number.isFinite(cal.cal_trim_cdeg) ? cal.cal_trim_cdeg + (cal.cal_dir === -1 ? -1 : 1) * v : null;
  return v;
}

/**
 * 포텐쇼미터 원값 → 명령 좌표 θ cdeg (cmd 0 = 수평). 펌웨어 deg_servo = 90 + trim/100 + dir·cmd/100 을 뒤집는다:
 *   θ_cmd = dir·((서보각 − 90°)·100 − trim) = dir·(horn − trim)
 * cal.trim_cdeg·cal.dir 가 없으면 trim 0·dir 1(예전 식과 같음). basis 'cmd' 이고 맞춘 때의 trim 을 모르면 직선 값을 그대로 쓴다.
 */
export function potToCdeg(raw, cal) {
  if (!cal || !Number.isFinite(raw)) return NaN;
  const horn = potToHornCdeg(raw, cal);
  if (horn === null) return (cal.c || 0) * raw * raw + cal.a_cdeg_per_lsb * raw + cal.b_cdeg;
  const trim = Number.isFinite(cal.trim_cdeg) ? cal.trim_cdeg : 0;
  const dir = cal.dir === -1 ? -1 : 1;
  return dir * (horn - trim);
}

/** 세션 메타 calibration 필드(data-schema §2.1): 변환 계수 + 기준 + 쓴 trim·dir */
export function calibrationMeta(cal) {
  if (!cal) return { source: 'none', ref: null };
  const m = { source: cal.source, ref: cal.ref ?? null, a_cdeg_per_lsb: cal.a_cdeg_per_lsb, b_cdeg: cal.b_cdeg, c: cal.c || 0, basis: cal.basis || 'servo_horn',
    trim_cdeg: Number.isFinite(cal.trim_cdeg) ? cal.trim_cdeg : 0, dir: cal.dir === -1 ? -1 : 1 };
  if (cal.record_id) m.record_id = cal.record_id;
  if (Number.isFinite(cal.cal_trim_cdeg)) { m.cal_trim_cdeg = cal.cal_trim_cdeg; m.cal_dir = cal.cal_dir === -1 ? -1 : 1; }
  return m;
}

/** D 메시지 → 기록 행(제어 입력 제외). 단위 변환의 기준 */
export function rowFromSample(d, t0_ms, prev_t_ms, cal) {
  const lost = d.dist_mm < 0 ? 1 : 0;
  const pot = potToCdeg(d.pot_raw, cal);
  return {
    t_s: (d.t_ms - t0_ms) / 1000,
    ref_mm: NaN,
    y_mm: lost ? NaN : d.dist_mm,
    y_filt_mm: d.filt_mm < 0 ? NaN : d.filt_mm,
    u_cdeg: NaN,
    cmd_echo_cdeg: d.cmd_cdeg,
    servo_pot_cdeg: Number.isFinite(pot) ? Math.round(pot) : NaN,
    pot_raw: d.pot_raw,
    mode: d.mode,
    dt_ms: prev_t_ms == null ? NaN : d.t_ms - prev_t_ms,
    lost,
  };
}

/** 제어기 파라미터가 실기 제한(device_max/device_allowed)을 어기는지. 반환: 위반 메시지 배열 */
export function deviceViolations(meta, params) {
  const out = [];
  for (const p of meta.params || []) {
    const v = params[p.key];
    if (p.device_max != null && typeof v === 'number' && v > p.device_max) out.push(`${p.label || p.key} ${v} > 실기 상한 ${p.device_max}`);
    if (p.device_allowed && v != null && !p.device_allowed.includes(v)) out.push(`${p.label || p.key} = ${v} 는 실기에서 허용되지 않음`);
  }
  return out;
}

export class Runner {
  /** deps: { device, store, control: () => ctx.control, getCalibration: () => Promise<cal|null>, onEvent(ev) } */
  constructor(deps) {
    this.deps = deps;
    this.ring = new Ring(RING_SIZE);
    this.state = 'idle';
    this.tickListeners = new Set();
    this.stateListeners = new Set();
    this.finishListeners = new Set();
    this.dtStat = new Stat();
    this.latStat = new Stat();
    this.monitorT0 = null;
    this.session = null;
    deps.device.onSample((d) => this._onSample(d));
    deps.device.onStatus((s, info) => { if (s !== 'connected' && this.state === 'running') this._abort('disconnect', info); });
    deps.device.onError((e) => { if (e.code === 4 && this.state === 'running') this._abort('heartbeat'); });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === 'running') this._event({ type: 'warn', message: '실험 중 탭을 전환하면 브라우저가 타이머를 늦춥니다. 이 탭을 앞에 두세요.' });
      });
    }
  }

  onTick(fn) { this.tickListeners.add(fn); return () => this.tickListeners.delete(fn); }
  onState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }
  /** 실험 종료(정상·중단 모두). fn({ session_id, complete, reason, meta }) */
  onFinish(fn) { this.finishListeners.add(fn); return () => this.finishListeners.delete(fn); }

  /** start 후 그 세션이 끝날 때까지 기다린다. 반환 { session_id, complete, reason, meta } */
  async runOnce(opts) {
    let off = null;
    const sidBox = {};
    const done = new Promise((resolve) => { off = this.onFinish((ev) => { if (!sidBox.id || ev.session_id === sidBox.id) resolve(ev); }); });
    try { sidBox.id = await this.start(opts); } catch (e) { off(); throw e; }
    const ev = await done;
    off();
    return ev;
  }
  _setState(s) { this.state = s; for (const f of this.stateListeners) f(s, this); }
  _event(ev) { this.deps.onEvent && this.deps.onEvent(ev); }

  get stats() {
    return { dt_mean_ms: this.dtStat.mean, dt_max_ms: this.dtStat.maxOrNull, host_lat_mean_ms: this.latStat.mean, host_lat_max_ms: this.latStat.maxOrNull };
  }

  /**
   * 실험 시작.
   * opts: { controller: {id, params}, profile, chapter_id, title, y_source='filt', model_kind, lim_cdeg, fs_ms, alpha,
   *         run_group, attempt, notes, kind='control', extraMeta }
   * 반환: session_id
   */
  async start(opts) {
    const dev = this.deps.device;
    if (this.state === 'running' || this.state === 'starting') throw new Error('이미 실행 중입니다');
    if (dev.mode === 'sample') throw new Error('샘플 재생 모드에서는 실험을 실행할 수 없습니다. 장치·가상 장치·디지털 트윈 모드로 바꾸세요.');
    if (!dev.connected) throw new Error('장치가 연결되어 있지 않습니다');
    if (dev.protoMismatch) throw new Error(`프로토콜 버전 불일치(장치 ${dev.hello?.proto_ver}, 앱 1). 펌웨어를 갱신하세요.`);
    this._setState('starting');
    try {
      const control = await this.deps.control();
      const C = control.getController(opts.controller.id);
      if (!C) throw new Error(`제어기 ${opts.controller.id} 를 찾을 수 없습니다`);
      const params = { ...defaultsOf(C.meta), ...(opts.controller.params || {}) };
      if (dev.mode === 'device') {
        const v = deviceViolations(C.meta, params);
        if (v.length) throw new Error('실기 제한 위반: ' + v.join('; '));
      }
      // 장치 설정(IDLE에서): 각도 한계·주기·필터
      const want = {};
      // 각도 한계: 챕터 값과 하드웨어 구성에서 정한 장치 한계(settings.device.lim) 중 작은 쪽
      const hwLim = dev.deps && dev.deps.settings && dev.deps.settings.device ? dev.deps.settings.device.lim : 3000;
      if (opts.lim_cdeg != null) want.lim = Math.min(3000, hwLim ?? 3000, Math.round(opts.lim_cdeg));
      else if (hwLim != null && hwLim < 3000) want.lim = hwLim;
      if (opts.fs_ms != null) want.fs = Math.max(60, Math.round(opts.fs_ms));
      if (opts.alpha != null) want.alpha = Math.round(opts.alpha * 1000);
      if (Object.keys(want).length) {
        if (dev.devMode !== 0) { await dev.setDeviceMode(0); }
        const res = await dev.configure(want, Object.keys(want));
        const bad = res.filter((r) => !r.ok);
        if (bad.length) throw new Error('장치 설정 실패: ' + bad.map((b) => `${b.key}(${b.err})`).join(', '));
      }
      const lim = dev.config.lim ?? 3000;
      const fs = dev.config.fs ?? 60;
      const modelKind = opts.model_kind || 'ball';
      const model = control.currentModel ? control.currentModel(modelKind) : null;
      // 가상 장치의 플랜트 = 챕터 practice.model (chapter-format §4). 디지털 트윈은 설계 모델 보관만(물리 불변)
      if (dev.virtual && model) dev.virtual.setModel(model);
      // 디지털 트윈: 시나리오 사건 큐·파라미터를 처음 상태로(시나리오 시각 0 = 이번 M,1)
      if (dev.twin && dev.prepareTwinRun) dev.prepareTwinRun();
      // 가상 장치: 공을 시작 위치에 놓는다(실기에서는 학생이 손으로 놓는다)
      if (dev.virtual && Number.isFinite(opts.place_ball_mm)) dev.virtual.placeBall(opts.place_ball_mm / 1000);
      const ctrl = new C(params, { model, Ts_s: fs / 1000, u_lim_rad: lim * CDEG2RAD, mode: dev.mode === 'device' ? 'device' : 'virtual' });
      const profile = opts.profile;
      ctrl.reset({ t_s: 0, ref_m: refAt(profile, 0) / 1000, y_m: NaN, u_rad: 0, theta_rad: NaN });
      const cal = this._devTrim(await this.deps.getCalibration());
      const store = this.deps.store;
      const sid = newSessionId(opts.chapter_id);
      const meta = {
        session_id: sid, kind: 'control', chapter_id: opts.chapter_id || null,
        source: dev.mode === 'device' ? 'device' : 'virtual',
        title: opts.title || `${C.meta.label} 시도`,
        device: dev.deviceMeta(),
        controller: { id: C.meta.id, params, y_source: opts.y_source || 'filt' },
        plant_params: model ? { ...model.plant_params, K_b: model.K_b } : null,
        model_kind: model ? model.kind : (modelKind === 'ball+servo' ? 'ball_servo' : 'ball_only'),
        servo_tf: model && model.servo ? model.servo : null,
        calibration: calibrationMeta(cal),
        setpoint_profile: profile,
        sample_period_ms: fs,
        conditions: { status: 'known' },
        run_group: opts.run_group || null,
        attempt: opts.attempt || null,
        notes: opts.notes || '',
        ...(opts.extraMeta || {}),
      };
      if (dev.mode === 'virtual') meta.notes = (meta.notes ? meta.notes + ' | ' : '') + '가상 장치(시뮬레이션) 세션';
      // 디지털 트윈(docs/spec/digital-twin.md §8): source 는 기존 'virtual' 유지(provenance simulated), device.mode = 'twin'
      const tw = dev.twinSessionMeta ? dev.twinSessionMeta() : null;
      if (tw) {
        meta.source = tw.source || 'virtual';
        meta.device = { ...meta.device, ...tw.device_patch };
        meta.notes = (meta.notes ? meta.notes + ' | ' : '') + (tw.notes || '디지털 트윈(시뮬레이션) 세션');
      }
      this.session = await store.create(meta);
      this.run = {
        sid, ctrl, C, params, profile, cal, lim, fs, y_source: opts.y_source || 'filt',
        t0_ms: null, prev_t_ms: null, lastU: 0, lastSendAt: performance.now(), dur: durationOf(profile),
        debugKeys: C.meta.debug_keys || [], n: 0,
      };
      this.dtStat.reset(); this.latStat.reset();
      this.ring.clear({ session_id: sid, provenance: dev.provenance, controller: C.meta.id, profile, ...(tw ? { twin: true, scenario: tw.device_patch.scenario } : {}) });
      this._setState('running');
      await dev.setDeviceMode(1);
      this.hb = setInterval(() => {
        if (this.state !== 'running') return;
        if (performance.now() - this.run.lastSendAt >= HEARTBEAT_MS) { dev.send(cmd.beat()).catch(() => {}); this.run.lastSendAt = performance.now(); }
      }, HEARTBEAT_MS / 2);
      this.saver = setInterval(() => store.flush(sid).catch((e) => console.warn('자동 저장 실패', e)), AUTOSAVE_MS);
      return sid;
    } catch (e) {
      this._setState('idle');
      throw e;
    }
  }

  setParams(partial) {
    if (this.state !== 'running') return;
    const dev = this.deps.device;
    if (dev.mode === 'device') {
      const v = deviceViolations(this.run.C.meta, { ...this.run.params, ...partial });
      if (v.length) { this._event({ type: 'warn', message: '실기 제한: ' + v.join('; ') }); return; }
    }
    Object.assign(this.run.params, partial);
    this.run.ctrl.setParams(partial);
    this.run.paramChanges = (this.run.paramChanges || []).concat([{ t_s: this.ring.last()?.t_s ?? 0, ...partial }]);
  }

  _onSample(d) {
    if (this.state === 'running' && d.mode === 1) return this._control(d);
    if (this.state === 'running' || this.state === 'starting' || this.state === 'stopping' || this.state === 'replay') return;
    // 모니터(IDLE 스트림): 그래프·장치 점검용
    if (this.monitorT0 == null || d.t_ms < this.monitorPrev) { this.monitorT0 = d.t_ms; this.ring.clear({ monitor: true, provenance: this.deps.device.provenance, ...(this.deps.device.twin ? { twin: true } : {}) }); }
    const cal = (this._monCal = this._devTrim(this._monCal));
    const row = rowFromSample(d, this.monitorT0, this.monitorPrev ?? null, cal);
    this.monitorPrev = d.t_ms;
    this.ring.push(row);
    for (const f of this.tickListeners) f(row, null);
  }

  _control(d) {
    const r = this.run;
    const recv = d.recv_ms ?? performance.now();
    if (r.t0_ms == null) r.t0_ms = d.t_ms;
    const row = rowFromSample(d, r.t0_ms, r.prev_t_ms, r.cal);
    const dt_s = r.prev_t_ms == null ? r.fs / 1000 : (d.t_ms - r.prev_t_ms) / 1000;
    r.prev_t_ms = d.t_ms;
    if (Number.isFinite(row.dt_ms)) this.dtStat.add(row.dt_ms);
    const ref_mm = refAt(r.profile, row.t_s);
    row.ref_mm = ref_mm;
    // 유실 샘플은 y_source와 상관없이 NaN(장치는 유실 때도 이전 filt 값을 보내므로). 제어기의 유실 처리 경로가 동작하게 한다.
    const ymm = row.lost === 1 ? NaN : (r.y_source === 'raw' ? row.y_mm : row.y_filt_mm);
    const y_m = Number.isFinite(ymm) ? ymm / 1000 : NaN;
    const theta = Number.isFinite(row.servo_pot_cdeg) ? row.servo_pot_cdeg * CDEG2RAD : NaN;
    let u_rad;
    try {
      u_rad = r.ctrl.update(ref_mm / 1000, y_m, dt_s, { theta_rad: theta, y_raw_m: Number.isFinite(row.y_mm) ? row.y_mm / 1000 : NaN });
    } catch (e) {
      console.error('제어기 update 오류', e);
      this._event({ type: 'error', message: `제어기 오류: ${e.message}` });
      this.estop();
      return;
    }
    if (!Number.isFinite(u_rad)) u_rad = r.lastU;
    r.lastU = u_rad;
    const u_cdeg = Math.max(-r.lim, Math.min(r.lim, Math.round(u_rad * RAD2CDEG)));
    row.u_cdeg = u_cdeg;
    this.deps.device.send(cmd.servo(u_cdeg)).catch(() => {});
    r.lastSendAt = performance.now();
    this.latStat.add(r.lastSendAt - recv);
    const dbg = r.ctrl.debug || {};
    for (const k of r.debugKeys) {
      const v = dbg[k];
      row[`dbg_${k}`] = typeof v === 'boolean' ? (v ? 1 : 0) : (typeof v === 'number' ? v : NaN);
    }
    r.n++;
    this.deps.store.append(r.sid, row);
    this.ring.push(row);
    for (const f of this.tickListeners) f(row, dbg);
    if (row.t_s >= r.dur) this.stop('done');
    if (this.dtStat.maxOrNull > 2 * r.fs && !r.dtWarned) { r.dtWarned = true; this._event({ type: 'warn', message: `샘플 간격 최대 ${this.dtStat.maxOrNull} ms > 2×${r.fs} ms. 다른 프로그램이나 탭 전환을 확인하세요.` }); }
  }

  async _finish(complete, reason) {
    clearInterval(this.hb); clearInterval(this.saver);
    const r = this.run;
    if (!r) return null;
    this.run = null;
    const statsExtra = { ...this.stats };
    const patch = { complete, stats: statsExtra, end_reason: reason };
    if (r.paramChanges) patch.param_changes = r.paramChanges;
    patch.controller = { id: r.C.meta.id, params: r.params, y_source: r.y_source };
    const meta = await this.deps.store.finish(r.sid, patch);
    this._setState('idle');
    this.monitorT0 = null;
    const ev = { type: 'finished', session_id: r.sid, complete, reason, meta };
    this._event(ev);
    for (const f of this.finishListeners) { try { f(ev); } catch (e) { console.error(e); } }
    return meta;
  }

  async stop(reason = 'user') {
    if (this.state !== 'running') return null;
    this._setState('stopping');
    try { await this.deps.device.setDeviceMode(0); } catch (e) { await this.deps.device.estop(); }
    return this._finish(reason === 'done' || reason === 'user', reason);
  }

  async _abort(reason) {
    if (this.state !== 'running') return;
    this._setState('stopping');
    const msg = reason === 'heartbeat' ? '하트비트 만료로 장치가 IDLE로 돌아갔습니다' : '장치 연결이 끊겼습니다';
    const hint = this.deps.device && this.deps.device.mode === 'device' ? ` ${reason === 'heartbeat' ? heartbeatHint() : disconnectHint()}` : '';
    const meta = await this._finish(false, reason);
    this._event({ type: 'error', message: `${msg}. 마지막 시점까지의 데이터는 세션 ${meta?.session_id || ''}에 저장되었습니다.${hint}` });
  }

  /** 비상 정지: 루프와 무관하게 즉시 M,0 */
  async estop() {
    // 상태를 먼저 바꿔 이후 D 수신에서 S를 더 보내지 않게 한다
    const wasRunning = this.state === 'running';
    if (wasRunning) this._setState('stopping');
    await this.deps.device.estop();
    if (wasRunning) await this._finish(false, 'estop');
    if (this.replayTimer) this.stopReplay();
  }

  /** 저장된 세션/샘플을 링 버퍼로 재생(읽기 전용). speed 배속 */
  replay({ meta, rows }, { speed = 1, onDone } = {}) {
    this.stopReplay();
    if (this.state === 'running') throw new Error('실험 중에는 재생할 수 없습니다');
    this.ring.clear({ replay: true, session_id: meta.session_id || meta.id, provenance: meta.provenance });
    this._setState('replay');
    const t0 = performance.now();
    let i = 0;
    this.replayTimer = setInterval(() => {
      const tNow = (performance.now() - t0) / 1000 * speed + (rows[0]?.t_s || 0);
      while (i < rows.length && rows[i].t_s <= tNow) { this.ring.push(rows[i]); for (const f of this.tickListeners) f(rows[i], null); i++; }
      if (i >= rows.length) { this.stopReplay(); onDone && onDone(); }
    }, 30);
  }

  stopReplay() {
    if (this.replayTimer) { clearInterval(this.replayTimer); this.replayTimer = null; if (this.state === 'replay') this._setState('idle'); }
  }

  /** 장치가 보고한 trim·dir(device.config)가 있으면 cal 에 반영(P,trim 을 저장 없이 보낸 뒤에도 θ 가 맞게). 없으면 cal 그대로 */
  _devTrim(cal) {
    const c = this.deps.device && this.deps.device.config;
    if (!cal || !c || (c.trim == null && c.dir == null)) return cal;
    return withTrimDir(cal, c.trim ?? cal.trim_cdeg, c.dir ?? cal.dir);
  }

  /** 모니터 행에 쓸 캘리브레이션 갱신 */
  async refreshCalibration() { this._monCal = await this.deps.getCalibration(); }
}

export function defaultsOf(meta) {
  const o = {};
  for (const p of meta.params || []) if (p.default !== undefined) o[p.key] = p.default;
  return o;
}
