// 가상 장치: 펌웨어 프로토콜(protocol.md)을 그대로 흉내 내는 전송 계층.
// WebSerialTransport와 같은 인터페이스(open/close/write/onText/onClose)라서 앱의 나머지는 실제 장치와 구분하지 않는다.
// 물리: app/js/control/simulate.js의 stepPlant(제어 모델과 같은 플랜트) + 센서 잡음·양자화·유실 + 필터(펌웨어와 같은 식).
// 이 파일은 플랜트 식을 새로 구현하지 않는다(stepPlant 재사용).
// 펌웨어 판 흉내(opts.fw): '1.2.0'(기본) = 1.1.0 + 조립 전 벤치 모드 P,bench,0|1(IDLE 에서만, 1 이면 하드 한계 9000 cdeg,
//   lim 0~9000 허용, 해제하면 hard 3000·lim ≤ 3000·명령 0. 응답 A,P,bench → C,hard_lim → C,lim, C 줄 수 17 그대로).
//   벤치 중에는 링크·빔이 없다고 보고 공은 움직이지 않으며(마지막 위치 유지), 서보 혼만 속도 한계(260°/s)로 명령을 따라간다.
//   '1.1.0' = protocol 1.1.0 — P,despike(기본 2 gate, dist-filter.js = dist_filter.h 와 같은 규칙),
//   C 줄 17개(despike 는 id_ts 다음), 빈 줄 무응답, 인쇄 불가 바이트를 만나면 그때까지 모은 줄을 버림(§2.1).
//   '1.0.0' = 구 펌웨어 — despike 없음(P,despike → E,5, C 줄 16개), 쓰레기 바이트 처리 없음,
//   빈 줄은 opts.blank_e5(기본 true)면 E,5 (실기 1.0.0 이 그럴 수 있는 경우를 흉내 — 호스트 동기화 시험용).
// 포텐쇼미터(A0): 서보 혼 각도 → raw = 보정 직선(servo-presets.js HS5645MG pot_preset = 사용자 실측, raw 증가 방향) + 잡음 0.7 LSB.
// 이상값(튐) 흉내: opts.outlier_prob(기본 0), opts.outlier_mm(기본 304) — 실기 정지 공 15 %가 ~304 mm로 튄 기록(protocol §3.1).
// 거리 좌표: 플랜트 y 와 dist 는 모두 '측정 거리'(센서 앞면 → 공의 가까운 표면). 공 중심 = 측정 + 반지름(26 mm)은 화면에서만 바꾼다(ui/coord.js).
// 시험용 센서 오차 주입(거리 검증 sensor-position-test 판정 시험): opts.sensor_offset_mm(상수 오차, 기본 0), opts.sensor_scale(배율, 기본 1)
//   → 보고 거리 = sensor_scale·y + sensor_offset_mm(+ 잡음). setSensorError({ offset_mm, scale }) 로 연결 중에도 바꿀 수 있다. 플랜트·제어는 그대로.

import { SERVO_PRESETS } from '../config/servo-presets.js';
import { TRIG_PIN, ECHO_PIN } from '../config/settings.js';
import { DistFilter, DEFAULT_DESPIKE, DF_MODE_MAX } from './dist-filter.js';

export const VIRTUAL_FW = { '1.2.0': 'virtual-1.2.0', '1.1.0': 'virtual-1.1.0', '1.0.0': 'virtual-1.0.0' };
const HARD_LIM = 3000;
const BENCH_HARD_LIM = 9000;
const BENCH_RATE_DEG_S = 260; // HS-5645MG 무부하 약 0.23 s/60° @5 V(가정값) — 벤치 흉내용
const HB_MS = 500;
const BEAM_MIN_M = 0.02;   // 멈춤판(센서 쪽)
const BEAM_MAX_M = 0.33;   // 멈춤판(먼 쪽)

/** 결정론적 난수(재현 가능한 잡음) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class VirtualDevice {
  /**
   * @param {object} opts { sim: { stepPlant, initPlantState? }, model, seed, noise_mm, lost_prob, quant_mm, y0_m, speed, realtime,
   *   fw: '1.2.0'(기본) | '1.1.0' | '1.0.0', blank_e5 (1.0.0 전용, 기본 true), outlier_prob, outlier_mm,
   *   sensor_offset_mm (시험용 상수 오차, 기본 0), sensor_scale (시험용 배율, 기본 1) }
   * realtime=false면 tick(ms)을 직접 불러 시간을 진행한다(시험용).
   */
  constructor(opts = {}) {
    this.kind = 'virtual';
    this.sim = opts.sim;
    this.model = opts.model;
    this.rand = mulberry32(opts.seed ?? 1);
    this.noise_mm = opts.noise_mm ?? 1.0;
    this.lost_prob = opts.lost_prob ?? 0.01;
    this.quant_mm = opts.quant_mm ?? 1;
    this.y0_m = opts.y0_m ?? 0.17;
    this.realtime = opts.realtime ?? true;
    this.speed = opts.speed ?? 1;
    this.fw = VIRTUAL_FW[opts.fw] ? opts.fw : '1.2.0';
    this.pot_noise_lsb = opts.pot_noise_lsb ?? 0.7;
    this.legacy = this.fw === '1.0.0';
    this.fwVer = VIRTUAL_FW[this.fw];
    this.blank_e5 = this.legacy && (opts.blank_e5 ?? true);
    this.outlier_prob = opts.outlier_prob ?? 0;
    this.outlier_mm = opts.outlier_mm ?? 304;
    this.sensor_offset_mm = Number.isFinite(opts.sensor_offset_mm) ? opts.sensor_offset_mm : 0;
    this.sensor_scale = Number.isFinite(opts.sensor_scale) && opts.sensor_scale > 0 ? opts.sensor_scale : 1;
    // 시험용: 부팅 H/C 직후 장치 수신 버퍼에 남는 인쇄 가능한 쓰레기(USB·잡음 흉내, protocol §2.1). 예 'xyz'
    this.rx_garbage = opts.rx_garbage ?? '';
    this.textListeners = new Set();
    this.closeListeners = new Set();
    this.cfg = { fs: 60, alpha: 200, lim: 3000, trim: 0, dir: 1, servo_pin: 9, servo_model: 'HS5645MG', pmin: 544, pmax: 2400, id_ts: 5 };
    if (!this.legacy) this.cfg.despike = DEFAULT_DESPIKE; // C 순서: id_ts 다음
    this.dfilt = new DistFilter();
    this.ro = { trig_pin: TRIG_PIN, echo_pin: ECHO_PIN, pot_pin: 0, hard_lim: 3000, hb_ms: HB_MS, pulse_timeout_us: 5000 };
    this.rx = '';
    this.bench = 0;
  }
  /** 벤치 모드(P,bench) 지원: 1.2.0 판 가상 장치만. 상속한 디지털 트윈(TwinDevice, 자체 물리·fw 판)은 지원하지 않는다(E,5) */
  get hasBench() { return this.fw === '1.2.0' && this.kind === 'virtual'; }
  get hardLim() { return this.bench ? BENCH_HARD_LIM : HARD_LIM; }
  onText(fn) { this.textListeners.add(fn); return () => this.textListeners.delete(fn); }
  onClose(fn) { this.closeListeners.add(fn); return () => this.closeListeners.delete(fn); }
  _out(line) { const s = line + '\n'; for (const f of this.textListeners) f(s); }

  setModel(model) { this.model = model; }

  async open() {
    if (!this.sim || typeof this.sim.stepPlant !== 'function') throw new Error('가상 장치: control/simulate.js의 stepPlant를 불러오지 못했습니다');
    this.mode = 0;
    this.cmd = 0;               // 적용 중인 명령 cdeg(제한 후)
    this.t_ms = 0;              // 장치 시각(millis 흉내)
    this.lastHb = 0;
    this.nextMeas = 1600;       // 부팅 약 1.6 s 뒤 첫 측정
    this.dfilt.init();
    this.rx = '';
    this.id = null;
    this.bench = 0; // 리셋(포트 열기)하면 0
    this.ro.hard_lim = HARD_LIM;
    this.benchDeg = 90;
    this._resetPlant();
    this.booted = false;
    if (this.realtime) {
      this.wall = performance.now();
      this.timer = setInterval(() => {
        const now = performance.now();
        const dt = Math.min(200, (now - this.wall) * this.speed);
        this.wall = now;
        this.tick(dt);
      }, 5);
    }
    return { virtual: true };
  }

  _resetPlant() {
    const init = this.sim.initPlantState;
    // 지연 버퍼가 상태 안에 있으므로 반드시 initPlantState로 만든다(control-engineer 계약)
    this.state = init ? init(this.model, { y_m: this.y0_m, ydot_m_s: 0, theta_rad: 0, u_rad: 0, t_s: this.t_ms / 1000 }) : { y_m: this.y0_m, ydot_m_s: 0, theta_rad: 0 };
  }

  /** 공을 손으로 옮겨 놓기(검증 도구 반복 사이) */
  placeBall(y_m) {
    this.y0_m = y_m;
    this._resetPlant();
    // 손으로 놓고 잠시 기다린 상태: 펌웨어 필터(이상값 제거 기준값 포함)도 새 위치에 수렴해 있다(이전 위치 기억 제거)
    this.dfilt.settle(this._sensed(y_m * 1000));
  }

  /** 시험용 센서 오차(상수 오차 mm, 배율). 인자 생략 = 그대로, setSensorError() = 오차 없음으로 되돌림 */
  setSensorError({ offset_mm = 0, scale = 1 } = {}) {
    this.sensor_offset_mm = Number.isFinite(offset_mm) ? offset_mm : 0;
    this.sensor_scale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return { offset_mm: this.sensor_offset_mm, scale: this.sensor_scale };
  }
  get sensorError() { return { offset_mm: this.sensor_offset_mm, scale: this.sensor_scale }; }
  /** 참 측정 거리(mm) → 센서가 보고할 거리(잡음 전): 배율·상수 오차 적용 */
  _sensed(y_mm) { return this.sensor_scale * y_mm + this.sensor_offset_mm; }

  async close() {
    clearInterval(this.timer);
    this.timer = null;
    for (const f of this.closeListeners) f('user');
  }

  /** 1.0.0 판은 수신 줄을 그대로 쓴다. 1.1.0 판은 인쇄 불가 바이트(\n·\r 제외 0x20~0x7E 밖)를 만나면 그때까지 모은 부분을 버린다 */
  _sanitize(line) {
    line = line.replace(/\r/g, '');
    if (this.legacy) return line;
    for (let i = line.length - 1; i >= 0; i--) {
      const c = line.charCodeAt(i);
      if (c < 0x20 || c > 0x7e) return line.slice(i + 1);
    }
    return line;
  }

  async write(text) {
    this.rx += text;
    let i;
    while ((i = this.rx.indexOf('\n')) >= 0) {
      const line = this._sanitize(this.rx.slice(0, i));
      this.rx = this.rx.slice(i + 1);
      // 실제 통신 지연 흉내: 다음 틱에 처리
      queueMicrotask(() => this._handle(line));
    }
  }

  /** ms만큼 시간을 진행 */
  tick(ms) {
    const step = 2; // 적분 간격 ms
    let left = ms;
    while (left > 0) {
      const d = Math.min(step, left);
      left -= d;
      this.t_ms += d;
      if (!this.booted && this.t_ms >= 1600) { this.booted = true; this._hello(); if (this.rx_garbage) this.rx += this.rx_garbage; }
      this._physics(d / 1000);
      if (this.mode === 1 && this.t_ms - this.lastHb > HB_MS) {
        this.mode = 0; this.cmd = 0; this._out('E,4,heartbeat');
      }
      if (this.mode === 2 && this.id) this._idStep();
      else if (this.mode !== 2 && this.booted && this.t_ms >= this.nextMeas) {
        this.nextMeas += this.cfg.fs;
        this._measure();
      }
    }
  }

  _beamCmdRad() {
    // 펌웨어: deg_servo = 90 + trim/100 + dir·cmd/100. 가상 기구는 dir=1, trim=0일 때 바르게 장착된 것으로 본다.
    const cdeg = this.cfg.trim + this.cfg.dir * this.cmd;
    return cdeg / 100 * Math.PI / 180;
  }

  /** 서보 각(°, 0~180으로 자름) = 90 + (trim + dir·cmd)/100 — 펌웨어 cmdToMicros 와 같은 식 */
  _servoDegCmd() { return Math.max(0, Math.min(180, 90 + (this.cfg.trim + this.cfg.dir * this.cmd) / 100)); }

  /** 명령 자르기(펌웨어 clampCmd): ±min(lim, 하드 한계) 후 서보 각 0~180° 밖이면 되돌린다 */
  _clampCmd(v) {
    const L = Math.min(this.cfg.lim, this.hardLim);
    let c = Math.max(-L, Math.min(L, v));
    const degC = 9000 + this.cfg.trim + this.cfg.dir * c;
    if (degC < 0 || degC > 18000) c = this.cfg.dir * (Math.max(0, Math.min(18000, degC)) - 9000 - this.cfg.trim);
    return c;
  }

  _physics(dt) {
    if (this.bench) {
      // 벤치: 링크·빔 없음 → 공은 그대로, 혼만 속도 한계로 따라간다
      const tgt = this._servoDegCmd();
      const d = tgt - this.benchDeg, mx = BENCH_RATE_DEG_S * dt;
      this.benchDeg = Math.abs(d) <= mx ? tgt : this.benchDeg + Math.sign(d) * mx;
      return;
    }
    const u = this._beamCmdRad();
    // 멈춤판은 stepPlant가 비탄성 정지로 처리한다(y_min_m/y_max_m)
    const next = this.sim.stepPlant(this.state, u, dt, this.model, { substeps: 2, y_min_m: BEAM_MIN_M, y_max_m: BEAM_MAX_M, kb_scale: this.kb_scale ?? 1 });
    if (next) this.state = next;
  }

  _gauss() { const u = Math.max(1e-12, this.rand()); const v = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /** 지금 서보 혼 각도(°). 보통은 플랜트의 서보 출력 θ(= trim + dir·cmd 를 따라감), 벤치에서는 혼 각도 */
  hornDeg() {
    if (this.bench) return this.benchDeg;
    const th = Number.isFinite(this.state.theta_rad) ? this.state.theta_rad : this._beamCmdRad();
    return 90 + th * 180 / Math.PI;
  }

  _potRaw() {
    // 가상 포텐쇼미터 = HS-5645MG 보정 직선(사용자 실측, 혼 각도 기준) + 잡음. raw 는 서보각과 함께 증가
    const cal = SERVO_PRESETS.HS5645MG.pot_preset;
    const degServo = Math.max(0, Math.min(180, this.hornDeg()));
    const raw = ((degServo - 90) * 100 - cal.b_cdeg) / cal.a_cdeg_per_lsb + this._gauss() * this.pot_noise_lsb;
    return Math.max(0, Math.min(1023, Math.round(raw)));
  }

  _measure() {
    let y_mm = this._sensed(this.state.y_m * 1000) + this._gauss() * this.noise_mm;
    if (this.outlier_prob > 0 && this.rand() < this.outlier_prob) y_mm = this.outlier_mm + this._gauss() * 3; // 실기 튐 흉내
    let dist = Math.round(y_mm / this.quant_mm) * this.quant_mm;
    if (this.rand() < this.lost_prob || dist < 20 || dist > 500) dist = -1;
    // 펌웨어와 같은 처리: 이상값 제거(1.0.0 판은 0 = 끔과 같음) → 재귀 필터
    this.dfilt.update(dist, this.legacy ? 0 : this.cfg.despike, this.cfg.alpha);
    const tMeas = Math.round(this.t_ms);
    this._out(`D,${tMeas},${dist},${this.dfilt.output()},${this.cmd},${this._potRaw()},${this.mode}`);
  }

  _hello() {
    this._out(`H,1,${this.fwVer}`);
    for (const [k, v] of Object.entries(this.cfg)) this._out(`C,${k},${v}`);
    for (const [k, v] of Object.entries(this.ro)) this._out(`C,${k},${v}`);
  }

  _handle(line) {
    // 빈 줄: 펌웨어는 무응답(1.1.0 §2.1). 1.0.0 흉내에서 blank_e5면 E,5
    if (line === '') { if (this.blank_e5) this._out('E,5,unknown'); return; }
    if (line.length > 31) { this._out('E,1,format'); return; }
    const f = line.split(',');
    const isInt = (s) => /^-?\d+$/.test(s);
    switch (f[0]) {
      case '?': this._hello(); return;
      case 'B': this.lastHb = this.t_ms; return;
      case 'M': {
        if (f.length !== 2 || !isInt(f[1])) return this._out('E,1,format');
        const m = +f[1];
        if (m === 3 || m < 0 || m > 3) return this._out('E,5,unknown');
        if ((this.mode === 1 && m === 2) || (this.mode === 2 && m === 1)) return this._out('E,3,mode');
        if (m === 0 && this.mode === 2 && this.id) { this._out(`F,${this.id.kind},${this.id.sent}`); this.id = null; }
        if (m === 0) this.cmd = 0;
        this.mode = m;
        this.lastHb = this.t_ms;
        if (m !== 2) this.nextMeas = Math.max(this.nextMeas, this.t_ms);
        this._out(`A,M,${m}`);
        return;
      }
      case 'S': {
        if (f.length !== 2 || !isInt(f[1])) return this._out('E,1,format');
        if (this.mode !== 1) return this._out('E,3,mode');
        const v = +f[1];
        this.cmd = this._clampCmd(v);
        this.lastHb = this.t_ms;
        return;
      }
      case 'P': return this._param(f);
      case 'I': return this._idStart(f);
      default: this._out('E,5,unknown');
    }
  }

  _param(f) {
    if (f.length !== 3) return this._out('E,1,format');
    const key = f[1], sv = f[2];
    if (key === 'bench' && this.hasBench) return this._bench(sv);
    const idleOnly = ['trim', 'dir', 'servo_pin', 'servo_model', 'pmin', 'pmax'];
    if (!(key in this.cfg)) return this._out('E,5,unknown');
    if (idleOnly.includes(key) && this.mode !== 0) return this._out('E,3,mode');
    if ((key === 'fs') && this.mode === 2) return this._out('E,3,mode');
    if (key === 'id_ts' && (this.mode === 1 || this.id)) return this._out('E,3,mode');
    if (key === 'servo_model') {
      if (!SERVO_PRESETS[sv]) return this._out('E,2,range');
      this.cfg.servo_model = sv; this.cfg.pmin = SERVO_PRESETS[sv].pmin_us; this.cfg.pmax = SERVO_PRESETS[sv].pmax_us;
      this._out('A,P,servo_model'); this._out(`C,servo_model,${sv}`); this._out(`C,pmin,${this.cfg.pmin}`); this._out(`C,pmax,${this.cfg.pmax}`);
      return;
    }
    if (!/^-?\d+$/.test(sv)) return this._out('E,1,format');
    const v = +sv;
    const ok = {
      fs: v >= 60 && v <= 200, alpha: v >= 1 && v <= 1000, lim: v >= 0 && v <= this.hardLim, trim: v >= -1500 && v <= 1500,
      dir: v === 1 || v === -1, servo_pin: v >= 2 && v <= 13 && v !== TRIG_PIN && v !== ECHO_PIN,
      pmin: v >= 400 && v <= 2600 && v < this.cfg.pmax, pmax: v >= 400 && v <= 2600 && v > this.cfg.pmin, id_ts: v >= 5 && v <= 50,
      despike: v >= 0 && v <= DF_MODE_MAX,
    }[key];
    if (!ok) return this._out('E,2,range');
    this.cfg[key] = v;
    if (key === 'lim') this.cmd = this._clampCmd(this.cmd);
    if (key === 'trim' || key === 'dir') this.cmd = 0; // 펌웨어: IDLE 에서 바꾸면 applyCmd(0)
    if (key === 'servo_pin') this.cmd = 0;
    if (key === 'despike') this.dfilt.resetDespike(); // 상태만 비우고 filt 값은 유지
    this._out(`A,P,${key}`); this._out(`C,${key},${v}`);
  }

  /** P,bench,<0|1> (펌웨어 1.2.0 cmdBench 와 같은 검사 순서: 형식 E,1 → 모드 E,3 → 범위 E,2) */
  _bench(sv) {
    if (!/^-?\d+$/.test(sv)) return this._out('E,1,format');
    if (this.mode !== 0) return this._out('E,3,mode');
    const v = +sv;
    if (v !== 0 && v !== 1) return this._out('E,2,range');
    const was = this.bench;
    if (v === 1 && !was) this.benchDeg = this.hornDeg(); // 혼은 지금 각도에서 시작
    this.bench = v;
    this.ro.hard_lim = this.hardLim;
    if (this.cfg.lim > this.hardLim) this.cfg.lim = this.hardLim;
    this.cmd = 0;
    if (!v && was) this._resetPlant(); // 벤치를 끝내면 플랜트를 명령 0 상태로(빔 조립 전이라 공 위치는 의미 없음)
    this._out('A,P,bench'); this._out(`C,hard_lim,${this.ro.hard_lim}`); this._out(`C,lim,${this.cfg.lim}`);
  }

  _idStart(f) {
    if (this.mode !== 2) return this._out('E,3,mode');
    if (this.id) return this._out('E,3,mode');
    const nums = f.slice(2);
    if (!nums.every((s) => /^-?\d+$/.test(s))) return this._out('E,1,format');
    const n = nums.map(Number);
    const ts = this.cfg.id_ts;
    const lim = this.cfg.lim;
    let sig, dur, kind = f[1];
    if (kind === 'step' && n.length === 3) {
      const [from, to, hold] = n;
      if (Math.abs(from) > lim || Math.abs(to) > lim || hold < 1) return this._out('E,2,range');
      dur = 100 + hold;
      sig = (t) => (t < 100 ? from : to);
      this.cmd = from;
      this.preWait = 1000; // from으로 이동 후 1000 ms 대기(기록 안 함)
    } else if (kind === 'prbs' && n.length === 3) {
      const [amp, bit, nb] = n;
      if (amp < 0 || amp > lim || bit < 1 || nb < 1) return this._out('E,2,range');
      dur = bit * nb;
      let reg = 0x1ff;
      const bits = [];
      for (let k = 0; k < nb; k++) {
        const out = reg & 1;
        bits.push(out);
        const fb = ((reg >> 0) ^ (reg >> 4)) & 1; // x^9 + x^5 + 1
        reg = (reg >> 1) | (fb << 8);
      }
      sig = (t) => (bits[Math.min(nb - 1, Math.floor(t / bit))] ? amp : -amp);
      this.preWait = 0;
    } else if (kind === 'chirp' && n.length === 4) {
      const [amp, f0, f1, T] = n;
      if (amp < 0 || amp > lim || f0 < 0 || f1 < 0 || T < 1) return this._out('E,2,range');
      dur = T;
      sig = (t) => { const ts_ = t / 1000, Ts = T / 1000; return Math.round(amp * Math.sin(2 * Math.PI * (f0 / 1000 * ts_ + (f1 - f0) / 1000 * ts_ * ts_ / (2 * Ts)))); };
      this.preWait = 0;
    } else if (!['step', 'prbs', 'chirp'].includes(kind)) return this._out('E,5,unknown');
    else return this._out('E,1,format');
    const nPlanned = Math.floor(dur / ts);
    if (dur > 30000 || nPlanned > 6000) return this._out('E,2,range');
    this.id = { kind, sig, n: nPlanned, sent: 0, t0: this.t_ms + (this.preWait || 0), ts };
    this._out(`A,I,${kind},${nPlanned}`);
  }

  _idStep() {
    const id = this.id;
    const tRel = this.t_ms - id.t0;
    if (tRel < 0) return;
    // 명령 갱신
    this.cmd = Math.max(-this.cfg.lim, Math.min(this.cfg.lim, id.sig(tRel)));
    const due = Math.floor(tRel / id.ts);
    while (id.sent <= due && id.sent < id.n) {
      this._out(`V,${id.sent},${Math.round(id.sent * id.ts * 1000 + this.rand() * 8)},${this.cmd},${this._potRaw()}`);
      id.sent++;
    }
    if (id.sent >= id.n) { this._out(`F,${id.kind},${id.sent}`); this.id = null; }
  }
}
