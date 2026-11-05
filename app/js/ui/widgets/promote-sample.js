// promote-sample: 승격 대화상자 (data-schema §5.5). 슬롯·챕터 선택 → sample-compare 내장 → 승격(교체)/별도 추가/보류.
// live-plot·validation-run·sample-browser·#/sessions의 버튼이 openDialog를 연다(main.js ctx.ui.openPromote).
// 가상 장치 세션은 provenance=simulated로 남고 실측보다 우선하지 않는다(samples.js가 강제).

import { h, checkProps, clear, modal, infoBox, errorBox, warnBox, badge, toast } from '../dom.js';
import { head, sourceBadges } from './_util.js';
import { resolveSources } from '../sources.js';
import { renderCompare, slotTargets } from './sample-compare.js';

export const accepts = ['session', 'slots', 'allow'];

const DECISION = { replace: '승격(슬롯 대표로 교체)', add: '별도 샘플로 추가', hold: '보류(기록만)' };

/**
 * 대화상자. opts: { slots?, allow?, chapter_ids?, metrics_override?, run_group_mode?, title?, onDone? }
 * 반환 Promise<entry|null> (닫히면 null)
 */
export function openDialog(sessionId, opts = {}, ctx) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); opts.onDone && opts.onDone(v); } };
    const body = h('div');
    const m = modal('샘플로 승격', body, { wide: true, onClose: () => done(null) });
    build(body, sessionId, opts, ctx, (v) => { done(v); m.close(); }).catch((e) => { clear(body).appendChild(errorBox(e.message)); });
  });
}

async function build(body, sessionId, opts, ctx, finish) {
  clear(body).appendChild(h('p', { class: 'muted' }, '불러오는 중…'));
  if (!ctx.samples || !ctx.store) throw new Error('샘플·세션 저장소가 없습니다');
  await ctx.samples.load();
  const [cand] = await resolveSources(ctx, [`session:${sessionId}`]);
  if (!cand || !cand.rows) throw new Error(`세션 ${sessionId} 을 불러오지 못했습니다`);
  const meta = cand.meta;
  clear(body);
  if (meta.kind === 'id') { body.appendChild(infoBox('식별 기록 세션은 07장 식별 도구에서 슬롯(servo-step)으로 승격합니다.')); }
  // 1. 후보 정보
  body.appendChild(h('div', { class: 'row' }, h('b', null, '후보 세션: '), meta.title || sessionId, ...sourceBadges(cand), meta.complete === false ? badge('중단된 세션', 'b-bad') : null));
  if (meta.provenance === 'simulated') body.appendChild(infoBox('가상 장치(시뮬레이션) 세션입니다. 승격해도 "내 시뮬레이션" 계층으로 들어가 실측 샘플보다 앞서지 않습니다. 그래프에는 항상 시뮬레이션 배지가 붙습니다.'));
  if (opts.metrics_override) body.appendChild(infoBox(`묶음 승격: ${opts.run_group_mode === 'mean' ? `평균 지표(${opts.metrics_override.aggregated_n}회)` : '대표 회차'}로 기록합니다. 그래프는 대표 회차입니다.`));
  // 2. 슬롯·챕터
  const allSlots = ctx.samples.slots();
  const suggested = ctx.samples.suggestSlots(meta).map((s) => s.id);
  const wanted = opts.slots && opts.slots.length ? opts.slots : (ctx.chapter && ctx.chapter.promote_slots && ctx.chapter.promote_slots.length ? ctx.chapter.promote_slots : suggested);
  const slotIds = [...new Set([...wanted, ...suggested])];
  const chosen = new Set(wanted.slice(0, 1));
  const slotBox = h('div');
  const renderSlots = () => {
    clear(slotBox);
    if (!slotIds.length) slotBox.appendChild(infoBox('이 세션의 제어기·프로파일과 맞는 슬롯이 없습니다. "별도 샘플로 추가"로 챕터에만 연결할 수 있습니다.'));
    for (const id of slotIds) {
      const def = allSlots.find((s) => s.id === id);
      const fits = suggested.includes(id);
      slotBox.appendChild(h('label', { style: { display: 'block' } }, h('input', { type: 'checkbox', checked: chosen.has(id), onchange: (e) => { if (e.target.checked) chosen.add(id); else chosen.delete(id); refreshCompare(); } }),
        ` ${def ? def.label || id : id} (${id})`, !def ? badge('인덱스에 없는 슬롯', 'b-unknown') : null, def && !fits ? badge('조건 상이', 'b-bad') : null));
    }
  };
  renderSlots();
  const chIds = new Set([...(opts.chapter_ids || []), ...(ctx.chapter ? [ctx.chapter.id] : meta.chapter_id ? [meta.chapter_id] : [])]);
  const chInput = h('input', { type: 'text', value: [...chIds].join(', '), class: 'num-wide', style: { width: '20rem' } });
  const titleInput = h('input', { type: 'text', value: opts.title || meta.title || '', style: { width: '20rem' } });
  body.append(h('h4', null, '1. 슬롯 선택'), slotBox,
    h('div', { class: 'row' }, h('label', null, '챕터 연결(쉼표) ', chInput)),
    h('div', { class: 'row' }, h('label', null, '샘플 제목 ', titleInput)));
  // 3. 비교
  const cmpBox = h('div');
  body.append(h('h4', null, '2. 비교'), cmpBox);
  let comparison = null, targetsNow = [];
  const refreshCompare = async () => {
    clear(cmpBox).appendChild(h('p', { class: 'muted' }, '비교 중…'));
    const slot = [...chosen][0];
    targetsNow = slot ? (await slotTargets(ctx, slot)).list.filter((t) => t.id !== cand.id && t.id !== `my-${sessionId}`) : [];
    const c2 = opts.metrics_override ? { ...cand, meta: { ...meta, metrics: { ...(meta.metrics || {}), summary: opts.metrics_override } } } : cand;
    comparison = renderCompare(cmpBox, { cand: c2, targets: targetsNow }, ctx);
  };
  await refreshCompare();
  // 4. 결정
  const allow = opts.allow || ['replace', 'add', 'hold'];
  const res = h('div');
  const decide = async (decision) => {
    clear(res);
    try {
      const slots = [...chosen];
      if (decision === 'replace' && !slots.length) throw new Error('교체하려면 슬롯을 하나 이상 고르세요.');
      const entry = await ctx.samples.promote(sessionId, {
        decision, slots, chapter_ids: chInput.value.split(/[,\s]+/).filter(Boolean), comparison, title: titleInput.value,
        metrics_override: opts.metrics_override, run_group_mode: opts.run_group_mode,
        replaced_sample_id: decision === 'replace' ? (targetsNow[0] ? targetsNow[0].id : null) : undefined,
      });
      if (entry && ctx.progress && meta.chapter_id) await ctx.progress.set(meta.chapter_id, { promoted_samples: [entry.id] });
      toast(decision === 'hold' ? '보류로 기록했습니다' : `샘플 ${entry.id} 로 ${decision === 'replace' ? '승격' : '추가'}했습니다`, 'ok');
      finish(entry);
    } catch (e) { res.appendChild(errorBox(e.message)); }
  };
  body.append(h('h4', null, '3. 결정'),
    h('div', { class: 'row' }, allow.map((d) => h('button', { class: `btn ${d === 'replace' ? 'primary' : ''}`, onclick: () => decide(d) }, DECISION[d] || d))),
    h('div', { class: 'muted', style: { fontSize: '.85rem' } }, '교체: 슬롯 대표가 됨(기존 샘플은 남음). 추가: 슬롯 후보로만. 보류: 세션에 검토 기록만 남김. 결정과 비교 요약은 샘플의 promotion 기록에 남습니다.'),
    res);
  if (comparison && comparison.targets.some((t) => t.condition.result !== 'match')) body.insertBefore(warnBox('일부 비교 대상과 조건이 달라 우열을 판단하지 않았습니다. 조건 검사 결과를 확인하고 결정하세요.'), res);
}

export function mount(el, props, ctx) {
  checkProps(el, 'promote-sample', props, accepts);
  el.appendChild(head('샘플로 승격', h('span', { class: 'muted' }, '내 세션을 교재 샘플 슬롯에 올립니다')));
  const row = h('div', { class: 'row' });
  el.appendChild(row);
  const render = async () => {
    clear(row);
    let sid = props.session ? String(props.session).replace(/^session:/, '') : null;
    let list = [];
    if (!sid && ctx.chapter && ctx.store) list = (await ctx.store.sessions.list({ chapter_id: ctx.chapter.id })).filter((m) => (m.kind || 'control') !== 'id');
    if (!sid && !list.length) { row.appendChild(h('span', { class: 'muted' }, '이 챕터에서 저장한 세션이 없습니다. 실습 후 다시 오세요.')); return; }
    let pick = sid || list[0].session_id;
    if (!sid) row.appendChild(h('select', { onchange: (e) => { pick = e.target.value; } }, list.map((m) => h('option', { value: m.session_id }, `${(m.created_at || '').slice(5, 16)} ${m.title || m.session_id}${m.provenance === 'simulated' ? ' [시뮬레이션]' : ''}${m.promoted_as ? ' (승격됨)' : ''}`))));
    row.appendChild(h('button', { class: 'btn primary', onclick: () => openDialog(pick, { slots: props.slots, allow: props.allow }, ctx) }, '승격 대화상자 열기'));
  };
  render();
  const off = ctx.store && ctx.store.onChange ? ctx.store.onChange((ev) => { if (ev.type === 'finish' || ev.type === 'delete' || ev.type === 'save') render(); }) : null;
  return { unmount() { off && off(); } };
}
