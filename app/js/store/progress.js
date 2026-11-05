// 진도 저장 (chapter-format.md §8). IndexedDB 'progress', 키 = 챕터 id.

import { openDB } from './idb.js';
import { isoLocal } from './session.js';
import { APP_VER } from '../config/defaults.js';

/** 내보내기 파일 병합: 챕터별 updated_at이 더 새 것을 남긴다. 모르는 챕터 id도 보존 */
export function mergeProgress(local, imported) {
  const out = { ...local };
  for (const [id, rec] of Object.entries(imported || {})) {
    const cur = out[id];
    if (!cur || String(rec.updated_at || '') > String(cur.updated_at || '')) out[id] = { ...rec, chapter_id: id };
  }
  return out;
}

export class Progress {
  constructor() { this.cache = null; this.listeners = new Set(); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async _load() {
    if (this.cache) return this.cache;
    const db = await openDB();
    this.cache = {};
    for (const r of await db.getAll('progress')) this.cache[r.chapter_id] = r;
    return this.cache;
  }
  async all() { return { ...(await this._load()) }; }
  async get(id) { const c = await this._load(); return c[id] ? { ...c[id] } : { chapter_id: id }; }
  /** 부분 갱신(배열 키는 합집합). 옛 진도의 quiz 필드는 보존만 하고 쓰지 않는다 */
  async set(id, partial) {
    const c = await this._load();
    const cur = c[id] || { chapter_id: id };
    const next = { ...cur, ...partial, chapter_id: id, updated_at: isoLocal() };
    if (partial.predictions) next.predictions = { ...(cur.predictions || {}), ...partial.predictions };
    if (partial.practice_sessions) next.practice_sessions = [...new Set([...(cur.practice_sessions || []), ...partial.practice_sessions])];
    if (partial.promoted_samples) next.promoted_samples = [...new Set([...(cur.promoted_samples || []), ...partial.promoted_samples])];
    c[id] = next;
    const db = await openDB();
    await db.put('progress', next);
    for (const f of this.listeners) f(id, next);
    return next;
  }
  async exportJSON() {
    return JSON.stringify({ schema_ver: 1, exported_at: isoLocal(), app_ver: APP_VER, chapters: await this.all() }, null, 2);
  }
  async importJSON(text) {
    const data = JSON.parse(text);
    if (!data || typeof data.chapters !== 'object') throw new Error('진도 파일 형식이 아닙니다(chapters 없음)');
    const merged = mergeProgress(await this.all(), data.chapters);
    const db = await openDB();
    for (const rec of Object.values(merged)) await db.put('progress', rec);
    this.cache = merged;
    for (const f of this.listeners) f(null, null);
    return Object.keys(data.chapters).length;
  }
}
