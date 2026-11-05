// 장치 관리자: 실제 장치(Web Serial) / 가상 장치 / 디지털 트윈 / 샘플 재생 모드를 같은 인터페이스로 묶는다 (chapter-format §5.2 ctx.device).
// 디지털 트윈(mode 'twin', docs/spec/digital-twin.md §3.3): sim/twin/twin-device.js 의 TwinDevice 를 만든다.
// 트윈 파라미터는 data/twin/params.json → paramsFromJson(식별 결과가 실측이면 서보 값 반영).

import { BOARD_LABEL, resetHint } from './troubleshoot.js';
import { Parser, ERROR_TEXT } from './parser.js';
import { Writer, cmd } from './writer.js';
import { WebSerialTransport, serialSupported, unsupportedReason } from './port.js';
import { VirtualDevice } from '../sim/virtual-device.js';
import { PROTO_VER, HELLO_TIMEOUT_MS } from '../config/defaults.js';
import { SEND_ORDER } from '../config/settings.js';

const IDLE_ONLY = ['trim', 'dir', 'servo_pin', 'servo_model', 'pmin', 'pmax'];
/** 호스트 동기화(protocol 1.1.0 §2.1): H·C 뒤 빈 줄을 보내고 이 시간 동안 온 E 는 무시한다 */
export const SYNC_IGNORE_MS = 50;
/** 펌웨어 1.1.0 에서 추가된 P 키 — 구 펌웨어(1.0.0)는 E,5 */
export const FW110_KEYS = ['despike'];

/** fw_ver 문자열에서 x.y.z 를 찾는다('1.1.0', '1.1.0-fake', 'virtual-1.0.0', 'twin-1.0.0'). 없으면 null */
export function parseFwVer(s) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(s ?? ''));
  return m ? [+m[1], +m[2], +m[3]] : null;
}
/** 펌웨어 1.2.0 에서 추가된 P 키(조립 전 벤치 모드). C 목록에는 없다(C 17줄 그대로, bench 중 C,hard_lim 이 9000) */
export const FW120_KEYS = ['bench'];
/** 벤치 모드 하드 한계(cdeg, 펌웨어 BENCH_HARD_LIM_CDEG) */
export const BENCH_HARD_LIM_CDEG = 9000;

/**
 * 펌웨어 기능 판별(순수). C,despike 가 왔으면 1.1.0 기능 있음, 아니면 fw_ver ≥ 1.1.0 일 때 있음.
 * bench(P,bench): fw_ver ≥ 1.2.0 일 때만(C 줄로는 알 수 없다). 1.0.0·1.1.0·트윈은 false
 */
export function fwFeatures(hello, config = {}) {
  const v = parseFwVer(hello?.fw_ver);
  const ge = (a, b) => (v ? (v[0] > a || (v[0] === a && v[1] >= b)) : false);
  const despike = config.despike != null || ge(1, 1);
  return { fw_ver: hello?.fw_ver ?? null, semver: v ? v.join('.') : null, despike, legacy: !despike, bench: ge(1, 2) };
}

/** 연결 모드와 화면 이름 */
export const MODES = ['device', 'virtual', 'twin', 'sample'];
export const MODE_LABEL = { device: '실제 장치', virtual: '가상 장치', twin: '디지털 트윈', sample: '샘플 재생' };
/** 시뮬레이션 모드(가상 장치·디지털 트윈): 공 배치·모델 교체가 되고, 실기 전용 차단을 걸지 않는다 */
export const isSimMode = (m) => m === 'virtual' || m === 'twin';

export class DeviceManager {
  /** @param {{ settings, loadSim: () => Promise<{sim, model}>, loadTwin?: () => Promise<{params, ref, provenance}> }} deps */
  constructor(deps) {
    this.deps = deps;
    this.mode = deps.settings?.ui?.mode || 'virtual';
    if (!MODES.includes(this.mode)) this.mode = 'virtual';
    if (this.mode === 'device' && !serialSupported()) this.mode = 'virtual';
    /** 디지털 트윈 연결 옵션: 시나리오(normalizeScenario 결과 또는 null), 시드 */
    this.twinOpts = { scenario: null, seed: 1 };
    this.twinInfo = null; // { params, ref, provenance, measuredCount } — 마지막으로 읽은 트윈 파라미터
    this.status = 'disconnected';
    this.transport = null;
    this.writer = null;
    this.parser = new Parser();
    this.hello = null;
    this.protoMismatch = false;
    this.config = {};
    this.devMode = null;
    this.unsupported = new Set();
    this.lastError = null;
    this.log = [];
    this.resetCount = 0; // 연결 중 H 재수신(보드 리셋) 횟수 — 서보 전원 부족 진단용
    this.L = { line: new Set(), sample: new Set(), status: new Set(), error: new Set(), notice: new Set() };
  }

  get supported() { return serialSupported(); }
  get unsupportedReason() { return unsupportedReason(); }
  get connected() { return this.status === 'connected'; }
  /** 데이터 출처 배지용 */
  get provenance() { return this.mode === 'device' ? 'real' : 'simulated'; }
  get modeLabel() { return MODE_LABEL[this.mode] || this.mode; }

  onLine(fn) { this.L.line.add(fn); return () => this.L.line.delete(fn); }
  onSample(fn) { this.L.sample.add(fn); return () => this.L.sample.delete(fn); }
  onStatus(fn) { this.L.status.add(fn); return () => this.L.status.delete(fn); }
  onError(fn) { this.L.error.add(fn); return () => this.L.error.delete(fn); }
  /** 진단 알림: { kind: 'reset', count, message } (연결 중 보드 리셋 감지) */
  onNotice(fn) { this.L.notice.add(fn); return () => this.L.notice.delete(fn); }
  _emit(set, ...a) { for (const f of set) { try { f(...a); } catch (e) { console.error(e); } } }
  _setStatus(s, info) { this.status = s; this._emit(this.L.status, s, info); }

  async setMode(m) {
    if (m === this.mode) return;
    if (!MODES.includes(m)) throw new Error(`알 수 없는 연결 모드: ${m}`);
    if (m === 'device' && !serialSupported()) throw new Error(unsupportedReason());
    if (this.connected || this.status === 'connecting') await this.disconnect();
    this.mode = m;
    this.deps.settings?.saveUi({ mode: m });
    this._setStatus('disconnected', { modeChanged: true });
  }

  async connect({ reuse = false } = {}) {
    if (this.mode === 'sample') throw new Error('샘플 재생 모드에서는 연결하지 않습니다');
    if (this.connected) return;
    this._setStatus('connecting');
    this.hello = null; this.config = {}; this.devMode = null; this.protoMismatch = false; this.unsupported.clear(); this.resetCount = 0; this.bench = 0;
    this.syncIgnoreUntil = 0; this.syncIgnored = [];
    this.parser = new Parser();
    try {
      if (this.mode === 'device') {
        this.transport = new WebSerialTransport();
      } else if (this.mode === 'twin') {
        this.transport = await this._makeTwin();
      } else {
        const { sim, model } = await this.deps.loadSim();
        this.transport = new VirtualDevice({ sim, model, seed: (Date.now() & 0xffff) || 1, ...(this.deps.virtualOpts || {}) });
      }
      this.transport.onText((t) => this._onText(t));
      this.transport.onClose((reason) => this._onClose(reason));
      await this.transport.open({ reuse });
      this.writer = new Writer(this.transport);
      this.writer.onSend = (l) => this._logLine('>', l);
      // H 대기(포트 열기 = 리셋, 부트로더 약 1.6 s). 3 s 안에 없으면 '?'
      let h = await this.waitFor((m) => m.type === 'H', HELLO_TIMEOUT_MS);
      if (!h) { await this.send(cmd.hello()); h = await this.waitFor((m) => m.type === 'H', 2000); }
      if (!h) throw new Error(`장치 응답(H)이 없습니다. ${BOARD_LABEL} 보드에 펌웨어를 업로드했는지(Nano 호환은 업로드 보드 "Arduino Nano", CH340 드라이버), 보드레이트(115200), 다른 프로그램이 포트를 쓰는지 확인하세요. 연결 직후 리셋이 반복되면 서보 전원 부족일 수 있습니다(설정 화면 "연결이 안 될 때" 참고).`);
      // C 목록이 이어서 온다
      if (this.config.pulse_timeout_us == null) await this.waitFor((m) => m.type === 'C' && m.key === 'pulse_timeout_us', 800);
      await this._sync();
      this._setStatus('connected', { hello: this.hello, mismatch: this.protoMismatch });
      if (!this.protoMismatch && this.deps.settings) await this.configure(this.deps.settings.device);
    } catch (e) {
      this.lastError = e.message;
      try { await this.transport?.close(); } catch { /* */ }
      this.transport = null; this.writer = null;
      this._setStatus('error', { message: e.message });
      throw e;
    }
  }

  async disconnect() {
    if (!this.transport) { this._setStatus('disconnected'); return; }
    try { if (this.connected) await this.send(cmd.mode(0), { urgent: true }); } catch { /* */ }
    this._userClose = true;
    try { await this.transport.close(); } catch { /* */ }
  }

  _onClose(reason) {
    const wasUser = this._userClose; this._userClose = false;
    this.transport = null; this.writer = null; this.devMode = null;
    this._setStatus('disconnected', { reason, unexpected: !wasUser });
  }

  /**
   * 호스트 동기화(protocol 1.1.0 §2.1): 빈 줄 '\n'을 한 번 보내 장치 수신 버퍼에 남은 쓰레기 부분 줄을 끝내고,
   * 그 뒤 SYNC_IGNORE_MS 동안 온 E(쓰레기 줄의 E,5·E,1, 또는 빈 줄에 E,5를 주는 구 펌웨어)는 오류로 내보내지 않는다.
   * 무시 창이 끝난 다음에 첫 명령(configure)을 보내므로 request()가 이 E를 자기 응답으로 세지 않는다.
   */
  async _sync() {
    this.syncIgnoreUntil = Infinity; // 쓰기 완료 전에 온 응답도 무시
    try { await this.send(''); } catch { /* 연결 문제는 다음 명령에서 드러난다 */ }
    this.syncIgnoreUntil = performance.now() + SYNC_IGNORE_MS;
    await new Promise((r) => setTimeout(r, SYNC_IGNORE_MS));
    this.syncIgnoreUntil = 0;
  }

  /** 펌웨어 기능(1.0.0 / 1.1.0 판별). 연결 전이면 hello 없음 → legacy */
  get fw() { return fwFeatures(this.hello, this.config); }
  /** 이 키를 장치가 받는가(모르면 true). 1.0.0 에는 despike 없음 */
  supportsKey(key) {
    if (this.unsupported.has(key)) return false;
    if (FW110_KEYS.includes(key) && this.hello) return this.fw.despike;
    if (FW120_KEYS.includes(key)) return !!this.hello && this.fw.bench;
    return true;
  }

  _logLine(dir, line) { this.log.push(`${dir} ${line}`); if (this.log.length > 400) this.log.shift(); }

  _onText(text) {
    for (const { line, msg } of this.parser.feed(text)) {
      if (!msg || msg.type !== 'D') this._logLine('<', line);
      if (!msg) continue;
      switch (msg.type) {
        case 'H':
          if (this.status === 'connected') {
            // 연결 중 H 재수신 = 보드 리셋(서보 전원 부족으로 전압이 처질 때 흔하다)
            this.resetCount++;
            this.devMode = 0;
            this.bench = 0; // 리셋하면 펌웨어 bench 는 0
            this._emit(this.L.notice, { kind: 'reset', count: this.resetCount, message: resetHint() });
          }
          this.hello = msg;
          this.protoMismatch = msg.proto_ver !== PROTO_VER;
          break;
        case 'C': this.config[msg.key] = msg.value; break;
        case 'D': this.devMode = msg.mode; msg.recv_ms = performance.now(); this._emit(this.L.sample, msg); break;
        case 'A': if (msg.cmd === 'M') this.devMode = Number(msg.args[0]); break;
        case 'E':
          if (this.syncIgnoreUntil && performance.now() <= this.syncIgnoreUntil) {
            this.syncIgnored.push(line); // 동기화 빈 줄 직후의 E: 오류·응답으로 세지 않는다
            continue;
          }
          this.lastError = `E${msg.code} ${ERROR_TEXT[msg.code] || ''}`;
          if (msg.code === 4) this.devMode = 0;
          this._emit(this.L.error, msg);
          break;
        default: break;
      }
      this._emit(this.L.line, msg, line);
    }
  }

  send(line, opts) {
    if (!this.writer) return Promise.reject(new Error('장치가 연결되어 있지 않습니다'));
    return this.writer.send(line, opts);
  }

  /** 조건에 맞는 메시지를 기다린다. 시간 초과면 null */
  waitFor(pred, timeoutMs) {
    return new Promise((resolve) => {
      const off = this.onLine((m) => { if (pred(m)) { clearTimeout(tm); off(); resolve(m); } });
      const tm = setTimeout(() => { off(); resolve(null); }, timeoutMs);
    });
  }

  /** 명령 보내고 A(수락) 또는 E(오류) 기다림. 반환 { ok, msg } */
  async request(line, accept, timeoutMs = 1000) {
    const p = this.waitFor((m) => (m.type === 'A' && accept(m)) || m.type === 'E', timeoutMs);
    await this.send(line);
    const m = await p;
    if (!m) return { ok: false, timeout: true };
    return { ok: m.type === 'A', msg: m };
  }

  async setDeviceMode(m) {
    const r = await this.request(cmd.mode(m), (a) => a.cmd === 'M' && Number(a.args[0]) === m);
    if (!r.ok) throw new Error(r.timeout ? `M,${m} 응답 없음` : `M,${m} 거부: ${ERROR_TEXT[r.msg.code] || r.msg.text}`);
  }

  /** 설정 전송(protocol §4 순서). IDLE 전용 키는 IDLE에서만. 반환 [{key, ok, err}] */
  async configure(settings, keys = SEND_ORDER) {
    if (!this.connected) return [];
    const res = [];
    const idle = this.devMode == null || this.devMode === 0;
    keys = keys.slice();
    // pmin ≥ 현재 pmax이면 pmax를 먼저 보내야 E,2가 나지 않는다
    const ip = keys.indexOf('pmin'), ix = keys.indexOf('pmax');
    if (ip >= 0 && ix > ip && settings.pmin != null && this.config.pmax != null && settings.pmin >= this.config.pmax) { keys[ip] = 'pmax'; keys[ix] = 'pmin'; }
    for (const key of keys) {
      if (settings[key] == null) continue;
      if (IDLE_ONLY.includes(key) && !idle) { res.push({ key, ok: false, err: 'IDLE에서만 변경 가능' }); continue; }
      if (this.config[key] === settings[key]) { res.push({ key, ok: true, same: true }); continue; }
      // 구 펌웨어(1.0.0, C,despike 없음)에는 보내지 않는다 — 연결은 그대로, 화면은 안내만
      if (!this.supportsKey(key)) { this.unsupported.add(key); res.push({ key, ok: false, unsupported: true, err: '펌웨어가 지원하지 않음(1.1.0 이상 필요)' }); continue; }
      const r = await this.request(cmd.param(key, settings[key]), (a) => a.cmd === 'P' && a.args[0] === key);
      if (r.ok) res.push({ key, ok: true });
      else {
        const code = r.msg?.code;
        if (code === 5) this.unsupported.add(key);
        res.push({ key, ok: false, ...(code === 5 ? { unsupported: true } : {}), err: r.timeout ? '응답 없음' : code === 5 ? '펌웨어가 지원하지 않음' : ERROR_TEXT[code] || 'error' });
      }
    }
    return res;
  }

  /**
   * 조립 전 벤치 모드(펌웨어 1.2.0, P,bench,0|1, IDLE 에서만). 1 = 하드 한계 ±90°, 0 = ±30° 복귀(lim 도 3000 이하로, 명령 0).
   * 응답 A,P,bench → C,hard_lim → C,lim. 지원하지 않는 펌웨어면 보내지 않고 오류.
   * !!! 혼만 달린 서보(링크·빔 없음) 전용 !!!
   */
  async setBench(on) {
    const v = on ? 1 : 0;
    if (!this.connected) throw new Error('장치가 연결되어 있지 않습니다');
    if (!this.supportsKey('bench')) throw new Error(`펌웨어 1.2.0 업로드 필요 — 이 장치(${this.hello?.fw_ver ?? '알 수 없음'})는 벤치 모드(P,bench)를 지원하지 않습니다`);
    if (this.devMode != null && this.devMode !== 0) await this.setDeviceMode(0);
    const lim = this.waitFor((m) => m.type === 'C' && m.key === 'lim', 500);
    const r = await this.request(cmd.param('bench', v), (a) => a.cmd === 'P' && a.args[0] === 'bench');
    if (!r.ok) {
      if (r.msg && r.msg.code === 5) this.unsupported.add('bench');
      throw new Error(`P,bench,${v} ${r.timeout ? '응답 없음' : `거부: ${ERROR_TEXT[r.msg.code] || r.msg.text}`}`);
    }
    await lim;
    this.bench = v;
    return v;
  }

  /** 비상 정지: 큐 앞에 M,0 */
  estop() {
    if (!this.writer) return Promise.resolve();
    this.writer.clear();
    return this.writer.send(cmd.mode(0), { urgent: true }).catch(() => {});
  }

  /** 가상 장치·디지털 트윈 공통 조작(공 위치 재배치, 모델 교체). 트윈의 setModel 은 설계 모델 보관만 한다(물리 불변) */
  get virtual() { return this.transport && (this.transport.kind === 'virtual' || this.transport.kind === 'twin') ? this.transport : null; }
  /** 디지털 트윈 전용 조작(참 상태, 외란·고장 버튼, 시나리오) */
  get twin() { return this.transport && this.transport.kind === 'twin' ? this.transport : null; }

  async _loadTwinParams() {
    if (this.deps.loadTwin) return this.deps.loadTwin();
    const { loadTwinParams } = await import('../ui/twin/lib.js');
    return loadTwinParams((u) => fetch(u));
  }

  async _makeTwin() {
    const [{ TwinDevice }, tp] = await Promise.all([import('../sim/twin/twin-device.js'), this._loadTwinParams()]);
    this.twinInfo = tp;
    // 설계 모델은 표시용(TwinDevice.setModel 과 같음). 없으면 null — 트윈 물리에는 쓰지 않는다
    let design_model = null;
    try { if (this.deps.loadSim) design_model = (await this.deps.loadSim()).model || null; } catch { /* 제어 모듈 없음 */ }
    const o = this.twinOpts;
    const { speed, realtime } = this.deps.virtualOpts || {};
    return new TwinDevice({
      params: tp.params, params_ref: tp.ref, seed: o.seed ?? 1, scenario: o.scenario || null, design_model,
      ...(speed != null ? { speed } : {}), ...(realtime != null ? { realtime } : {}),
    });
  }

  /** 트윈 시나리오 선택(null = 자유 실험). 연결 중이면 바로 바꾼다(공·서보 상태 유지) */
  setTwinScenario(scenario, seed) {
    this.twinOpts = { scenario: scenario || null, seed: seed ?? (scenario && scenario.seed) ?? 1 };
    if (this.twin) this.twin.setScenario(this.twinOpts.scenario);
  }

  /** 러너가 실험 시작 직전에 부른다: 시나리오 사건 큐·파라미터를 처음 상태로(다음 M,1 이 시나리오 시각 0) */
  prepareTwinRun() {
    if (this.twin) this.twin.setScenario(this.twinOpts.scenario);
  }

  /** 트윈 세션 메타 조각(docs/spec/digital-twin.md §8). 트윈이 아니면 null */
  twinSessionMeta() {
    return this.twin ? this.twin.sessionMeta() : null;
  }

  /** 세션 메타 device 필드 */
  deviceMeta() {
    const c = this.config;
    return {
      proto_ver: this.hello?.proto_ver ?? null, fw_ver: this.hello?.fw_ver ?? null,
      servo_model: c.servo_model ?? null, servo_pin: c.servo_pin ?? null, fs_ms: c.fs ?? null, alpha: c.alpha ?? null,
      lim_cdeg: c.lim ?? null, trim_cdeg: c.trim ?? null, dir: c.dir ?? null, pmin_us: c.pmin ?? null, pmax_us: c.pmax ?? null,
      despike: c.despike ?? null, // 1.1.0 C,despike. null = 구 펌웨어(1.0.0, 이상값 제거 없음) 또는 모름 (data-schema §2.1)
      ...(isSimMode(this.mode) ? { virtual: true } : {}),
      ...(this.twin ? this.twin.sessionMeta().device_patch : {}),
    };
  }
}
