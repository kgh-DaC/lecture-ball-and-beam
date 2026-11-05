// IndexedDB 래퍼 (data-schema.md §9: DB 'ballbeam', 버전 1).
// IndexedDB를 쓸 수 없는 환경(Node 시험, 사생활 보호 모드 일부)에서는 메모리 저장소로 대체한다.

export const DB_NAME = 'ballbeam';
export const DB_VER = 1;
export const STORES = {
  sessions: { keyPath: 'session_id' },
  session_rows: { keyPath: ['session_id', 'chunk'] },
  my_samples: { keyPath: 'id' },
  calibrations: { keyPath: 'created_at' },
  id_results: { keyPath: 'created_at' },
  progress: { keyPath: 'chapter_id' },
  meta: { keyPath: 'key' },
};

function keyOf(store, v) {
  const kp = STORES[store].keyPath;
  return Array.isArray(kp) ? JSON.stringify(kp.map((k) => v[k])) : v[kp];
}

class MemoryDB {
  constructor() { this.data = Object.fromEntries(Object.keys(STORES).map((s) => [s, new Map()])); this.memory = true; }
  async get(store, key) { const k = Array.isArray(key) ? JSON.stringify(key) : key; const v = this.data[store].get(k); return v ? structuredClone(v) : undefined; }
  async put(store, value) { this.data[store].set(keyOf(store, value), structuredClone(value)); }
  async del(store, key) { this.data[store].delete(Array.isArray(key) ? JSON.stringify(key) : key); }
  async getAll(store) { return [...this.data[store].values()].map((v) => structuredClone(v)); }
  async rowsOf(sessionId) {
    return [...this.data.session_rows.values()].filter((v) => v.session_id === sessionId).sort((a, b) => a.chunk - b.chunk).map((v) => structuredClone(v));
  }
  async delRows(sessionId) {
    for (const [k, v] of this.data.session_rows) if (v.session_id === sessionId) this.data.session_rows.delete(k);
  }
}

class IdbDB {
  constructor(db) { this.db = db; this.memory = false; }
  _req(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      let result;
      if (r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  }
  get(store, key) { return this._req(store, 'readonly', (s) => s.get(key)); }
  put(store, value) { return this._req(store, 'readwrite', (s) => s.put(value)); }
  del(store, key) { return this._req(store, 'readwrite', (s) => s.delete(key)); }
  getAll(store) { return this._req(store, 'readonly', (s) => s.getAll()); }
  rowsOf(sessionId) {
    const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
    return this._req('session_rows', 'readonly', (s) => s.getAll(range));
  }
  delRows(sessionId) {
    const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
    return this._req('session_rows', 'readwrite', (s) => s.delete(range));
  }
}

let dbPromise = null;

/** DB 열기. 실패하면 메모리 DB(새로고침하면 사라짐)를 반환하고 db.memory = true. */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(new MemoryDB()); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { console.warn('IndexedDB 열기 실패, 메모리 사용', e); resolve(new MemoryDB()); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, def);
    };
    req.onsuccess = () => resolve(new IdbDB(req.result));
    req.onerror = () => { console.warn('IndexedDB 오류, 메모리 사용', req.error); resolve(new MemoryDB()); };
    req.onblocked = () => console.warn('IndexedDB 업그레이드가 다른 탭 때문에 막혔습니다');
  });
  return dbPromise;
}

/** 시험용: 새 메모리 DB를 강제로 쓰게 한다. */
export function useMemoryDB() { dbPromise = Promise.resolve(new MemoryDB()); return dbPromise; }
