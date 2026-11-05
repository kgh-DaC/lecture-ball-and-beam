// score-weights: 점수 가중치 슬라이더 → 슬롯 후보 순위 변화 (data-schema §5.4). 점수 계산은 best.js 하나.

import { h, checkProps, clear, slider, infoBox, fmt } from '../dom.js';
import { head, channel, sourceBadges } from './_util.js';

export const accepts = ['weights', 'slot'];
const KEYS = [['itae', 'ITAE'], ['ts', '정착시간'], ['po', '오버슈트'], ['u_tv', '입력 변화량']];

export function mount(el, props, ctx) {
  checkProps(el, 'score-weights', props, accepts);
  const w = { ...(ctx.best.DEFAULT_WEIGHTS || {}), ...(props.weights || {}) };
  const ch = channel(ctx, props, { weights: w });
  let slotId = props.slot || (ctx.chapter && ctx.chapter.promote_slots && ctx.chapter.promote_slots[0]) || null;
  el.appendChild(head('점수 가중치', h('span', { class: 'muted' }, '점수 = Σ 가중치 × 정규화 지표(낮을수록 좋음). 합은 자동으로 1로 맞춤')));
  const ctl = h('div', { class: 'row' });
  const sl = h('div');
  const out = h('div', { class: 'tbl-wrap' });
  el.append(ctl, sl, out);
  for (const [k, lab] of KEYS) sl.appendChild(slider({ label: lab, min: 0, max: 1, step: 0.05, value: w[k] ?? 0, onInput: (v) => { w[k] = v; ch.set({ weights: { ...w } }); draw(); } }));
  let cands = [];
  const load = async () => {
    await ctx.samples.load();
    clear(ctl).append(h('label', null, '슬롯 ', h('select', { onchange: (e) => { slotId = e.target.value; load(); } }, ctx.samples.slots().map((s) => h('option', { value: s.id, selected: s.id === slotId }, s.label || s.id)))));
    if (!slotId && ctx.samples.slots()[0]) slotId = ctx.samples.slots()[0].id;
    const r = slotId ? await ctx.samples.resolveSlot(slotId) : null;
    cands = r && r.candidates ? r.candidates : [];
    draw();
  };
  const draw = () => {
    clear(out);
    if (!cands.length) { out.appendChild(infoBox('이 슬롯에 후보 샘플이 없습니다.')); return; }
    const sc = ctx.best.score(cands.map((e) => ({ id: e.id, controller: e.controller, setpoint_profile: e.setpoint_profile, metrics: e.metrics_summary || {} })), w);
    const rows = sc.rows.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    const ent = Object.fromEntries(cands.map((e) => [e.id, e]));
    out.append(
      h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `사용 가중치(정규화) ${Object.entries(sc.weights_used).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}${sc.dropped.length ? ` · 값이 없어 뺀 항목 ${sc.dropped.join(', ')}` : ''}`),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['순위', '샘플', 'ITAE', 'ts', 'P.O.', 'u_tv', '점수', '자격'].map((x) => h('th', null, x)))),
        h('tbody', null, rows.map((r) => { const e = ent[r.id] || {}; return h('tr', null, h('td', { class: 'numc' }, r.rank ?? '–'), h('td', null, e.title || r.id, ' ', ...sourceBadges({ tier: e.tier, provenance: e.provenance, conditionsUnknown: e.conditions && e.conditions.status === 'unknown' })),
          h('td', { class: 'numc' }, fmt(r.raw.itae, 0)), h('td', { class: 'numc' }, r.ts_unsettled ? '미정착' : fmt(r.raw.ts, 2)), h('td', { class: 'numc' }, fmt(r.raw.po, 1)), h('td', { class: 'numc' }, fmt(r.raw.u_tv, 1)),
          h('td', { class: 'numc' }, r.score == null ? '–' : r.score.toFixed(3)), h('td', null, r.eligible === true ? '적격' : r.eligible_note || '')); }))),
      h('p', { class: 'muted', style: { fontSize: '.85rem' } }, '슬롯 대표는 계층(내 실측 > 실측 > 내 시뮬레이션 > 시뮬레이션)이 먼저이고, 같은 계층 안에서만 이 점수로 순위를 매긴다.'));
  };
  load().catch((e) => out.appendChild(infoBox(e.message)));
  const off = ctx.samples.onChange(() => load().catch(() => {}));
  return { unmount() { off(); } };
}
