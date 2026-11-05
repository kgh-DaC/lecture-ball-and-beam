// #/sessions: 내 세션 목록(챕터 필터), 여러 세션 겹쳐 비교·지표 표, ZIP 내보내기/불러오기, CSV, 삭제, 승격.
// 세션 파일 형식은 store/session.js(data-schema §2). 불러온 세션은 읽기 전용(재생·비교용).

import { h, clear, fmt, badge, provenanceBadge, download, pickFile, toast, infoBox, warnBox } from '../dom.js';
import { toFiles } from '../../store/session.js';
import * as overlay from '../widgets/overlay-plot.js';
import * as mtable from '../widgets/metrics-table.js';
import { simSourceLabel } from '../twin/lib.js';

export function mount(el, query, ctx) {
  const S = ctx.store.sessions;
  const ctl = h('div', { class: 'row' });
  const listBox = h('div', { class: 'tbl-wrap' });
  const cmpBox = h('div');
  el.append(h('p', { class: 'muted' }, '세션은 이 브라우저(IndexedDB)에만 저장됩니다. 다른 PC로 옮기려면 ZIP으로 내보내세요.'), ctl, listBox, cmpBox);
  const sel = new Set();
  let chapter = query.ch || '';
  let mounted = [];

  const render = async () => {
    const all = await S.list(chapter ? { chapter_id: chapter } : {});
    const chapters = [...new Set((await S.list()).map((m) => m.chapter_id).filter(Boolean))].sort();
    clear(ctl).append(
      h('label', null, '챕터 ', h('select', { onchange: (e) => { chapter = e.target.value; sel.clear(); render(); } }, h('option', { value: '' }, '전체'), chapters.map((c) => h('option', { value: c, selected: c === chapter }, c)))),
      h('button', { class: 'btn', disabled: !sel.size, onclick: () => compare() }, `선택 비교(${sel.size})`),
      h('button', { class: 'btn', disabled: !sel.size, onclick: async () => download(`sessions_${new Date().toISOString().slice(0, 10)}.zip`, await S.exportZip([...sel]), 'application/zip') }, 'ZIP 내보내기'),
      h('button', { class: 'btn', onclick: async () => {
        const files = await pickFile('.zip,.json,.csv', true);
        if (!files.length) return;
        const r = await S.importFiles(files);
        toast(`${r.imported.length}개 세션을 불러왔습니다${r.warnings.length ? ` (경고 ${r.warnings.length})` : ''}`, r.warnings.length ? 'warn' : 'ok');
        if (r.warnings.length) cmpBox.prepend(warnBox(r.warnings.join('\n')));
        render();
      } }, 'ZIP/파일 불러오기'),
      h('button', { class: 'btn danger', disabled: !sel.size, onclick: async () => {
        if (typeof confirm === 'function' && !confirm(`${sel.size}개 세션을 지울까요? 되돌릴 수 없습니다.`)) return;
        for (const id of sel) await S.remove(id);
        sel.clear(); render();
      } }, '삭제'));
    clear(listBox);
    if (!all.length) { listBox.appendChild(infoBox('저장된 세션이 없습니다.')); return; }
    listBox.appendChild(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['', '시각', '제목', '챕터', '종류', '출처', '제어기', 'P.O.', 'ts', 'ITAE', '상태', ''].map((x) => h('th', null, x)))),
      h('tbody', null, all.map((m) => {
        const s = (m.metrics && m.metrics.summary) || {};
        return h('tr', null,
          h('td', null, h('input', { type: 'checkbox', checked: sel.has(m.session_id), onchange: (e) => { if (e.target.checked) sel.add(m.session_id); else sel.delete(m.session_id); render(); } })),
          h('td', null, (m.created_at || '').slice(0, 16).replace('T', ' ')), h('td', null, m.title || m.session_id), h('td', null, m.chapter_id || '–'),
          h('td', null, m.kind || 'control', m.run_group ? badge(`묶음 ${m.run_group.index}/${m.run_group.n}`, 'b-unknown') : null),
          h('td', null, provenanceBadge(m.provenance), simSourceLabel(m) ? badge(simSourceLabel(m), 'b-sim') : null, m.read_only ? badge('불러옴', 'b-unknown') : null),
          h('td', null, m.controller ? m.controller.id : '–'),
          h('td', { class: 'numc' }, fmt(s.po, 1)), h('td', { class: 'numc' }, fmt(s.ts, 2)), h('td', { class: 'numc' }, fmt(s.itae, 0)),
          h('td', null, m.complete === false ? badge('중단', 'b-bad') : '완료', m.promoted_as ? badge('승격됨', 'b-ok') : null),
          h('td', null,
            h('button', { class: 'btn small', onclick: async () => { const x = await S.get(m.session_id); const f = toFiles(x.meta, x.rows); download(f.csvName, f.csv, 'text/csv'); download(f.jsonName, f.json, 'application/json'); } }, 'CSV/JSON'),
            (m.kind || 'control') === 'control' ? h('button', { class: 'btn small', onclick: () => ctx.ui.openPromote(m.session_id, {}) }, '승격…') : null));
      }))));
  };

  const compare = () => {
    mounted.forEach((x) => x.unmount && x.unmount()); mounted = [];
    clear(cmpBox);
    const refs = [...sel].map((id) => `session:${id}`);
    const a = h('div', { class: 'widget' }), b = h('div', { class: 'widget' });
    cmpBox.append(a, b);
    mounted.push(overlay.mount(a, { sources: refs, signals: ['y_mm', 'ref_mm'], align: 'step', show_metrics: false }, ctx));
    mounted.push(mtable.mount(b, { sources: refs }, ctx));
  };

  render();
  const off = ctx.store.onChange((ev) => { if (ev.type !== 'create') render(); });
  return { unmount() { off(); mounted.forEach((x) => x.unmount && x.unmount()); } };
}
