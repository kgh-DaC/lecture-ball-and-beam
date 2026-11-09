// 세션 저장소 (data-schema.md §2). 메타 JSON + 행(CSV). IndexedDB 자동 저장 + ZIP 내보내기/불러오기.

import { openDB } from './idb.js';
import { toCSV, parseCSV, columnsFor } from './csv.js';
import { makeZip, readZip } from './zip.js';
import { compute as computeMetrics } from './metrics.js';
import { APP_VER } from '../config/defaults.js';

export const SCHEMA_VER = 1;
const CHUNK = 200; // 행 묶음 크기

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** YYYYMMDD-HHMMSS-<chapter_no>-<rand4> */
export function newSessionId(chapterId, d = new Date()) {
  const no = (String(chapterId || '').match(/^(\d{2})/) || [, '00'])[1];
  const rand = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${no}-${rand}`;
}

/** 로컬 시간대 ISO 문자열(+09:00 형식) */
export function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** provenance 규칙(§2.1): device/import_xlsx → real, virtual/bundle_sim → simulated, replay는 원본 유지 */
export function provenanceFor(source, original) {
  if (source === 'device' || source === 'import_xlsx') return 'real';
  if (source === 'virtual' || source === 'bundle_sim') return 'simulated';
  if (source === 'replay') return original || 'simulated';
  return original || 'simulated';
}

/** 세션 → 파일 텍스트 */
export function toFiles(meta, rows) {
  const columns = columnsFor(meta, rows);
  const m = { ...meta, csv_columns: columns };
  return { jsonName: `session_${meta.session_id}.json`, csvName: `session_${meta.session_id}.csv`, json: JSON.stringify(m, null, 2), csv: toCSV(columns, rows) };
}

/** 파일 텍스트 → 세션. schema_ver가 더 크면 warn에 기록 */
export function fromFiles(jsonText, csvText) {
  const meta = JSON.parse(jsonText);
  const warn = [];
  if (meta.schema_ver > SCHEMA_VER) warn.push(`schema_ver ${meta.schema_ver} > ${SCHEMA_VER}: 아는 필드만 읽습니다`);
  if (!meta.session_id) throw new Error('메타에 session_id가 없습니다');
  // data-schema 1.2.0: device.despike 추가(schema_ver 1 유지). 이전 파일에는 없으므로 null(구 펌웨어 또는 모름)로 채운다
  if (meta.device && typeof meta.device === 'object' && !('despike' in meta.device)) meta.device = { ...meta.device, despike: null };
  // data-schema 1.5.0: 거리 규약·공 반지름 추가(schema_ver 1 유지). 센서는 언제나 공 표면까지 재므로 규약은 'surface',
  // 반지름은 예전 파일에 기록이 없으므로 null(모름 — 표시할 때는 지금 공 크기 기록을 쓴다). 위치 값(y_mm 등)은 어느 판이든 원 측정 거리
  if (!('distance_convention' in meta)) meta.distance_convention = 'surface';
  if (!('ball_radius_mm' in meta)) meta.ball_radius_mm = null;
  const { rows } = csvText ? parseCSV(csvText) : { rows: [] };
  return { meta, rows, warn };
}

/** 세션 통계(§2.1 stats) */
export function statsOf(rows, extra = {}) {
  const n = rows.length;
  const nLost = rows.filter((r) => r.lost === 1).length;
  const dts = rows.map((r) => r.dt_ms).filter((v) => Number.isFinite(v));
  return {
    n, n_lost: nLost, lost_ratio: n ? nLost / n : 0,
    dt_mean_ms: dts.length ? dts.reduce((s, v) => s + v, 0) / dts.length : null,
    dt_max_ms: dts.length ? Math.max(...dts) : null,
    ...extra,
  };
}

export class SessionStore {
  constructor() {
    this.listeners = new Set();
    this.buffers = new Map(); // id → { rows: [], chunk: n }
  }
  db() { return openDB(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(ev) { for (const f of this.listeners) { try { f(ev); } catch (e) { console.error(e); } } }

  /** 실험 시작 즉시 메타 생성(complete=false) */
  async create(meta) {
    const db = await this.db();
    const m = { schema_ver: SCHEMA_VER, complete: false, created_at: isoLocal(), ...meta };
    m.provenance = provenanceFor(m.source, m.provenance);
    await db.put('sessions', m);
    this.buffers.set(m.session_id, { rows: [], chunk: 0, total: 0 });
    this._emit({ type: 'create', id: m.session_id });
    return m;
  }

  /** 행 추가(메모리 버퍼). flush()가 주기적으로 IndexedDB에 쓴다 */
  append(id, row) {
    const b = this.buffers.get(id);
    if (!b) return;
    b.rows.push(row);
    b.total++;
  }

  async flush(id) {
    const b = this.buffers.get(id);
    if (!b || !b.rows.length) return;
    const db = await this.db();
    while (b.rows.length) {
      const part = b.rows.splice(0, CHUNK);
      await db.put('session_rows', { session_id: id, chunk: b.chunk++, rows: part });
    }
  }

  /** 종료(정상/끊김). patch는 메타에 합친다. 지표를 계산해 저장한다 */
  async finish(id, patch = {}) {
    await this.flush(id);
    this.buffers.delete(id);
    const db = await this.db();
    const meta = await db.get('sessions', id);
    if (!meta) return null;
    const rows = await this._rows(id);
    Object.assign(meta, patch);
    if (meta.kind !== 'id') meta.metrics = computeMetrics(rows, meta);
    meta.stats = { ...statsOf(rows), ...(meta.stats || {}), ...(patch.stats || {}) };
    if (meta.kind !== 'id') { const s = statsOf(rows); Object.assign(meta.stats, { n: s.n, n_lost: s.n_lost, lost_ratio: s.lost_ratio }); }
    meta.csv_columns = columnsFor(meta, rows);
    await db.put('sessions', meta);
    this._emit({ type: 'finish', id });
    return meta;
  }

  async _rows(id) {
    const db = await this.db();
    const chunks = await db.rowsOf(id);
    chunks.sort((a, b) => a.chunk - b.chunk);
    return chunks.flatMap((c) => c.rows);
  }

  /** 한 번에 저장(불러오기·재생·시뮬레이션 결과) */
  async save(meta, rows) {
    const db = await this.db();
    const m = { schema_ver: SCHEMA_VER, created_at: isoLocal(), ...meta };
    if (!m.session_id) throw new Error('session_id 필요');
    // provenance는 source 규칙으로 정한다(§2.1). 불러온 파일은 원래 값을 유지(replay/알 수 없는 source)
    m.provenance = provenanceFor(m.source, m.provenance);
    if (m.kind !== 'id' && !m.metrics) m.metrics = computeMetrics(rows, m);
    if (!m.stats) m.stats = statsOf(rows);
    m.csv_columns = columnsFor(m, rows);
    await db.delRows(m.session_id);
    for (let i = 0, c = 0; i < rows.length; i += CHUNK, c++) await db.put('session_rows', { session_id: m.session_id, chunk: c, rows: rows.slice(i, i + CHUNK) });
    await db.put('sessions', m);
    this._emit({ type: 'save', id: m.session_id });
    return m;
  }

  async update(id, patch) {
    const db = await this.db();
    const m = await db.get('sessions', id);
    if (!m) return null;
    Object.assign(m, patch);
    await db.put('sessions', m);
    this._emit({ type: 'update', id });
    return m;
  }

  async recompute(id) {
    const s = await this.get(id);
    if (!s) return null;
    return this.update(id, { metrics: computeMetrics(s.rows, s.meta) });
  }

  /** filter: { chapter_id, kind, controller, source, run_group } */
  async list(filter = {}) {
    const db = await this.db();
    let all = await db.getAll('sessions');
    if (filter.chapter_id) all = all.filter((m) => m.chapter_id === filter.chapter_id);
    if (filter.kind) all = all.filter((m) => (m.kind || 'control') === filter.kind);
    if (filter.controller) all = all.filter((m) => m.controller && m.controller.id === filter.controller);
    if (filter.run_group) all = all.filter((m) => m.run_group && m.run_group.id === filter.run_group);
    return all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  async get(id) {
    const db = await this.db();
    const meta = await db.get('sessions', id);
    if (!meta) return null;
    let rows = await this._rows(id);
    const b = this.buffers.get(id);
    if (b) rows = rows.concat(b.rows);
    return { meta, rows };
  }

  async remove(id) {
    const db = await this.db();
    await db.delRows(id);
    await db.del('sessions', id);
    this._emit({ type: 'delete', id });
  }

  /** ZIP: manifest.json + 세션별 JSON·CSV. extra: [{name,data}] 추가 파일 */
  async exportZip(ids, extra = []) {
    const files = [];
    for (const id of ids) {
      const s = await this.get(id);
      if (!s) continue;
      const f = toFiles(s.meta, s.rows);
      files.push({ name: f.jsonName, data: f.json }, { name: f.csvName, data: f.csv });
    }
    const manifest = { schema_ver: SCHEMA_VER, exported_at: isoLocal(), app_ver: APP_VER, sessions: ids };
    return makeZip([{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) }, ...files, ...extra]);
  }

  /** ZIP 또는 JSON+CSV 파일들 불러오기. 불러온 세션은 source를 바꾸지 않는다(재생 전용). 반환: { imported: [id], warnings } */
  async importFiles(fileList) {
    const texts = new Map();
    for (const f of fileList) {
      if (/\.zip$/i.test(f.name)) {
        for (const e of await readZip(new Uint8Array(await f.arrayBuffer()))) texts.set(e.name.split('/').pop(), e.text());
      } else texts.set(f.name, await f.text());
    }
    return this.importTexts(texts);
  }

  async importTexts(texts) {
    const imported = [];
    const warnings = [];
    for (const [name, txt] of texts) {
      if (!/\.json$/i.test(name) || name === 'manifest.json' || name === 'index-entry.json') continue;
      const base = name.replace(/\.json$/i, '');
      const csv = texts.get(`${base}.csv`);
      try {
        const { meta, rows, warn } = fromFiles(txt, csv);
        warnings.push(...warn.map((w) => `${name}: ${w}`));
        if (!csv) warnings.push(`${name}: CSV가 없어 메타만 불러왔습니다`);
        meta.imported_at = isoLocal();
        meta.read_only = true;
        await this.save(meta, rows);
        imported.push(meta.session_id);
      } catch (e) {
        warnings.push(`${name}: ${e.message}`);
      }
    }
    return { imported, warnings };
  }
}
