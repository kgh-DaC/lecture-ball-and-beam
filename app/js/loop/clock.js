// 실시간 통계(performance.now 기준)와 링 버퍼.

export class Stat {
  constructor() { this.reset(); }
  reset() { this.n = 0; this.sum = 0; this.max = -Infinity; this.last = NaN; }
  add(v) { if (!Number.isFinite(v)) return; this.n++; this.sum += v; this.max = Math.max(this.max, v); this.last = v; }
  get mean() { return this.n ? this.sum / this.n : null; }
  get maxOrNull() { return this.n ? this.max : null; }
}

/** 행 객체 링 버퍼. 그래프는 requestAnimationFrame에서 version이 바뀌었을 때만 읽는다. */
export class Ring {
  constructor(size = 6000) { this.size = size; this.buf = new Array(size); this.start = 0; this.length = 0; this.version = 0; this.meta = {}; }
  clear(meta = {}) { this.start = 0; this.length = 0; this.version++; this.meta = meta; }
  push(row) {
    if (this.length < this.size) { this.buf[(this.start + this.length) % this.size] = row; this.length++; }
    else { this.buf[this.start] = row; this.start = (this.start + 1) % this.size; }
    this.version++;
  }
  at(i) { return this.buf[(this.start + i) % this.size]; }
  last() { return this.length ? this.at(this.length - 1) : null; }
  /** 마지막 window_s 초 구간(또는 전체) 배열 */
  window(window_s, tKey = 't_s') {
    const out = [];
    if (!this.length) return out;
    const tEnd = this.last()[tKey];
    for (let i = 0; i < this.length; i++) {
      const r = this.at(i);
      if (!window_s || r[tKey] >= tEnd - window_s) out.push(r);
    }
    return out;
  }
  toArray() { const out = []; for (let i = 0; i < this.length; i++) out.push(this.at(i)); return out; }
}
