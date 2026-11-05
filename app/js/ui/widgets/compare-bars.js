// compare-bars: 지표별 막대 비교(평균 ± 표준편차), 기준선 점선 (chapter-format §6.5). 지표마다 단위가 달라 작은 그래프를 나란히.

import { h, checkProps, clear, infoBox } from '../dom.js';
import { head, sourceBadges } from './_util.js';
import { loadItems } from '../metric-sources.js';
import { barChart } from '../bars.js';
import { COLORS } from '../plot.js';

export const accepts = ['sources', 'metrics', 'baseline', 'stat'];

export function mount(el, props, ctx) {
  checkProps(el, 'compare-bars', props, accepts);
  const metrics = props.metrics || ['itae', 'ts', 'po', 'u_tv'];
  const stat = props.stat || 'mean_sd';
  el.appendChild(head('막대 비교', h('span', { class: 'muted' }, stat === 'mean_sd' ? '막대 = 평균, 오차 막대 = ±1 표준편차(묶음일 때)' : '막대 = 값')));
  const legend = h('div');
  const grid = h('div', { class: 'grid2' });
  const msgs = h('div');
  el.append(legend, msgs, grid);
  let charts = [];
  const info = ctx.metrics.METRIC_INFO || {};
  const load = async () => {
    charts.forEach((c) => c.destroy()); charts = [];
    clear(grid); clear(legend); clear(msgs);
    try {
      const { items, problems } = await loadItems(ctx, props.sources, metrics);
      for (const p of problems) msgs.appendChild(infoBox(`${p.label || p.ref}: ${p.message || p.error}`));
      let base = null;
      if (props.baseline) base = (await loadItems(ctx, [props.baseline], metrics)).items[0] || null;
      if (!items.length) { grid.appendChild(infoBox('비교할 항목이 없습니다.')); return; }
      items.forEach((it, i) => legend.appendChild(h('div', { class: 'row', style: { margin: '.1rem 0' } }, h('span', { style: { color: COLORS[i % COLORS.length], fontWeight: 700 } }, '■'), ` ${it.label} (n=${it.n}) `, ...sourceBadges(it.src))));
      if (base) legend.appendChild(h('div', { class: 'muted' }, `주황 점선 = 기준선 ${base.label}`));
      for (const k of metrics) {
        const cell = h('div');
        grid.appendChild(cell);
        const pctK = /ratio/.test(k);
        const sc = pctK ? 100 : 1;
        charts.push(barChart(cell, items.map((it, i) => ({ label: it.label, mean: it.stats[k].mean == null ? null : it.stats[k].mean * sc, sd: stat === 'mean_sd' && it.n > 1 ? (it.stats[k].sd || 0) * sc : 0, n: it.n, color: COLORS[i % COLORS.length], hatch: it.src.provenance === 'simulated' })),
          { title: info[k] ? info[k].label : k, unit: pctK ? '%' : info[k] ? info[k].unit : '', baseline: base && base.stats[k].mean != null ? base.stats[k].mean * sc : null }));
      }
      grid.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, '옅은 막대 = 시뮬레이션 데이터. 모든 지표는 작을수록 좋음.'));
    } catch (e) { msgs.appendChild(infoBox(e.message)); }
  };
  load();
  const offs = [];
  if (ctx.store && ctx.store.onChange) offs.push(ctx.store.onChange((ev) => { if (ev.type === 'finish' || ev.type === 'delete' || ev.type === 'save') load(); }));
  if (ctx.samples && ctx.samples.onChange) offs.push(ctx.samples.onChange(() => load()));
  return { unmount() { offs.forEach((f) => f()); charts.forEach((c) => c.destroy()); }, update() { load(); } };
}
