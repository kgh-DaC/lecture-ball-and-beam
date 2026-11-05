// 호스트 → 장치 명령 (protocol.md §4). 한 줄 최대 31자(펌웨어 수신 버퍼 32 B).

export const MAX_LINE = 31;

export const cmd = {
  mode: (m) => `M,${m}`,
  servo: (cdeg) => `S,${Math.round(cdeg)}`,
  beat: () => 'B',
  param: (key, value) => `P,${key},${value}`,
  hello: () => '?',
  idStep: (from, to, hold) => `I,step,${Math.round(from)},${Math.round(to)},${Math.round(hold)}`,
  idPrbs: (amp, bitMs, nBits) => `I,prbs,${Math.round(amp)},${Math.round(bitMs)},${Math.round(nBits)}`,
  idChirp: (amp, f0, f1, dur) => `I,chirp,${Math.round(amp)},${Math.round(f0)},${Math.round(f1)},${Math.round(dur)}`,
};

export function checkLine(line) {
  if (line.length > MAX_LINE) throw new Error(`명령이 ${MAX_LINE}자를 넘습니다: ${line}`);
  if (/[\r\n]/.test(line)) throw new Error('명령에 줄바꿈이 있으면 안 됩니다');
  return line;
}

/**
 * 명령 큐. transport.write(text)는 Promise를 반환한다.
 * 쓰기가 끝나기 전에 다음 명령이 오면 이어서 보낸다(순서 보장). urgent는 큐 앞에 넣는다(비상 정지).
 */
export class Writer {
  constructor(transport) { this.transport = transport; this.queue = []; this.busy = false; this.sent = 0; this.log = []; this.onSend = null; }
  send(line, { urgent = false } = {}) {
    checkLine(line);
    return new Promise((resolve, reject) => {
      const item = { line, resolve, reject };
      if (urgent) this.queue.unshift(item); else this.queue.push(item);
      this._pump();
    });
  }
  async _pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const it = this.queue.shift();
        try {
          await this.transport.write(it.line + '\n');
          this.sent++;
          this.log.push(it.line); if (this.log.length > 200) this.log.shift();
          this.onSend && this.onSend(it.line);
          it.resolve();
        } catch (e) { it.reject(e); }
      }
    } finally { this.busy = false; }
  }
  clear() { for (const it of this.queue.splice(0)) it.reject(new Error('cleared')); }
}
