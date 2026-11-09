// sample-compare: 후보 vs 슬롯 샘플 비교 화면 (data-schema §5.5 4). promote-sample 대화상자가 renderCompare를 재사용한다.
// 조건이 match가 아니면 우열 기호를 그리지 않는다(조건 상이/조건 불명 배지만).

import { h, checkProps, clear, infoBox, warnBox, errorBox, badge, fmt } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, sourceBadges } from './_util.js';
import { resolveSources, stepTime } from '../sources.js';

export const accepts = ['candidate', 'targets', 'metrics', 'weights'];

const COND = { match: ['조건 일치', 'b-ok'], differs: ['조건 상이', 'b-bad'], unknown: ['조건 불명', 'b-unknown'] };
const DEF_METRICS = ['tr', 'tp', 'po', 'ts', 'ess', 'iae', 'itae', 'u_rms', 'u_tv', 'u_sat_ratio', 'lost_ratio'];

/** 해석된 출처 → samples.compare가 읽는 객체 */
export function cmpObj(s) { return s.entry ? { entry: s.entry, meta: s.meta } : { meta: s.meta }; }

/** 슬롯 → [대표, 같은 슬롯 나머지(최대 n)] 해석 */
export async function slotTargets(ctx, slotId, n = 6) {
  const res = await ctx.samples.resolveSlot(slotId);
  if (res.empty || res.error) return { list: [], res };
  const first = (await resolveSources(ctx, [`slot:${slotId}`]))[0];
  const others = [];
  for (const c of (res.candidates || []).slice(0, n)) {
    if (c.id === first.id) continue;
    const r = (await resolveSources(ctx, [`sample:${c.id}`]))[0];
    if (r && r.rows) others.push(r);
  }
  return { list: [first, ...others], res };
}

/**
 * 비교 화면 그리기. cand, targets: resolveSources 결과 항목. 반환 comparison(samples.compare 결과).
 */
export function renderCompare(el, { cand, targets, metrics = DEF_METRICS, weights }, ctx) {
  clear(el);
  if (!cand || !cand.rows) { el.appendChild(infoBox('비교할 후보가 없습니다.')); return null; }
  if (!targets.length) {
    el.appendChild(infoBox('비교 대상(슬롯 샘플)이 없습니다. 첫 샘플이 됩니다.'));
  }
  const cmp = ctx.samples.compare(cmpObj(cand), targets.map(cmpObj), { weights, metrics });
  // 그래프: 후보·대표 굵게, 나머지 옅게. 스텝 시작 정렬
  const plot = new Plot(el, { height: 220, xLabel: '스텝 후 시간 (s)', yLabel: '측정 거리(표면) (mm)' });
  const ser = [];
  const add = (s, i, strong) => {
    const t0 = stepTime(s.rows);
    const st = styleOf(i);
    const yk = s.rows.some((r) => Number.isFinite(r.y_filt_mm)) ? 'y_filt_mm' : 'y_mm';
    ser.push({ label: `${i === 0 ? '후보: ' : i === 1 ? '대표: ' : ''}${s.label}`, x: s.rows.map((r) => r.t_s - t0), y: s.rows.map((r) => r[yk]), color: st.color, dash: st.dash, width: strong ? 2.4 : 1.2, alpha: strong ? 1 : 0.35 });
    if (i === 0) ser.push({ label: '설정값', x: s.rows.map((r) => r.t_s - t0), y: s.rows.map((r) => r.ref_mm), color: '#444', dash: [2, 3], width: 1, step: true });
  };
  add(cand, 0, true);
  targets.forEach((t, i) => add(t, i + 1, i === 0));
  plot.setSeries(ser);
  // 조건 검사
  const condBox = h('div');
  for (const t of cmp.targets) {
    const [lab, cls] = COND[t.condition.result];
    const src = targets.find((x) => x.id === t.id) || {};
    condBox.appendChild(h('div', { class: 'row', style: { margin: '.1rem 0' } }, h('b', null, src.label || t.id), ...sourceBadges(src), badge(lab, cls),
      t.condition.result !== 'match' ? h('span', { class: 'muted' }, `다른/미상 항목: ${t.condition.labels.join(', ')} — 우열 판단 보류`) : null));
  }
  el.append(h('h4', null, '조건 검사'), h('div', { class: 'row' }, h('b', null, '후보 '), cand.label, ...sourceBadges(cand)), condBox);
  // 지표 표
  const lab = (k) => (ctx.metrics.METRIC_INFO && ctx.metrics.METRIC_INFO[k] ? `${ctx.metrics.METRIC_INFO[k].label}${ctx.metrics.METRIC_INFO[k].unit ? ` (${ctx.metrics.METRIC_INFO[k].unit})` : ''}` : k);
  const symCls = { '▲': 'sym-up', '▼': 'sym-down', '=': 'sym-eq' };
  const val = (k, v) => (v == null ? '–' : /ratio/.test(k) ? `${(v * 100).toFixed(1)}%` : fmt(v, 3));
  const head1 = ['지표(작을수록 좋음)', '후보', ...cmp.targets.map((t) => (targets.find((x) => x.id === t.id) || {}).label || t.id)];
  const body = metrics.map((k) => h('tr', null, h('td', null, lab(k)), h('td', { class: 'numc' }, val(k, cmp.targets[0] ? cmp.targets[0].metrics[k].cand : null) ?? '–'),
    ...cmp.targets.map((t) => { const m = t.metrics[k]; return h('td', { class: 'numc' }, val(k, m.target), m.sym ? h('span', { class: symCls[m.sym] }, ` ${m.sym}`) : null, m.diff_pct != null ? h('span', { class: 'muted' }, ` ${m.diff_pct > 0 ? '+' : ''}${m.diff_pct.toFixed(0)}%`) : null); })));
  if (!cmp.targets.length) {
    const s = (cand.meta.metrics && cand.meta.metrics.summary) || {};
    el.append(h('h4', null, '후보 지표'), h('table', { class: 'tbl' }, h('tbody', null, metrics.map((k) => h('tr', null, h('td', null, lab(k)), h('td', { class: 'numc' }, val(k, s[k])))))));
  } else {
    el.append(h('h4', null, '지표 비교'), h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, head1.map((x) => h('th', null, x)))), h('tbody', null, body))),
      h('div', { class: 'muted', style: { fontSize: '.85rem' } }, '▲ 후보가 좋음, ▼ 후보가 나쁨, = 차이 1% 미만. 차이 % = (후보 − 대상)/|대상|. 조건이 다르면 기호 없이 값만 참고로 보인다.'));
  }
  // 점수표
  const sc = cmp.score;
  if (sc && sc.rows.length) {
    const ws = sc.weights_used || {};
    el.append(h('h4', null, '종합 점수(낮을수록 좋음)'),
      h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `가중치 ${Object.entries(ws).filter(([, w]) => w > 0).map(([k, w]) => `${k} ${w.toFixed(2)}`).join(', ')}${sc.dropped.length ? ` · 뺀 항목(값 없음): ${sc.dropped.join(', ')}` : ''} · min-max 정규화`),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['순위', '항목', '자격', 'ITAE', 'ts', 'P.O.', 'u_tv', '정규화(ITAE/ts/PO/u_tv)', '점수'].map((x) => h('th', null, x)))),
        h('tbody', null, sc.rows.map((r) => h('tr', { style: r.id === cmp.candidate ? { fontWeight: 700 } : null },
          h('td', { class: 'numc' }, r.rank ?? '–'), h('td', null, r.id === cmp.candidate ? `후보 (${cand.label})` : ((targets.find((x) => x.id === r.id) || {}).label || r.id)),
          h('td', null, r.eligible === true ? '적격' : r.eligible === false ? `제외: ${r.eligible_note}` : `확인 불가: ${r.eligible_note}`),
          h('td', { class: 'numc' }, fmt(r.raw.itae, 0)), h('td', { class: 'numc' }, r.ts_unsettled ? '미정착' : fmt(r.raw.ts, 2)), h('td', { class: 'numc' }, fmt(r.raw.po, 1)), h('td', { class: 'numc' }, fmt(r.raw.u_tv, 1)),
          h('td', { class: 'numc' }, ['itae', 'ts', 'po', 'u_tv'].map((k) => (r.norm[k] == null ? '–' : r.norm[k].toFixed(2))).join(' / ')),
          h('td', { class: 'numc' }, r.score == null ? '–' : r.score.toFixed(3))))))));
    if (sc.rows.some((r) => r.eligible === false && r.eligible_note && r.eligible_note.startsWith('다른 묶음'))) el.appendChild(infoBox('제어기나 설정값 프로파일이 다른 항목은 점수 묶음에서 빠집니다.'));
  }
  if (cmp.tradeoff_text) el.appendChild(warnBox(`상충: ${cmp.tradeoff_text}`));
  if (cmp.summary) el.appendChild(h('p', null, h('b', null, '요약: '), cmp.summary));
  el._plot = plot;
  return cmp;
}

/**
 * targets:"slot" 의 슬롯 고르기 (chapter-format §6.6, 1.1.0):
 * 챕터 promote_slots 중 후보에 맞는 슬롯(samples.suggestSlots) → promote_slots[0] → suggestSlots[0] 순.
 */
export function pickTargetSlot(ctx, candMeta) {
  const promo = (ctx.chapter && ctx.chapter.promote_slots) || [];
  const sug = ctx.samples && ctx.samples.suggestSlots && candMeta ? ctx.samples.suggestSlots(candMeta).map((x) => x.id) : [];
  return promo.find((id) => sug.includes(id)) || promo[0] || sug[0] || null;
}

/** candidate:"chapter" → 이 챕터 내 세션(제어, 최신 순). 검증 묶음은 회차별로 그대로 나온다 */
export async function chapterCandidates(ctx) {
  if (!ctx.chapter || !ctx.store) return [];
  const l = await ctx.store.sessions.list({ chapter_id: ctx.chapter.id, kind: 'control' });
  return l.filter((m) => m.complete !== false || (m.stats && m.stats.n > 5));
}

export function mount(el, props, ctx) {
  checkProps(el, 'sample-compare', props, accepts);
  el.appendChild(head('샘플 비교'));
  const pickRow = h('div', { class: 'row' });
  const box = h('div');
  el.append(pickRow, box);
  let chosen = null; // candidate:"chapter"일 때 고른 세션 id
  const draw = async () => {
    try {
      let candRef = props.candidate;
      if (!candRef || candRef === 'chapter') {
        const l = await chapterCandidates(ctx);
        clear(pickRow);
        if (!l.length) { clear(box).appendChild(infoBox('비교할 내 세션이 아직 없습니다. 이 챕터 실습을 먼저 하세요(후보 = 이 챕터에서 저장한 세션).')); return; }
        if (!chosen || !l.some((m) => m.session_id === chosen)) chosen = l[0].session_id;
        pickRow.append(h('label', null, '후보(이 챕터 내 세션) ', h('select', { onchange: (e) => { chosen = e.target.value; draw(); } },
          l.map((m) => h('option', { value: m.session_id, selected: m.session_id === chosen }, `${m.title || m.session_id}${m.run_group ? ` · 묶음 ${m.run_group.label || m.run_group.id} ${m.run_group.index}회` : ''} (${m.session_id})`)))));
        candRef = `session:${chosen}`;
      }
      const [cand] = await resolveSources(ctx, [candRef]);
      if (!cand || cand.empty || (!cand.error && !cand.rows)) { clear(box).appendChild(infoBox(`비교할 후보가 아직 없습니다${cand && cand.message ? `: ${cand.message}` : ''}`)); return; }
      if (cand.error) { clear(box).appendChild(errorBox(cand.error)); return; }
      let targets = [];
      const notes = [];
      if (!props.targets || props.targets === 'slot') {
        const slotId = pickTargetSlot(ctx, cand.meta);
        if (slotId) {
          targets = (await slotTargets(ctx, slotId)).list;
          notes.push(`비교 대상 = 슬롯 ${slotId}의 대표 샘플 + 같은 슬롯 후보 ${Math.max(0, targets.length - 1)}개`);
        } else notes.push('후보에 맞는 슬롯을 찾지 못했습니다.');
      } else {
        const all = await resolveSources(ctx, props.targets);
        for (const s of all) if (!s.rows) notes.push(`${s.label || s.ref}: ${s.message || s.error || '없음'}`);
        targets = all.filter((s) => s.rows);
      }
      targets = targets.filter((t) => t.id !== cand.id);
      renderCompare(box, { cand, targets, metrics: props.metrics || DEF_METRICS, weights: props.weights }, ctx);
      for (const n of notes) box.prepend(infoBox(n));
    } catch (e) { clear(box).appendChild(errorBox(e.message)); }
  };
  draw();
  const offs = [];
  if (ctx.samples && ctx.samples.onChange) offs.push(ctx.samples.onChange(() => draw()));
  if (ctx.store && ctx.store.onChange) offs.push(ctx.store.onChange((ev) => { if (ev && (ev.type === 'finish' || ev.type === 'delete')) draw(); }));
  return { unmount() { offs.forEach((f) => f()); }, update() { draw(); } };
}
