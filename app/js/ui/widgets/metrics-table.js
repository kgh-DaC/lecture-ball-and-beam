// metrics-table: 세션·샘플 지표 표, 기준선 대비 증감 % (chapter-format §6.5). 검증 묶음은 평균 ± 표준편차.

import { h, checkProps, clear, infoBox, fmt, download } from '../dom.js';
import { head, sourceBadges } from './_util.js';
import { loadItems, deltaTable } from '../metric-sources.js';
import { toCSV } from '../../store/csv.js';

export const accepts = ['sources', 'metrics', 'baseline'];
export const DEF_METRICS = ['tr', 'po', 'ts', 'ess', 'iae', 'itae', 'u_rms', 'u_tv', 'u_sat_ratio', 'lost_ratio'];

export function mount(el, props, ctx) {
  checkProps(el, 'metrics-table', props, accepts);
  const metrics = props.metrics || DEF_METRICS;
  el.appendChild(head('지표 표', h('span', { class: 'muted' }, '모든 지표는 작을수록 좋음. 증감 %는 기준선 대비')));
  const ctl = h('div', { class: 'row' });
  const box = h('div', { class: 'tbl-wrap' });
  const msgs = h('div');
  el.append(ctl, msgs, box);
  let items = [], baseKey = null;
  const info = ctx.metrics.METRIC_INFO || {};
  const show = (k, v) => (v == null ? '–' : /ratio/.test(k) ? `${(v * 100).toFixed(1)}%` : fmt(v, 3));
  const render = () => {
    clear(box);
    if (!items.length) { box.appendChild(infoBox('표시할 세션·샘플이 없습니다.')); return; }
    const rows = deltaTable(items, metrics, baseKey);
    box.appendChild(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['항목', 'n', ...metrics.map((k) => (info[k] ? `${info[k].label}${info[k].unit ? ` (${info[k].unit})` : ''}` : k))].map((x) => h('th', null, x)))),
      h('tbody', null, rows.map((r, i) => h('tr', { style: r.key === baseKey ? { background: '#fff7e6' } : null },
        h('td', null, r.label, ' ', ...sourceBadges(items[i].src), r.key === baseKey ? ' (기준선)' : ''), h('td', { class: 'numc' }, String(r.n)),
        ...r.cells.map((c) => h('td', { class: 'numc' }, show(c.k, c.mean), r.n > 1 && c.sd != null ? h('span', { class: 'muted' }, ` ±${show(c.k, c.sd)}`) : null,
          c.delta_pct != null ? h('span', { class: c.delta_pct < -1 ? 'sym-up' : c.delta_pct > 1 ? 'sym-down' : 'sym-eq' }, ` ${c.delta_pct > 0 ? '+' : ''}${c.delta_pct.toFixed(0)}%`) : null)))))));
  };
  const renderCtl = () => {
    clear(ctl).append(
      h('label', null, '기준선 ', h('select', { onchange: (e) => { baseKey = e.target.value || null; render(); } }, h('option', { value: '' }, '없음'), items.map((it) => h('option', { value: it.key, selected: it.key === baseKey }, it.label)))),
      h('button', { class: 'btn small', onclick: () => {
        const rows = deltaTable(items, metrics, baseKey).map((r) => ({ item: r.label, n: r.n, ...Object.fromEntries(r.cells.flatMap((c) => [[c.k, c.mean], [`${c.k}_sd`, c.sd], [`${c.k}_delta_pct`, c.delta_pct]])) }));
        download('metrics.csv', toCSV(['item', 'n', ...metrics.flatMap((k) => [k, `${k}_sd`, `${k}_delta_pct`])], rows), 'text/csv');
      } }, 'CSV 내보내기'));
  };
  const load = async () => {
    try {
      const r = await loadItems(ctx, props.sources, metrics);
      items = r.items;
      clear(msgs);
      for (const p of r.problems) msgs.appendChild(infoBox(`${p.label || p.ref}: ${p.message || p.error}`));
      if (props.baseline && !baseKey) {
        const b = (await loadItems(ctx, [props.baseline], metrics)).items[0];
        if (b) { if (!items.find((i) => i.key === b.key)) items.unshift(b); baseKey = b.key; }
      }
      renderCtl(); render();
    } catch (e) { clear(msgs).appendChild(infoBox(e.message)); }
  };
  load();
  const offs = [];
  if (ctx.store && ctx.store.onChange) offs.push(ctx.store.onChange((ev) => { if (ev.type !== 'create') load(); }));
  if (ctx.samples && ctx.samples.onChange) offs.push(ctx.samples.onChange(() => load()));
  return { unmount() { offs.forEach((f) => f()); }, update() { load(); } };
}
