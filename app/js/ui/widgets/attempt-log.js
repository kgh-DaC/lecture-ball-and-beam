// attempt-log: 이 챕터 세션의 시도 이력(자동: 번호·바뀐 파라미터·지표 / 학생: 이유·판단) (chapter-format §6.5).

import { h, checkProps, clear, fmt, provenanceBadge, badge } from '../dom.js';
import { head } from './_util.js';

export const accepts = ['max_rows'];

/** 이전 시도 대비 바뀐 파라미터 문자열(순수) */
export function paramDiff(prev, cur) {
  if (!cur) return '';
  const a = (prev && prev.params) || {}, b = cur.params || {};
  if (!prev || prev.id !== cur.id) return Object.entries(b).map(([k, v]) => `${k}=${typeof v === 'number' ? fmt(v) : v}`).join(', ');
  const ch = Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => `${k} ${typeof a[k] === 'number' ? fmt(a[k]) : a[k]}→${typeof b[k] === 'number' ? fmt(b[k]) : b[k]}`);
  return ch.length ? ch.join(', ') : '(변경 없음)';
}

export function mount(el, props, ctx) {
  checkProps(el, 'attempt-log', props, accepts);
  const max = props.max_rows ?? 20;
  el.appendChild(head('시도 이력', h('span', { class: 'muted' }, '이유·판단 칸은 직접 적으세요(세션에 저장)')));
  const box = h('div', { class: 'tbl-wrap' });
  el.appendChild(box);
  const render = async () => {
    if (!ctx.store || !ctx.chapter) return;
    const all = (await ctx.store.sessions.list({ chapter_id: ctx.chapter.id, kind: 'control' })).slice(0, max).reverse();
    clear(box);
    if (!all.length) { box.appendChild(h('p', { class: 'muted' }, '아직 시도가 없습니다.')); return; }
    const rows = all.map((m, i) => {
      const s = (m.metrics && m.metrics.summary) || {};
      const note = m.attempt || {};
      const save = (k) => (e) => ctx.store.sessions.update(m.session_id, { attempt: { ...(m.attempt || {}), [k]: e.target.value } }).then((x) => { m.attempt = x.attempt; });
      return h('tr', null,
        h('td', { class: 'numc' }, String(note.no ?? i + 1)),
        h('td', null, (m.created_at || '').slice(11, 19), ' ', provenanceBadge(m.provenance), m.complete === false ? badge('중단', 'b-bad') : null),
        h('td', null, note.changed || paramDiff(i ? all[i - 1].controller : null, m.controller)),
        h('td', { class: 'numc' }, fmt(s.po, 1)), h('td', { class: 'numc' }, s.ts == null && s.computable !== false ? '미정착' : fmt(s.ts, 2)),
        h('td', { class: 'numc' }, fmt(s.ess, 1)), h('td', { class: 'numc' }, fmt(s.itae, 0)), h('td', { class: 'numc' }, s.u_sat_ratio == null ? '–' : `${(s.u_sat_ratio * 100).toFixed(0)}%`),
        h('td', null, h('input', { type: 'text', value: note.reason || '', placeholder: '왜 바꿨나', onchange: save('reason') })),
        h('td', null, h('input', { type: 'text', value: note.judgement || '', placeholder: '결과 판단', onchange: save('judgement') })));
    });
    box.appendChild(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['#', '시각', '바꾼 값', 'P.O.(%)', 'ts(s)', 'e_ss(mm)', 'ITAE', '포화', '이유', '판단'].map((t) => h('th', null, t)))),
      h('tbody', null, rows)));
  };
  render();
  const off = ctx.store ? ctx.store.onChange((ev) => { if (ev.type !== 'update') render(); }) : null;
  return { unmount() { off && off(); } };
}
