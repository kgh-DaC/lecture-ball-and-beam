// metrics-table, compare-bars 공용: 참조 → 지표 항목(검증 묶음은 평균 ± 표준편차로 합친다).

import { resolveSources } from './sources.js';
import { aggregate, deltaPct } from '../store/compare.js';

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 해석된 출처 → 항목. 같은 run_group 세션은 하나로 합친다.
 * 반환 [{ key, label, src, n, stats: { k: { mean, sd, n } } }]
 */
export function itemsFromSources(list, metrics, computeFn) {
  const items = [];
  const groups = new Map();
  for (const s of list) {
    if (!s.rows && !s.meta) continue;
    const summary = (s.meta && s.meta.metrics && s.meta.metrics.summary) || (s.entry && s.entry.metrics_summary) || (computeFn && s.rows ? (computeFn(s.rows, s.meta).summary || {}) : {});
    const meta = { ...(s.meta || {}), metrics: { summary } };
    const g = s.kind === 'session' && s.meta && s.meta.run_group && s.meta.run_group.id;
    if (g) {
      if (!groups.has(g)) { const it = { key: `group:${g}`, label: `검증 묶음 ${s.meta.run_group.label || g}`, src: s, metas: [] }; groups.set(g, it); items.push(it); }
      groups.get(g).metas.push(meta);
    } else items.push({ key: s.id || s.ref, label: s.label, src: s, metas: [meta] });
  }
  for (const it of items) { it.n = it.metas.length; it.stats = aggregate(it.metas, metrics); delete it.metas; }
  return items;
}

export async function loadItems(ctx, sources, metrics, opts = {}) {
  const list = await resolveSources(ctx, sources || 'chapter', { chapterLimit: opts.limit ?? 30, chapterKind: 'control' });
  return { items: itemsFromSources(list.filter((s) => s.rows || s.meta), metrics, ctx.metrics && ctx.metrics.compute), problems: list.filter((s) => s.empty || s.error) };
}

/** 기준선 대비 증감 % 표 데이터(순수) */
export function deltaTable(items, metrics, baseKey) {
  const base = items.find((i) => i.key === baseKey) || null;
  return items.map((it) => ({
    key: it.key, label: it.label, n: it.n,
    cells: metrics.map((k) => {
      const v = it.stats[k] ? it.stats[k].mean : null;
      const b = base && base.stats[k] ? base.stats[k].mean : null;
      return { k, mean: v, sd: it.stats[k] ? it.stats[k].sd : null, delta_pct: base && it !== base && fin(v) && fin(b) ? deltaPct(v, b) : null };
    }),
  }));
}
