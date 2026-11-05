// 세션 CSV (data-schema.md §2.3). 빈 칸 = NaN. -1을 위치 값으로 쓰지 않는다.

export const CONTROL_COLUMNS = ['t_s', 'ref_mm', 'y_mm', 'y_filt_mm', 'u_cdeg', 'cmd_echo_cdeg', 'servo_pot_cdeg', 'pot_raw', 'mode', 'dt_ms', 'lost'];
export const ID_COLUMNS = ['idx', 't_s', 'cmd_cdeg', 'pot_raw', 'theta_cdeg'];

function cell(v) {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    // 불필요한 부동소수 꼬리 제거(6자리 유효숫자보다 길게 필요 없음)
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10)));
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: 객체 배열. columns: 열 이름 배열 */
export function toCSV(columns, rows) {
  const out = [columns.join(',')];
  for (const r of rows) out.push(columns.map((c) => cell(r[c])).join(','));
  return out.join('\n') + '\n';
}

function splitLine(line) {
  if (!line.includes('"')) return line.split(',');
  const cells = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** CSV 텍스트 → { columns, rows }. 숫자로 읽을 수 있으면 숫자, 빈 칸은 NaN, 그 외 문자열. */
export function parseCSV(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { columns: [], rows: [] };
  const columns = splitLine(lines[0]).map((s) => s.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const r = {};
    columns.forEach((c, k) => {
      const s = (cells[k] ?? '').trim();
      if (s === '') r[c] = NaN;
      else { const n = Number(s); r[c] = Number.isNaN(n) ? s : n; }
    });
    rows.push(r);
  }
  return { columns, rows };
}

/** 메타의 csv_columns + 행에 있는 dbg_* 열을 합쳐 열 목록을 만든다 */
export function columnsFor(meta, rows) {
  const base = meta && Array.isArray(meta.csv_columns) && meta.csv_columns.length ? meta.csv_columns.slice()
    : (meta && meta.kind === 'id' ? ID_COLUMNS.slice() : CONTROL_COLUMNS.slice());
  const extra = new Set();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) if (k.startsWith('dbg_') && !base.includes(k)) extra.add(k);
  return base.concat([...extra].sort());
}
