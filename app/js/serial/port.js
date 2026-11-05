// Web Serial 전송 계층. 가상 장치와 같은 인터페이스: open(), close(), write(text), onText(fn), onClose(fn).
// Chrome/Edge + 보안 컨텍스트(localhost/https)에서만 동작한다.

import { BAUD } from '../config/defaults.js';

export function serialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator && (typeof isSecureContext === 'undefined' || isSecureContext);
}

export function unsupportedReason() {
  if (typeof navigator === 'undefined') return 'Node 환경';
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) return '보안 컨텍스트가 아닙니다. file:// 대신 python -m http.server 로 띄운 http://localhost:8000/app/ 으로 여세요.';
  if (!('serial' in navigator)) return '이 브라우저는 Web Serial을 지원하지 않습니다. Chrome 또는 Edge(데스크톱)를 쓰거나, 가상 장치·샘플 재생 모드를 쓰세요.';
  return null;
}

export class WebSerialTransport {
  constructor() { this.port = null; this.reader = null; this.textListeners = new Set(); this.closeListeners = new Set(); this.closing = false; this.kind = 'device'; }
  onText(fn) { this.textListeners.add(fn); return () => this.textListeners.delete(fn); }
  onClose(fn) { this.closeListeners.add(fn); return () => this.closeListeners.delete(fn); }

  /** 사용자 제스처 안에서 호출해야 한다(포트 선택 창). reuse: 이전에 허용한 포트 재사용 */
  async open({ reuse = false } = {}) {
    if (!serialSupported()) throw new Error(unsupportedReason());
    let port = null;
    if (reuse) { const ports = await navigator.serial.getPorts(); port = ports[0] || null; }
    if (!port) port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 4096 });
    this.port = port;
    this.closing = false;
    this.encoder = new TextEncoder();
    this._readLoop();
    navigator.serial.addEventListener('disconnect', this._onDisc = (e) => { if (e.target === this.port) this._closed('disconnect'); });
    const info = port.getInfo ? port.getInfo() : {};
    return { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId };
  }

  async _readLoop() {
    const dec = new TextDecoder();
    while (this.port && this.port.readable && !this.closing) {
      try {
        this.reader = this.port.readable.getReader();
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          const text = dec.decode(value, { stream: true });
          for (const f of this.textListeners) f(text);
        }
      } catch (e) {
        if (!this.closing) { console.warn('시리얼 읽기 오류', e); this._closed('read_error'); return; }
      } finally {
        try { this.reader && this.reader.releaseLock(); } catch { /* */ }
        this.reader = null;
      }
    }
    if (!this.closing) this._closed('ended');
  }

  async write(text) {
    if (!this.port || !this.port.writable) throw new Error('포트가 열려 있지 않습니다');
    const w = this.port.writable.getWriter();
    try { await w.write(this.encoder.encode(text)); } finally { w.releaseLock(); }
  }

  _closed(reason) {
    if (this._wasClosed) return;
    this._wasClosed = true;
    for (const f of this.closeListeners) f(reason);
  }

  async close() {
    this.closing = true;
    try { if (this.reader) await this.reader.cancel(); } catch { /* */ }
    try { if (this.port) await this.port.close(); } catch { /* */ }
    if (this._onDisc) navigator.serial.removeEventListener('disconnect', this._onDisc);
    this.port = null;
    this._closed('user');
  }
}
