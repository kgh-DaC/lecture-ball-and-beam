// sample-browser: 샘플 목록(계층·출처·조건 불명 배지, 슬롯별 점수 순위), 미리보기, 내 샘플 관리·배포 내보내기, 내 세션 올리기.

import { h, checkProps, clear, infoBox, warnBox, errorBox, fmt, badge, download, toast } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, sourceBadges } from './_util.js';
import { describeProfile } from '../../store/profile.js';
import { stepTime } from '../sources.js';

export const accepts = ['filter', 'show_score', 'allow_my_samples', 'default'];

export function mount(el, props, ctx) {
  checkProps(el, 'sample-browser', props, accepts);
  const S = ctx.samples;
  if (!S) { el.appendChild(errorBox('샘플 저장소가 없습니다')); return {}; }
  const filter = { ...(props.filter || {}) };
  el.appendChild(head('샘플 데이터', h('span', { class: 'muted' }, '슬롯 우선순위: 내 실측 > 실측 > 내 시뮬레이션 > 시뮬레이션')));
  const ctl = h('div', { class: 'row' });
  const msgs = h('div');
  const tbl = h('div', { class: 'tbl-wrap' });
  const prev = h('div');
  const mine = h('div');
  el.append(ctl, msgs, tbl, prev, mine);
  let plot = null;

  const preview = async (id) => {
    clear(prev);
    if (plot) { plot.destroy(); plot = null; }
    try {
      const full = await S.get(id);
      const e = full.entry;
      const src = { tier: e.tier, provenance: e.provenance, badges: e.badges, conditionsUnknown: e.conditions && e.conditions.status === 'unknown' };
      prev.append(h('h4', null, e.title || id, ' ', ...sourceBadges(src)));
      if (e.kind === 'id') {
        plot = new Plot(prev, { height: 200, xLabel: '시간 (s)', yLabel: '각도 (°)' });
        plot.setSeries(['cmd_cdeg', 'theta_cdeg'].map((k, i) => ({ label: k, x: full.rows.map((r) => r.t_s), y: full.rows.map((r) => r[k] / 100), ...styleOf(i), step: k === 'cmd_cdeg' })));
      } else {
        const t0 = stepTime(full.rows);
        plot = new Plot(prev, { height: 200, xLabel: '스텝 후 시간 (s)', yLabel: '위치 (mm)' });
        plot.setSeries(['y_mm', 'y_filt_mm', 'ref_mm'].filter((k) => full.rows.some((r) => Number.isFinite(r[k]))).map((k, i) => ({ label: k, x: full.rows.map((r) => r.t_s - t0), y: full.rows.map((r) => r[k]), ...styleOf(i), step: k === 'ref_mm', alpha: k === 'y_mm' ? 0.6 : 1 })));
        const m = (full.meta.metrics && full.meta.metrics.summary) || {};
        prev.appendChild(h('div', { class: 'readout' }, ['tr', 'po', 'ts', 'ess', 'itae', 'u_tv'].map((k) => h('span', { class: 'kv' }, `${k} `, h('b', null, k === 'ts' && m.ts == null && m.computable !== false ? '미정착' : fmt(m[k], 3))))));
        if (m.computable === false) prev.appendChild(infoBox(`지표 계산 불가: ${(ctx.metrics.REASON_LABEL || {})[m.reason] || m.reason}`));
      }
      const c = e.conditions || {};
      prev.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } },
        `제어기 ${e.controller || '–'} ${e.params ? JSON.stringify(e.params) : ''} · ${describeProfile(e.setpoint_profile)} · 모델 ${e.model_kind || '–'} · 서보 ${c.servo_model || '–'} · 주기 ${c.period_assumed ? `${c.assumed_period_ms} ms(추정)` : `${c.sample_period_ms ?? '–'} ms`}${c.notes ? ` · ${c.notes}` : ''}`));
      if (e.promotion) prev.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `승격 기록: ${e.promotion.decision} → ${e.promotion.slot || '–'} (${e.promoted_at}) ${e.promotion.comparison_summary || ''}`));
      if (e.origin === 'my') prev.appendChild(h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => download(`sample_${id}.zip`, await S.exportBundle(id), 'application/zip') }, '배포용 내보내기'),
        h('button', { class: 'btn danger', onclick: async () => { if (typeof confirm === 'function' && !confirm(`${id} 을(를) 내 샘플에서 지울까요? 원본 세션은 남습니다.`)) return; await S.removeMy(id); toast('지웠습니다', 'ok'); clear(prev); } }, '내 샘플에서 삭제')));
    } catch (e) { prev.appendChild(errorBox(e.message)); }
  };

  const render = async () => {
    clear(msgs); clear(tbl);
    await S.load();
    if (S.loadError) msgs.appendChild(warnBox(S.loadError));
    const slots = S.slots();
    // 컨트롤
    clear(ctl).append(
      h('label', null, '슬롯 ', h('select', { onchange: (e) => { filter.slot = e.target.value || undefined; render(); } }, h('option', { value: '' }, '전체'), slots.map((s) => h('option', { value: s.id, selected: s.id === filter.slot }, `${s.label || s.id}`)))),
      h('label', null, ' 출처 ', h('select', { onchange: (e) => { filter.provenance = e.target.value || undefined; render(); } }, [['', '전체'], ['real', '실측'], ['simulated', '시뮬레이션']].map(([v, l]) => h('option', { value: v, selected: (filter.provenance || '') === v }, l)))));
    const list = await S.list(filter);
    // 슬롯별 점수(같은 계층 안 순위 계산과 같은 best.score)
    const rank = new Map();
    if (props.show_score !== false) {
      for (const sl of filter.slot ? slots.filter((s) => s.id === filter.slot) : slots) {
        const r = await S.resolveSlot(sl.id);
        const rows = (r.score && r.score.rows) || [];
        for (const row of rows) { if (!rank.has(row.id)) rank.set(row.id, []); rank.get(row.id).push(`${sl.id}: ${row.rank ?? '–'}위${row.score != null ? ` (${row.score.toFixed(2)})` : ''}${r.entry && r.entry.id === row.id ? ' ★대표' : ''}`); }
        if (r.entry) { if (!rank.has(r.entry.id)) rank.set(r.entry.id, []); if (!rank.get(r.entry.id).some((x) => x.includes('★'))) rank.get(r.entry.id).push(`${sl.id} ★대표`); }
      }
    }
    if (!list.length) { tbl.appendChild(infoBox('조건에 맞는 샘플이 없습니다.')); }
    else tbl.appendChild(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['샘플', '배지', '제어기', '프로파일', '슬롯', ...(props.show_score !== false ? ['슬롯 순위(점수)'] : []), ''].map((x) => h('th', null, x)))),
      h('tbody', null, list.map((e) => h('tr', null,
        h('td', null, e.title || e.id, h('div', { class: 'muted', style: { fontSize: '.75rem' } }, e.id)),
        h('td', null, ...sourceBadges({ tier: e.tier, provenance: e.provenance, badges: e.badges, conditionsUnknown: e.conditions && e.conditions.status === 'unknown' })),
        h('td', null, e.controller || (e.kind === 'id' ? '식별' : '–')), h('td', null, describeProfile(e.setpoint_profile)), h('td', null, (e.slots || []).join(', ')),
        ...(props.show_score !== false ? [h('td', null, (rank.get(e.id) || []).join(' / ') || '–')] : []),
        h('td', null, h('button', { class: 'btn small', onclick: () => preview(e.id) }, '보기')))))));
    if (props.default && !prev.firstChild) {
      const d = typeof props.default === 'object' ? props.default : String(props.default);
      if (d.slot || String(d).startsWith('slot:')) { const r = await S.resolveSlot(d.slot || String(d).slice(5)); if (r.entry) preview(r.entry.id); }
      else preview(String(d).replace(/^sample:/, ''));
    }
    // 내 세션 올리기
    clear(mine);
    if (props.allow_my_samples !== false && ctx.store) {
      const ss = (await ctx.store.sessions.list({ kind: 'control' })).filter((m) => !m.promoted_as).slice(0, 15);
      mine.append(h('h4', null, '내 세션을 샘플로 올리기'));
      if (!ss.length) mine.appendChild(h('p', { class: 'muted' }, '승격하지 않은 내 세션이 없습니다.'));
      else mine.appendChild(h('table', { class: 'tbl' }, h('tbody', null, ss.map((m) => h('tr', null,
        h('td', null, `${(m.created_at || '').slice(0, 16)} ${m.title || m.session_id}`), h('td', null, badge(m.provenance === 'real' ? '실측' : '시뮬레이션', m.provenance === 'real' ? 'b-real' : 'b-sim')),
        h('td', null, m.controller ? m.controller.id : '–'),
        h('td', null, h('button', { class: 'btn small', onclick: () => ctx.ui.openPromote(m.session_id, {}) }, '승격…')))))));
    }
  };
  render().catch((e) => msgs.appendChild(errorBox(e.message)));
  const offs = [];
  offs.push(S.onChange(() => render().catch(() => {})));
  return { unmount() { offs.forEach((f) => f()); plot && plot.destroy(); } };
}
