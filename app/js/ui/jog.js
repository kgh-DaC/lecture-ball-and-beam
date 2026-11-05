// 하드웨어 구성용 수동 조그(HOST 모드, protocol §4): 각도 한계·수평 찾기에서 같이 쓴다.
// - 시작: IDLE → P,lim(작은 값) → M,1 → S,0, 하트비트 B를 HEARTBEAT_MS마다
// - 이동: 목표까지 램프(rate_cdeg_s), 단계마다 S 전송. 새 명령이 오면 이전 램프는 버린다
// - 정지: 0으로 램프 → M,0(IDLE). 비상 정지: 큐 비우고 M,0 즉시
// - 러너가 실험 중이면 시작하지 않는다(명령이 섞이지 않게)

import { heartbeatHint } from '../serial/troubleshoot.js';
import { cmd } from '../serial/writer.js';
import { HEARTBEAT_MS } from '../config/defaults.js';

export const SAFE_START_LIM_CDEG = 500; // ±5°: 처음부터 ±30°로 시작하지 않는다

export class Jogger {
  /** dev: DeviceManager, runner?: Runner. opts: { rate_cdeg_s = 30, tick_ms = 40 } */
  constructor(dev, runner, opts = {}) {
    this.dev = dev; this.runner = runner;
    this.rate = opts.rate_cdeg_s ?? 100; // 1°/s 램프
    this.tick = opts.tick_ms ?? 40;
    this.active = false; this.cmd = 0; this.lim = null; this.hb = null; this.seq = 0;
    this.listeners = new Set();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const f of this.listeners) { try { f(this); } catch (e) { console.error(e); } } }

  /** HOST 모드 진입. lim_cdeg: 이 조그 동안 장치에 걸 각도 한계(작게) */
  async start(lim_cdeg = SAFE_START_LIM_CDEG) {
    const dev = this.dev;
    if (!dev || dev.mode === 'sample') throw new Error('실제 장치 또는 가상 장치 모드에서만 조그할 수 있습니다');
    if (!dev.connected) await dev.connect();
    if (this.runner && this.runner.state === 'running') throw new Error('실험 중입니다. 실험을 멈춘 뒤 조그하세요');
    if (dev.devMode !== 0 && dev.devMode != null) await dev.setDeviceMode(0);
    await this.setLim(lim_cdeg);
    await dev.setDeviceMode(1);
    this.active = true; this.cmd = 0;
    await dev.send(cmd.servo(0));
    clearInterval(this.hb);
    this.hb = setInterval(() => { if (this.active) dev.send(cmd.beat()).catch(() => {}); }, HEARTBEAT_MS);
    this._offErr = dev.onError ? dev.onError((e) => { if (e.code === 4 && this.active) { this._halt(); this.lastError = `하트비트 만료로 장치가 IDLE로 돌아갔습니다${dev.mode === 'device' ? ` — ${heartbeatHint()}` : ''}`; this._emit(); } }) : null;
    this._emit();
  }

  /** 장치 각도 한계 변경(P,lim, 어느 모드에서나). 조그 중이면 현재 명령도 그 안으로 */
  async setLim(lim_cdeg) {
    // 상한 = 장치가 보고한 하드 한계(C,hard_lim: 보통 3000, 펌웨어 1.2.0 벤치 모드 중 9000). 모르면 3000
    const hard = Number.isFinite(this.dev.config && this.dev.config.hard_lim) ? this.dev.config.hard_lim : 3000;
    const v = Math.max(0, Math.min(hard, Math.round(lim_cdeg)));
    const r = await this.dev.request(cmd.param('lim', v), (a) => a.cmd === 'P' && a.args[0] === 'lim');
    if (!r.ok) throw new Error(`P,lim,${v} 실패${r.timeout ? '(응답 없음)' : ''}`);
    this.lim = v;
    if (Math.abs(this.cmd) > v) this.cmd = Math.sign(this.cmd) * v;
    this._emit();
    return v;
  }

  /** 목표 각도로 램프 이동(cdeg). 완료되면 resolve. 다른 이동이 시작되면 중간에 끝난다 */
  async moveTo(target_cdeg) {
    if (!this.active) throw new Error('조그가 시작되지 않았습니다');
    const lim = this.lim ?? SAFE_START_LIM_CDEG;
    const tgt = Math.max(-lim, Math.min(lim, Math.round(target_cdeg)));
    const my = ++this.seq;
    const stepMax = Math.max(1, (this.rate * this.tick) / 1000);
    while (this.active && my === this.seq && this.cmd !== tgt) {
      const d = tgt - this.cmd;
      this.cmd = Math.abs(d) <= stepMax ? tgt : Math.round(this.cmd + Math.sign(d) * stepMax);
      await this.dev.send(cmd.servo(this.cmd)).catch(() => {});
      this._emit();
      if (this.cmd !== tgt) await new Promise((r) => setTimeout(r, this.tick));
    }
    return this.cmd;
  }
  step(delta_cdeg) { return this.moveTo(this.cmd + delta_cdeg); }

  /** 0으로 천천히 되돌린 뒤 IDLE */
  async stop() {
    if (!this.active) return;
    try { await this.moveTo(0); } catch { /* */ }
    this._halt();
    try { await this.dev.setDeviceMode(0); } catch { /* 이미 IDLE */ }
    this._emit();
  }

  /** 비상 정지: 큐 비우고 M,0 */
  async estop() {
    this.seq++;
    this._halt();
    await this.dev.estop();
    this._emit();
  }

  _halt() { this.active = false; clearInterval(this.hb); this.hb = null; if (this._offErr) { this._offErr(); this._offErr = null; } }
  dispose() { if (this.active) this.estop(); this.listeners.clear(); }
}

/** 장치 종류 표시: 실기에서만 위험한 동작인지 */
export function hwModeNote(dev) {
  if (!dev) return { text: '장치 없음', cls: 'b-unknown', real: false };
  if (dev.mode === 'device') return { text: '실제 장치 — 서보가 실제로 움직입니다', cls: 'b-real', real: true };
  if (dev.mode === 'virtual') return { text: '가상 장치 — 연습용(기구 한계·걸림 없음)', cls: 'b-sim', real: false };
  if (dev.mode === 'twin') return { text: '디지털 트윈 [시뮬레이션] — 연습용(데드밴드·백래시 있음, 걸림 없음)', cls: 'b-sim', real: false };
  return { text: '샘플 재생 — 조그 불가', cls: 'b-unknown', real: false };
}

/** 문제 해결 안내 링크(02장 절; 이론/실습 구분) */
export const GUIDE = {
  wiper: { href: '#/ch/02-hardware?h=h-7-2-방법과-주의', label: '🔌 실습: 7.2 포텐쇼미터 와이퍼 배선과 주의(5V 초과 금지)' },
  wiring: { href: '#/ch/02-hardware?h=h-6-아두이노-uno와-배선', label: '🔌 실습: 6. 아두이노(Uno/Nano) 배선' },
  // 서보 전원 부족(리셋·하트비트 만료·떨림): 같은 배선 절(별도 5.0 V 전원·공통 GND). 절 제목이 바뀌어도 shell이 번호(h-6-)로 찾는다
  power: { href: '#/ch/02-hardware?h=h-6-아두이노-uno와-배선', label: '🔌 실습: 6. 배선 — 서보 별도 5.0 V 전원·공통 GND·9 V 건전지 금지' },
  sonar: { href: '#/ch/02-hardware?h=h-4-2-이-시스템에서-센서-한계가-의미하는-것', label: '📖 이론: 4.2 초음파 센서 한계와 위치' },
  pwm: { href: '#/ch/02-hardware?h=h-3-2-pwm-펄스폭과-각도', label: '📖 이론: 3.2 PWM 펄스폭과 각도' },
};
