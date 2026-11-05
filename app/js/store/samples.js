// 샘플: 번들 인덱스 + 내 샘플, 슬롯 해석, 조건 검사, 비교, 승격, 배포 내보내기 (data-schema.md §5).

import { openDB } from './idb.js';
import { parseCSV, toCSV, columnsFor } from './csv.js';
import { makeZip } from './zip.js';
import { score as bestScore, DEFAULT_WEIGHTS, summaryOf } from './best.js';
import { sameProfile, describeProfile } from './profile.js';
import { isoLocal } from './session.js';
import { compute as computeMetrics } from './metrics.js';

export const TIER_ORDER = { 'my-real': 0, 'bundle-real': 1, 'my-sim': 2, 'bundle-sim': 3 };
export const COMPARE_METRICS = ['tr', 'tp', 'po', 'ts', 'ess', 'iae', 'itae', 'u_rms', 'u_tv', 'u_sat_ratio', 'lost_ratio'];
const COND_LABEL = { provenance: '데이터 출처(실측/시뮬레이션)', controller: '제어기', setpoint_profile: '설정값 프로파일', servo_model: '서보 모델', sample_period: '샘플 주기', model_kind: '모델 종류' };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export function tierOf(x) {
  const my = x.origin === 'my' || (typeof x.id === 'string' && x.id.startsWith('my-') && x.origin !== 'bundle');
  return `${my ? 'my' : 'bundle'}-${x.provenance === 'real' ? 'real' : 'sim'}`;
}

/** 비교용 기술자: 샘플 항목, 세션 메타, 또는 둘을 합친 것에서 조건 값 추출 */
export function describe(x) {
  const meta = x.meta || x;
  const entry = x.entry || x;
  const cond = entry.conditions || meta.conditions || {};
  const ctrl = typeof entry.controller === 'string' ? entry.controller : (meta.controller && meta.controller.id) || null;
  const servo = (meta.device && meta.device.servo_model) || cond.servo_model || null;
  const period = cond.period_assumed ? 'assumed' : (meta.sample_period_ms ?? cond.sample_period_ms ?? (meta.device && meta.device.fs_ms) ?? null);
  return {
    id: entry.id || meta.session_id || x.id,
    controller: ctrl,
    setpoint_profile: entry.setpoint_profile || meta.setpoint_profile || null,
    servo_model: servo === 'unknown' ? null : servo,
    sample_period: period,
    model_kind: (entry.model_kind || meta.model_kind) === 'unknown' ? null : (entry.model_kind || meta.model_kind || null),
    status: cond.status || 'known',
    provenance: entry.provenance || meta.provenance,
    metrics: entry.metrics_summary || (meta.metrics && meta.metrics.summary) || summaryOf(entry),
  };
}

/** §5.5 조건 검사. 반환 { result: 'match'|'differs'|'unknown', differs: [], unknown: [], labels } */
export function compareConditions(a, b) {
  const A = describe(a), B = describe(b);
  const differs = [], unknown = [];
  const chk = (key, eq) => {
    const va = A[key], vb = B[key];
    if (va == null || vb == null) unknown.push(key);
    else if (!eq(va, vb)) differs.push(key);
  };
  // 실측과 시뮬레이션은 같은 조건으로 보지 않는다(qa: 가상 세션이 실측 샘플과 우열 비교되지 않게)
  chk('provenance', (x, y) => x === y);
  chk('controller', (x, y) => x === y);
  chk('setpoint_profile', sameProfile);
  chk('servo_model', (x, y) => x === y);
  if (A.sample_period === 'assumed' || B.sample_period === 'assumed') differs.push('sample_period');
  else chk('sample_period', (x, y) => x === y);
  chk('model_kind', (x, y) => x === y);
  let result;
  if (A.status === 'unknown' || B.status === 'unknown') result = 'unknown';
  else if (differs.length) result = 'differs';
  else if (unknown.length) result = 'unknown';
  else result = 'match';
  return { result, differs, unknown, labels: [...differs, ...unknown].map((k) => COND_LABEL[k] || k) };
}

/**
 * 후보 vs 대상들 비교 (§5.5 4). candidate/targets: { entry?, meta?, ... } (describe 가능한 객체)
 * 반환 { targets: [{ id, condition, metrics: {k: {cand, target, diff_pct, sym}} }], score, tradeoffs, summary, primary }
 */
export function compare(candidate, targets, { weights = DEFAULT_WEIGHTS, metrics = COMPARE_METRICS, primary } = {}) {
  const C = describe(candidate);
  const out = { candidate: C.id, targets: [], score: null, tradeoffs: [], tradeoff_text: null, summary: '', primary: primary || (targets[0] && describe(targets[0]).id) || null };
  for (const t of targets) {
    const T = describe(t);
    const condition = compareConditions(candidate, t);
    const m = {};
    for (const k of metrics) {
      const c = C.metrics ? C.metrics[k] : null, v = T.metrics ? T.metrics[k] : null;
      let diff = null, sym = null;
      if (fin(c) && fin(v)) {
        diff = v !== 0 ? ((c - v) / Math.abs(v)) * 100 : (c === 0 ? 0 : null);
        if (condition.result === 'match') sym = diff != null && Math.abs(diff) < 1 ? '=' : (c < v ? '▲' : c > v ? '▼' : '=');
      }
      m[k] = { cand: fin(c) ? c : null, target: fin(v) ? v : null, diff_pct: diff, sym };
    }
    out.targets.push({ id: T.id, condition, metrics: m, provenance: T.provenance });
  }
  const cands = [candidate, ...targets].map((x) => {
    const d = describe(x);
    return { id: d.id, controller: d.controller, setpoint_profile: d.setpoint_profile, metrics: d.metrics || {} };
  });
  out.score = bestScore(cands, weights);
  const prim = out.targets.find((t) => t.id === out.primary);
  if (prim && prim.condition.result === 'match') {
    const sc = out.score.rows.find((r) => r.id === C.id), sp = out.score.rows.find((r) => r.id === prim.id);
    const worse = Object.entries(prim.metrics).filter(([, v]) => v.sym === '▼').map(([k]) => k);
    const better = Object.entries(prim.metrics).filter(([, v]) => v.sym === '▲').map(([k]) => k);
    if (sc && sp && sc.score != null && sp.score != null) {
      if (sc.score < sp.score && worse.length) {
        out.tradeoffs = worse;
        out.tradeoff_text = `점수 우위, ${worse.map((k) => `${LABEL[k] || k} ${pct(prim.metrics[k].diff_pct)} 열세`).join(', ')}`;
      } else if (sc.score > sp.score && better.length) {
        out.tradeoffs = better;
        out.tradeoff_text = `점수 열세, ${better.map((k) => `${LABEL[k] || k} ${pct(prim.metrics[k].diff_pct)} 우위`).join(', ')}`;
      }
    }
  }
  if (prim) {
    const parts = ['itae', 'ts', 'po'].filter((k) => prim.metrics[k] && prim.metrics[k].diff_pct != null)
      .map((k) => `${LABEL[k]} ${pct(prim.metrics[k].diff_pct)}${prim.metrics[k].sym === '▼' ? '(열세)' : ''}`);
    if (prim.condition.result !== 'match') parts.push(`${prim.condition.result === 'unknown' ? '조건 불명' : '조건 상이'}(${prim.condition.labels.join(', ')}) — 우열 판단 보류`);
    out.summary = parts.join(', ');
  }
  return out;
}
const LABEL = { itae: 'ITAE', ts: 'ts', po: '오버슈트', tr: 'tr', tp: 'tp', ess: 'e_ss', iae: 'IAE', u_rms: 'u_rms', u_tv: 'u_tv', u_sat_ratio: '포화', lost_ratio: '유실' };
function pct(v) { return v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}%`; }

/**
 * 슬롯 후보 정렬(§5.1, §5.3). 순수 함수: entries에는 tier가 붙어 있어야 한다.
 * 반환 { sample: 첫 후보|null, candidates: 정렬된 일치 후보, mismatched: 조건 상이 후보 }
 */
export function rankSlot(slot, entries, { activeOverride = null } = {}) {
  const inSlot = entries.filter((e) => Array.isArray(e.slots) && e.slots.includes(slot.id));
  const ok = [], mismatched = [];
  for (const e of inSlot) {
    const ctrlOk = !slot.controller || e.controller === slot.controller;
    const profOk = !slot.setpoint_profile || sameProfile(slot.setpoint_profile, e.setpoint_profile);
    (ctrlOk && profOk ? ok : mismatched).push(e);
  }
  const active = activeOverride || slot.active;
  // 같은 계층 안 점수: 슬롯 후보 전체로 best.score
  const sc = ok.length ? bestScore(ok.map((e) => ({ id: e.id, controller: e.controller, setpoint_profile: e.setpoint_profile, metrics: e.metrics_summary || {} }))) : { rows: [] };
  const scoreOf = (id) => { const r = sc.rows.find((x) => x.id === id); return r && r.score != null ? r.score : Infinity; };
  ok.sort((a, b) => {
    const ta = TIER_ORDER[a.tier] ?? 9, tb = TIER_ORDER[b.tier] ?? 9;
    if (ta !== tb) return ta - tb;
    const ua = a.conditions && a.conditions.status === 'unknown' ? 1 : 0, ub = b.conditions && b.conditions.status === 'unknown' ? 1 : 0;
    if (ua !== ub) return ua - ub;
    if (active) { if (a.id === active && b.id !== active) return -1; if (b.id === active && a.id !== active) return 1; }
    const sa = scoreOf(a.id), sb = scoreOf(b.id);
    if (sa !== sb) return sa - sb;
    return String(b.promoted_at || '').localeCompare(String(a.promoted_at || ''));
  });
  return { sample: ok[0] || null, candidates: ok, mismatched, score: sc };
}

export class SampleStore {
  /** deps: { sessions: SessionStore, base: '../data/samples/', fetch } */
  constructor(deps) {
    this.deps = deps;
    this.index = null;
    this.my = [];
    this.listeners = new Set();
    this.cache = new Map();
    this.loadError = null;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(ev) { for (const f of this.listeners) { try { f(ev); } catch (e) { console.error(e); } } }

  async load(force = false) {
    if (this.index && !force) return this;
    const f = this.deps.fetch || fetch;
    try {
      const r = await f(this.deps.base + 'index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.index = await r.json();
      this.loadError = null;
    } catch (e) {
      this.index = { schema_ver: 1, slots: [], samples: [] };
      this.loadError = `번들 샘플 인덱스(data/samples/index.json)를 읽지 못했습니다: ${e.message}`;
    }
    for (const s of this.index.samples || []) { s.origin = 'bundle'; s.tier = tierOf(s); }
    const db = await openDB();
    this.my = (await db.getAll('my_samples')).map((s) => ({ ...s, origin: 'my', tier: tierOf({ ...s, origin: 'my' }) }));
    const metaRec = await db.get('meta', 'slot_active');
    this.slotActive = (metaRec && metaRec.value) || {};
    return this;
  }

  slots() { return (this.index && this.index.slots) || []; }
  slot(id) { return this.slots().find((s) => s.id === id) || null; }
  all() { return [...this.my, ...((this.index && this.index.samples) || [])]; }

  async list(filter = {}) {
    await this.load();
    let all = this.all();
    if (filter.controller) all = all.filter((s) => s.controller === filter.controller);
    if (filter.provenance) all = all.filter((s) => s.provenance === filter.provenance);
    if (filter.slot) all = all.filter((s) => (s.slots || []).includes(filter.slot));
    if (filter.chapter_id) all = all.filter((s) => (s.chapter_ids || []).includes(filter.chapter_id));
    if (filter.kind) all = all.filter((s) => (s.kind || 'control') === filter.kind);
    return all.sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || String(a.id).localeCompare(String(b.id)));
  }

  entry(id) { return this.all().find((s) => s.id === id) || null; }

  /** 샘플 전체(메타+행). 반환 { entry, meta, rows, tier } */
  async get(id) {
    await this.load();
    if (this.cache.has(id)) return this.cache.get(id);
    const entry = this.entry(id);
    if (!entry) throw new Error(`샘플 ${id} 가 없습니다`);
    let meta, rows;
    if (entry.origin === 'my') {
      const s = await this.deps.sessions.get(entry.session_id || (entry.source && entry.source.session_id));
      if (!s) throw new Error(`내 샘플 ${id}의 원본 세션이 삭제되었습니다`);
      meta = s.meta; rows = s.rows;
    } else {
      const f = this.deps.fetch || fetch;
      const files = entry.files || { meta: `${id}.json`, csv: `${id}.csv` };
      const [mr, cr] = await Promise.all([f(this.deps.base + files.meta), f(this.deps.base + files.csv)]);
      if (!mr.ok || !cr.ok) throw new Error(`샘플 파일을 읽지 못했습니다: ${files.meta}`);
      meta = await mr.json();
      rows = parseCSV(await cr.text()).rows;
    }
    // 지표는 항상 metrics.js로 다시 계산(정의 한 곳)
    if ((entry.kind || meta.kind) !== 'id') {
      const m = computeMetrics(rows, meta);
      meta = { ...meta, metrics: m };
      if (!entry.metrics_summary) entry.metrics_summary = m.summary;
    }
    const res = { entry, meta, rows, tier: entry.tier, id };
    this.cache.set(id, res);
    return res;
  }

  /** §5.3. 반환 { ...get 결과, tier, candidates, mismatched } 또는 null(슬롯 비어 있음) */
  async resolveSlot(slotId) {
    await this.load();
    const slot = this.slot(slotId) || { id: slotId };
    const r = rankSlot(slot, this.all(), { activeOverride: this.slotActive[slotId] });
    if (!r.sample) return { empty: true, slot, candidates: [], mismatched: r.mismatched };
    try {
      const full = await this.get(r.sample.id);
      return { ...full, slot, candidates: r.candidates, mismatched: r.mismatched, score: r.score };
    } catch (e) {
      return { error: e.message, entry: r.sample, slot, candidates: r.candidates, mismatched: r.mismatched };
    }
  }

  compareConditions(a, b) { return compareConditions(a, b); }
  compare(candidate, targets, opts) { return compare(candidate, targets, opts); }

  /** 세션 메타에 맞는 슬롯 제안 */
  suggestSlots(meta) {
    return this.slots().filter((s) => (s.kind || 'control') === (meta.kind || 'control') &&
      (!s.controller || (meta.controller && s.controller === meta.controller.id)) &&
      (!s.setpoint_profile || sameProfile(s.setpoint_profile, meta.setpoint_profile)));
  }

  /**
   * 승격(§5.5 5~6).
   * d: { decision: 'replace'|'add'|'hold', slots: [], chapter_ids: [], comparison, weights, title, metrics_override?, run_group_mode? }
   */
  async promote(sessionId, d) {
    const s = await this.deps.sessions.get(sessionId);
    if (!s) throw new Error('세션을 찾을 수 없습니다');
    const meta = s.meta;
    const slot = (d.slots && d.slots[0]) || null;
    const cmp = d.comparison || null;
    const prim = cmp && cmp.targets ? cmp.targets.find((t) => t.id === cmp.primary) : null;
    const rowsScore = cmp && cmp.score ? cmp.score.rows : [];
    const rowOf = (id) => rowsScore.find((r) => r.id === id);
    const id = `my-${sessionId}`;
    // 점수 rows의 후보 id는 세션 id(describe가 session_id 사용)
    const candRow = rowOf(sessionId) || rowOf(id);
    const promotion = {
      decision: d.decision,
      slot,
      replaced_sample_id: d.decision === 'replace' ? (d.replaced_sample_id ?? (prim ? prim.id : null)) : null,
      score_before: prim && rowOf(prim.id) ? { sample_id: prim.id, score: rowOf(prim.id).score, rank: rowOf(prim.id).rank } : null,
      score_after: candRow ? { sample_id: id, score: candRow.score, rank: candRow.rank } : null,
      weights: (cmp && cmp.score && cmp.score.weights) || d.weights || { ...DEFAULT_WEIGHTS },
      condition_check: prim ? { result: prim.condition.result, differs: prim.condition.differs, unknown: prim.condition.unknown, against: prim.id } : null,
      tradeoffs: (cmp && cmp.tradeoffs) || [],
      comparison_summary: (cmp && [cmp.summary, cmp.tradeoff_text].filter(Boolean).join(' / ')) || '',
      approved_by: 'user',
      ...(d.run_group_mode ? { run_group_mode: d.run_group_mode } : {}),
    };
    if (d.decision === 'hold') {
      await this.deps.sessions.update(sessionId, { promotion_review: { ...promotion, reviewed_at: isoLocal() } });
      this._emit({ type: 'hold', session_id: sessionId });
      return null;
    }
    const summary = d.metrics_override || (meta.metrics && meta.metrics.summary) || null;
    const entry = {
      id,
      title: d.title || meta.title || id,
      kind: meta.kind || 'control',
      controller: meta.controller ? meta.controller.id : null,
      params: meta.controller ? meta.controller.params : null,
      provenance: meta.provenance,  // simulated는 절대 real로 바뀌지 않는다
      source: { kind: 'session', file: null, sheet: null, columns: null, session_id: sessionId },
      conditions: {
        status: meta.conditions && meta.conditions.status ? meta.conditions.status : 'known',
        servo_model: meta.device ? meta.device.servo_model : null,
        sample_period_ms: meta.sample_period_ms ?? null,
        fs_ms: meta.device ? meta.device.fs_ms : null, alpha: meta.device ? meta.device.alpha : null, lim_cdeg: meta.device ? meta.device.lim_cdeg : null,
        despike: meta.device ? (meta.device.despike ?? null) : null,
        period_assumed: false,
      },
      model_kind: meta.model_kind || 'unknown',
      setpoint_profile: meta.setpoint_profile || null,
      slots: d.slots || [],
      chapter_ids: d.chapter_ids || [],
      files: { meta: `${id}.json`, csv: `${id}.csv` },
      metrics_summary: summary,
      score: candRow ? { group: cmp.score.group, value: candRow.score, rank: candRow.rank, n_candidates: cmp.score.n_candidates, weights: cmp.score.weights, dropped: cmp.score.dropped, computed_at: isoLocal() } : null,
      promoted_at: isoLocal(),
      promotion,
      badges: meta.provenance === 'simulated' ? ['가상 장치'] : [],
      session_id: sessionId,
      ...(meta.run_group ? { run_group: meta.run_group } : {}),
    };
    const db = await openDB();
    await db.put('my_samples', entry);
    if (d.decision === 'replace' && slot) {
      this.slotActive = { ...(this.slotActive || {}), [slot]: id };
      await db.put('meta', { key: 'slot_active', value: this.slotActive });
    }
    await this.deps.sessions.update(sessionId, { promoted_as: id });
    this.cache.delete(id);
    await this.load(true);
    this._emit({ type: 'promote', id, slots: entry.slots });
    return entry;
  }

  async removeMy(id) {
    const db = await openDB();
    await db.del('my_samples', id);
    for (const [k, v] of Object.entries(this.slotActive || {})) if (v === id) delete this.slotActive[k];
    await db.put('meta', { key: 'slot_active', value: this.slotActive });
    this.cache.delete(id);
    await this.load(true);
    this._emit({ type: 'remove', id });
  }

  /** 배포용 내보내기 §5.6: <id>.json(세션 메타 + promotion) + <id>.csv + index-entry.json */
  async exportBundle(id) {
    const full = await this.get(id);
    const e = { ...full.entry };
    delete e.origin; delete e.tier;
    const meta = { ...full.meta, promotion: e.promotion, sample_id: id };
    const cols = columnsFor(meta, full.rows);
    meta.csv_columns = cols;
    return makeZip([
      { name: `${id}.json`, data: JSON.stringify(meta, null, 2) },
      { name: `${id}.csv`, data: toCSV(cols, full.rows) },
      { name: 'index-entry.json', data: JSON.stringify(e, null, 2) },
    ]);
  }

  profileText(p) { return describeProfile(p); }
}
