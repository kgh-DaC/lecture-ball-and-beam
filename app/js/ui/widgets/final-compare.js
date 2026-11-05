// final-compare: 제어기 종합 비교 — 학생이 고른 슬롯 샘플·내 세션의 지표를 레이더(또는 막대)·표로, 보고서 ZIP (chapter-format §6.7, 15장).
// sources "user-select": 제어기별 대표 슬롯(pid-best, autotune-best, gs-best, mrac-best, lqr-best, smc-best)과 내 세션(제어, 전 챕터)을 체크로 고른다.
// 레이더 축 = 지표, 반지름 = 고른 항목들 사이 min–max 정규화의 역(바깥 = 좋음). 슬롯 점수(best.js)는 같은 제어기끼리만 비교하므로 여기서는 쓰지 않는다.
// 조건(프로파일·주기·서보)이 다른 항목은 "조건 상이" 배지(samples.compareConditions)를 달고 비교는 참고용으로 둔다.

import { h, checkProps, clear, infoBox, warnBox, fmt, badge, download } from '../dom.js';
import { COLORS } from '../plot.js';
import { barChart } from '../bars.js';
import { head, sourceBadges } from './_util.js';
import { loadItems, deltaTable } from '../metric-sources.js';
import { toCSV } from '../../store/csv.js';
import { makeZip } from '../../store/zip.js';

export const accepts = ['sources', 'metrics', 'chart', 'export'];
const DEF_SLOTS = ['pid-best', 'autotune-best', 'gs-best', 'mrac-best', 'lqr-best', 'smc-best'];
const DEF_METRICS = ['tr', 'po', 'ts', 'ess', 'itae', 'u_rms', 'u_tv', 'u_sat_ratio'];

/** 레이더 반지름(순수): 지표별 min–max 정규화, 작을수록 좋음 → 1 − norm. 값 없음 = null. 모두 같으면 1 */
export function radarValues(items, metrics) {
  const out = items.map(() => ({}));
  for (const k of metrics) {
    const vals = items.map((it) => (it.stats[k] && Number.isFinite(it.stats[k].mean) ? (k === 'ess' ? Math.abs(it.stats[k].mean) : it.stats[k].mean) : null));
    const f = vals.filter((v) => v != null);
    const mn = Math.min(...f), mx = Math.max(...f);
    vals.forEach((v, i) => { out[i][k] = v == null ? null : mx > mn ? 1 - (v - mn) / (mx - mn) : 1; });
  }
  return out;
}

/** 조건 검사에서 제어기 차이는 뺀다(제어기끼리 비교하는 화면이므로). 반환 'match'|'differs'|'unknown' (순수) */
export function conditionsExceptController(r) {
  const d = (r.differs || []).filter((k) => k !== 'controller');
  const u = (r.unknown || []).filter((k) => k !== 'controller');
  if (d.length) return 'differs';
  return u.length || (r.result === 'unknown' && !(r.unknown || []).includes('controller')) ? 'unknown' : 'match';
}

function drawRadar(container, items, metrics, radii, labelOf) {
  const wrap = h('div', { class: 'plot' });
  const cv = h('canvas', { role: 'img', 'aria-label': `레이더 차트: ${items.map((it) => it.label).join(', ')}` });
  const H = 320;
  cv.style.height = H + 'px';
  wrap.appendChild(cv);
  container.appendChild(wrap);
  const draw = () => {
    const g = cv.getContext && cv.getContext('2d');
    if (!g) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const W = cv.clientWidth || 420;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 6, R = Math.min(W, H) / 2 - 46;
    const n = metrics.length;
    const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(wrap) : null;
    const cv2 = (k, d) => (css && css.getPropertyValue(k).trim()) || d;
    g.strokeStyle = cv2('--grid', '#d6dbe0'); g.lineWidth = 1; g.font = '11px system-ui, sans-serif'; g.fillStyle = cv2('--muted', '#5d6670');
    for (const f of [0.25, 0.5, 0.75, 1]) { g.beginPath(); for (let i = 0; i <= n; i++) { const a = ang(i % n); const X = cx + R * f * Math.cos(a), Y = cy + R * f * Math.sin(a); i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke(); }
    metrics.forEach((k, i) => {
      const a = ang(i);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); g.stroke();
      g.textAlign = Math.cos(a) > 0.3 ? 'left' : Math.cos(a) < -0.3 ? 'right' : 'center';
      g.fillText(labelOf(k), cx + (R + 8) * Math.cos(a), cy + (R + 12) * Math.sin(a) + 4);
    });
    items.forEach((it, j) => {
      const c = COLORS[j % COLORS.length];
      g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2; g.setLineDash(j % 2 ? [6, 4] : []);
      g.beginPath();
      let pen = false;
      metrics.forEach((k, i) => { const r = radii[j][k]; if (r == null) { pen = false; return; } const a = ang(i); const X = cx + R * (0.08 + 0.92 * r) * Math.cos(a), Y = cy + R * (0.08 + 0.92 * r) * Math.sin(a); pen ? g.lineTo(X, Y) : g.moveTo(X, Y); pen = true; });
      if (metrics.every((k) => radii[j][k] != null)) g.closePath();
      g.stroke(); g.globalAlpha = 0.08; g.fill(); g.globalAlpha = 1; g.setLineDash([]);
    });
  };
  draw();
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => draw()); ro.observe(wrap); }
  return { destroy() { ro && ro.disconnect(); wrap.remove(); } };
}

export function mount(el, props, ctx) {
  checkProps(el, 'final-compare', props, accepts);
  const metrics = props.metrics || DEF_METRICS;
  let chart = props.chart || 'radar';
  const info = (ctx.metrics && ctx.metrics.METRIC_INFO) || {};
  const labelOf = (k) => ((info[k] && info[k].label) || k).split(' ')[0];
  el.appendChild(head('제어기 종합 비교', h('span', { class: 'muted' }, '레이더: 바깥일수록 좋음(고른 항목 사이 상대값)')));
  const pick = h('div', { class: 'final-pick' });
  const ctl = h('div', { class: 'row' });
  const msgs = h('div');
  const legend = h('div');
  const chartBox = h('div');
  const tblBox = h('div', { class: 'tbl-wrap' });
  el.append(pick, ctl, msgs, legend, chartBox, tblBox);
  const selected = new Set();
  let charts = [];
  let last = null;

  const buildPicker = async () => {
    clear(pick);
    if (props.sources && props.sources !== 'user-select') {
      for (const r of props.sources) selected.add(typeof r === 'string' ? r : JSON.stringify(r));
      return;
    }
    const slots = ctx.samples ? ctx.samples.slots().filter((s) => DEF_SLOTS.includes(s.id)) : [];
    const slotIds = slots.length ? slots.map((s) => s.id) : DEF_SLOTS;
    const box1 = h('div', { class: 'row' }, h('b', null, '대표 샘플(슬롯) '));
    for (const id of slotIds) {
      const s = slots.find((x) => x.id === id);
      const ref = `slot:${id}`;
      if (!last && ['pid-best', 'lqr-best', 'smc-best'].includes(id)) selected.add(ref);
      box1.appendChild(h('label', null, h('input', { type: 'checkbox', checked: selected.has(ref), onchange: (e) => { if (e.target.checked) selected.add(ref); else selected.delete(ref); load(); } }), ` ${(s && s.label) || id} `));
    }
    pick.appendChild(box1);
    let mine = [];
    try { mine = ctx.store ? (await ctx.store.sessions.list({ kind: 'control' })).filter((m) => m.complete !== false).slice(0, 30) : []; } catch { mine = []; }
    const box2 = h('div', { class: 'row' }, h('b', null, '내 세션 '));
    if (!mine.length) box2.appendChild(h('span', { class: 'muted' }, '아직 없음 — 11~14장 실습 세션이 여기에 나옵니다'));
    else {
      const sel = h('select', { multiple: true, size: Math.min(6, mine.length), onchange: (e) => {
        for (const m of mine) selected.delete(`session:${m.session_id}`);
        for (const o of Array.from(e.target.selectedOptions || e.target.children.filter((c) => c.selected))) selected.add(`session:${o.value}`);
        load();
      } }, mine.map((m) => h('option', { value: m.session_id, selected: selected.has(`session:${m.session_id}`) }, `${m.chapter_id || ''} · ${(m.controller && m.controller.id) || ''} · ${m.title || m.session_id}`)));
      box2.append(sel, h('span', { class: 'muted' }, ' Ctrl/⌘ 누른 채 여러 개 선택'));
    }
    pick.appendChild(box2);
  };

  const load = async () => {
    charts.forEach((c) => c.destroy()); charts = [];
    clear(msgs); clear(legend); clear(chartBox); clear(tblBox);
    const refs = [...selected];
    if (!refs.length) { msgs.appendChild(infoBox('비교할 항목을 고르세요.')); last = null; return; }
    let items = [], problems = [];
    try { ({ items, problems } = await loadItems(ctx, refs, metrics)); } catch (e) { msgs.appendChild(infoBox(e.message)); return; }
    for (const p of problems) msgs.appendChild(infoBox(`${p.label || p.ref}: ${p.message || p.error}`));
    if (!items.length) { msgs.appendChild(infoBox('지표를 낼 수 있는 항목이 없습니다.')); last = null; return; }
    // 조건 검사: 첫 항목 기준
    const base = items[0];
    const cond = items.map((it) => {
      if (it === base || !ctx.samples || !ctx.samples.compareConditions) return null;
      try { return conditionsExceptController(ctx.samples.compareConditions(it.src.entry ? { entry: it.src.entry, meta: it.src.meta } : { meta: it.src.meta }, base.src.entry ? { entry: base.src.entry, meta: base.src.meta } : { meta: base.src.meta })); } catch { return null; }
    });
    items.forEach((it, i) => {
      const ctrl = (it.src.meta && it.src.meta.controller && it.src.meta.controller.id) || (it.src.entry && it.src.entry.controller) || '?';
      legend.appendChild(h('div', { class: 'row', style: { margin: '.1rem 0' } }, h('span', { style: { color: COLORS[i % COLORS.length], fontWeight: 700 } }, i % 2 ? '- -' : '──'), ` ${it.label} `, badge(ctrl, 'b-unknown'), ` n=${it.n} `, ...sourceBadges(it.src),
        cond[i] === 'differs' ? badge('조건 상이', 'b-bad') : cond[i] === 'unknown' ? badge('조건 불명', 'b-unknown') : null));
    });
    if (cond.some((c) => c && c !== 'match')) msgs.appendChild(warnBox('조건(설정값 프로파일·주기·서보 등)이 다른 항목이 있습니다. 그 항목과의 우열은 참고로만 보세요.'));
    if (items.some((it) => it.src.provenance === 'simulated')) msgs.appendChild(infoBox('시뮬레이션 항목이 섞여 있습니다. 실측과 시뮬레이션은 같은 조건이 아닙니다.'));
    if (chart === 'radar') {
      const ms = metrics.filter((k) => items.some((it) => it.stats[k] && it.stats[k].mean != null));
      if (ms.length >= 3) charts.push(drawRadar(chartBox, items, ms, radarValues(items, ms), labelOf));
      else chartBox.appendChild(infoBox('레이더에 그릴 지표가 3개 미만입니다.'));
    } else {
      const grid = h('div', { class: 'grid2' });
      chartBox.appendChild(grid);
      for (const k of metrics) {
        const cell = h('div'); grid.appendChild(cell);
        const sc = /ratio/.test(k) ? 100 : 1;
        charts.push(barChart(cell, items.map((it, i) => ({ label: it.label, mean: it.stats[k].mean == null ? null : it.stats[k].mean * sc, sd: it.n > 1 ? (it.stats[k].sd || 0) * sc : 0, n: it.n, color: COLORS[i % COLORS.length], hatch: it.src.provenance === 'simulated' })),
          { title: labelOf(k), unit: sc === 100 ? '%' : (info[k] || {}).unit }));
      }
    }
    // 표(첫 항목 기준 증감 %)
    const dt = deltaTable(items, metrics, base.key);
    const show = (k, v) => (v == null ? '–' : /ratio/.test(k) ? `${(v * 100).toFixed(1)}%` : fmt(v, 3));
    tblBox.appendChild(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['항목', 'n', ...metrics.map((k) => `${labelOf(k)}${info[k] && info[k].unit && !/ratio/.test(k) ? ` (${info[k].unit})` : ''}`)].map((x) => h('th', null, x)))),
      h('tbody', null, dt.map((r) => h('tr', null, h('td', null, r.label), h('td', { class: 'numc' }, String(r.n)),
        ...r.cells.map((c) => h('td', { class: 'numc' }, show(c.k, c.mean), c.delta_pct != null ? h('span', { class: 'muted' }, ` ${c.delta_pct > 0 ? '+' : ''}${c.delta_pct.toFixed(0)}%`) : null)))))));
    tblBox.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `괄호 % = 첫 항목(${base.label}) 대비 증감. 모든 지표는 작을수록 좋음.`));
    last = { items, dt, refs };
  };

  ctl.append(h('label', null, '그래프 ', h('select', { onchange: (e) => { chart = e.target.value; load(); } }, [['radar', '레이더'], ['bars', '막대']].map(([v, l]) => h('option', { value: v, selected: v === chart }, l)))));
  if (props.export !== false) ctl.appendChild(h('button', { class: 'btn', onclick: async () => {
    if (!last) return;
    const cols = ['item', 'controller', 'provenance', 'n', ...metrics.flatMap((k) => [`${k}_mean`, `${k}_sd`])];
    const rows = last.items.map((it) => ({ item: it.label, controller: (it.src.meta && it.src.meta.controller && it.src.meta.controller.id) || '', provenance: it.src.provenance || '', n: it.n,
      ...Object.fromEntries(metrics.flatMap((k) => [[`${k}_mean`, it.stats[k].mean], [`${k}_sd`, it.stats[k].sd]])) }));
    const csv = toCSV(cols, rows);
    const sids = last.refs.filter((r) => r.startsWith('session:')).map((r) => r.slice(8));
    const extra = [{ name: 'final_compare.csv', data: csv }, { name: 'final_compare.json', data: JSON.stringify({ refs: last.refs, metrics, created_at: new Date().toISOString() }, null, 2) }];
    const zip = sids.length && ctx.store ? await ctx.store.sessions.exportZip(sids, extra) : makeZip(extra);
    download('final_compare.zip', zip, 'application/zip');
  } }, '보고서 내보내기(ZIP)'));

  const offs = [];
  buildPicker().then(load);
  if (ctx.samples && ctx.samples.onChange) offs.push(ctx.samples.onChange(() => load()));
  if (ctx.store && ctx.store.onChange) offs.push(ctx.store.onChange((ev) => { if (ev.type === 'finish' || ev.type === 'delete') buildPicker().then(load); }));
  return { unmount() { offs.forEach((f) => f()); charts.forEach((c) => c.destroy()); }, update() { load(); } };
}
