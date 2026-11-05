// 장치 → 호스트 줄 파서 (protocol.md §3, §9).
// 모르는 접두·필드 부족·숫자 아님 → null(버리고 개수를 센다). 필드가 더 많으면 앞 필드만 쓴다.

const INT = /^-?\d+$/;
const toInt = (s) => (INT.test(s) ? parseInt(s, 10) : NaN);

const SPEC = {
  // 접두: [최소 필드 수(접두 제외), 파서]
  H: [2, (f) => { const pv = toInt(f[0]); return Number.isNaN(pv) ? null : { type: 'H', proto_ver: pv, fw_ver: f[1] }; }],
  C: [2, (f) => { const v = toInt(f[1]); return { type: 'C', key: f[0], value: Number.isNaN(v) ? f[1] : v }; }],
  D: [6, (f) => {
    const n = f.slice(0, 6).map(toInt);
    if (n.some(Number.isNaN)) return null;
    return { type: 'D', t_ms: n[0], dist_mm: n[1], filt_mm: n[2], cmd_cdeg: n[3], pot_raw: n[4], mode: n[5] };
  }],
  V: [4, (f) => {
    const n = f.slice(0, 4).map(toInt);
    if (n.some(Number.isNaN)) return null;
    return { type: 'V', idx: n[0], t_us: n[1], cmd_cdeg: n[2], pot_raw: n[3] };
  }],
  F: [2, (f) => { const n = toInt(f[1]); return Number.isNaN(n) ? null : { type: 'F', kind: f[0], n }; }],
  A: [1, (f) => ({ type: 'A', cmd: f[0], args: f.slice(1) })],
  E: [1, (f) => { const c = toInt(f[0]); return Number.isNaN(c) ? null : { type: 'E', code: c, text: f[1] || '' }; }],
};

export const ERROR_TEXT = {
  1: '형식 오류(필드 수·숫자·줄 길이)',
  2: '범위 초과(거부됨)',
  3: '현재 모드에서 불가',
  4: '하트비트 만료 → IDLE 복귀',
  5: '알 수 없는 명령/키(펌웨어가 지원하지 않음)',
};

/** 한 줄 파싱. 반환: 메시지 객체 또는 null */
export function parseLine(line) {
  if (typeof line !== 'string') return null;
  const s = line.replace(/\r$/, '').trim();
  if (!s) return null;
  const parts = s.split(',');
  const spec = SPEC[parts[0]];
  if (!spec) return null;
  const fields = parts.slice(1);
  if (fields.length < spec[0]) return null;
  if (fields.some((x, i) => i < spec[0] && x === '')) return null;
  return spec[1](fields);
}

/** 바이트/문자 조각 → 줄. push(chunk)가 완성된 줄 배열을 반환한다 */
export class LineSplitter {
  constructor(maxLen = 256) { this.buf = ''; this.maxLen = maxLen; this.overflow = 0; }
  push(chunk) {
    this.buf += chunk;
    const out = [];
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      out.push(this.buf.slice(0, i).replace(/\r$/, ''));
      this.buf = this.buf.slice(i + 1);
    }
    if (this.buf.length > this.maxLen) { this.buf = ''; this.overflow++; }
    return out;
  }
}

/** 파싱 통계를 세는 상태 있는 파서 */
export class Parser {
  constructor() { this.splitter = new LineSplitter(); this.counts = { ok: 0, bad: 0, byType: {} }; this.lastBad = null; }
  /** 문자열 조각을 넣으면 [{ line, msg }] (msg null = 실패) */
  feed(chunk) {
    return this.splitter.push(chunk).map((line) => this.parse(line)).filter(Boolean);
  }
  parse(line) {
    if (!line.trim()) return null;
    const msg = parseLine(line);
    if (msg) { this.counts.ok++; this.counts.byType[msg.type] = (this.counts.byType[msg.type] || 0) + 1; } else { this.counts.bad++; this.lastBad = line.slice(0, 60); }
    return { line, msg };
  }
}
