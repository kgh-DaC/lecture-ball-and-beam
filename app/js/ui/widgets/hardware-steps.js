// hardware-steps: 하드웨어 점검 순서(체크리스트형 진행 표시). 단계별 완료 표시는 설정(localStorage 'ballbeam.hw_records'.steps)에,
// 위젯 판정은 각 위젯이 끝날 때 settings.hw.recordResult(위젯 이름, …)로 남긴 마지막 결과를 읽어 보여 준다(같은 저장 키, onChange 로 바로 갱신).
// 이전 단계가 끝나지 않았으면 경고만 한다(막지 않음).

import { h, checkProps, clear, badge, warnBox } from '../dom.js';
import { head } from './_util.js';

export const accepts = ['show_links'];
export const WIDGET_ID = 'hardware-steps';

/**
 * 점검 단계(순서 고정, 사용자 확정 2026-11-04). widget = 판정을 남기는 기록 키(위젯 이름, ④는 'signal-monitor:basic'). null = 수동 확인.
 * why = 왜 이 순서인지(카드에 한 줄). 정밀한 초음파 시험(⑥⑦)은 반드시 서보 90° 고정·조립·수평 찾기(⑤) 뒤에 온다.
 */
export const HW_STEPS = Object.freeze([
  { id: 'A1-power', group: 'A', no: '①', title: '서보 전원 5.0 V 확인', widget: null, how: '멀티미터로 서보 전원 단자 전압이 5.0 V(넘지 않음)인지, 서보 전원 GND 와 보드 GND 만 공통인지 확인합니다.', why: '포텐쇼미터 와이퍼 전압(A0)이 서보 전원을 따라가므로, 전원이 맞아야 다음 매핑 시험 값이 기록과 비교됩니다.' },
  { id: 'A2-pot', group: 'A', no: '②', title: '포텐쇼미터 매핑 시험', widget: 'pot-mapping-test', how: '혼만 달린 서보로 0/90/180° 를 오가며 A0 를 재고 기준값(60/330/598)과 비교합니다(펌웨어 1.2.0 벤치 모드).', why: '빔을 달기 전이라야 ±90° 를 안전하게 돌려 볼 수 있고, 여기서 A0 ↔ 각도 직선이 확인되어야 ③의 90° 판정을 믿을 수 있습니다.' },
  { id: 'A3-center', group: 'A', no: '③', title: '서보 90° 고정', widget: 'servo-center-assist', how: '서보를 90°(IDLE, trim 0)에 세우고 A0 가 기대값 근처인지 봅니다.', why: '서보가 정확히 90°에 있어야 혼을 수평 방향으로 끼웠을 때 trim 이 작게 남습니다.' },
  { id: 'ASM', group: 'ASM', no: '→', title: '기구부 조립(수평)', widget: null, how: '서보를 90°로 고정한 채(전원 유지) 혼을 빔이 수평이 되는 방향으로 끼우고 나사·링크를 조입니다.', why: '조립이 끝나야 빔 위에서 공 위치를 잴 수 있습니다.' },
  { id: 'B4-sensor', group: 'B', no: '④', title: '센서 연결 기본 확인', widget: 'signal-monitor:basic', how: '신호 확인(signal-monitor)에서 초음파 값이 들어오는지만 봅니다(수신 주기·거리 유실). "센서 연결 기본 확인 기록"을 누릅니다.', why: '다음 수평 찾기가 초음파로 공 굴림 속도를 재므로, 먼저 값이 들어오는지 확인합니다.' },
  { id: 'B5-level', group: 'B', no: '⑤', title: '수평 찾기(trim)', widget: 'level-trim', how: '수평계·스마트폰 수평계로 먼저 대략 맞추고, 공 굴림 속도로 미세 조정해 공이 흘러가지 않는 trim 을 저장합니다.', why: '수평이 맞아야 공이 한쪽으로 쏠리지 않아 ⑥⑦ 센서 시험이 공정합니다.' },
  { id: 'B6-sonar', group: 'B', no: '⑥', title: '실제 거리 vs 측정 거리 검증', widget: 'sensor-position-test', how: '줄자로 잰 실제 거리(100/150/200/250 mm, 공 표면 또는 중심까지 — 무엇까지 쟀는지 고름)에 공을 놓고 초음파 측정 거리와 비교합니다(오차·기울기·σ). 초음파는 공의 가까운 표면까지 재므로 공 중심 = 측정 + 반지름(26 mm).', why: '수평에서 공이 제자리에 머물러야 위치마다 정지 측정이 됩니다.' },
  { id: 'B7-signal', group: 'B', no: '⑦', title: '한 위치 안정성(정지 측정)', widget: 'signal-monitor', how: '공을 한 자리에 정지시켜 두고 신호 확인의 모든 판정(튄 값·필터 치우침·A0 안정성)을 기록합니다.', why: '위치 응답이 맞은 뒤에 한 점의 잡음·튐을 봐야 원인을 가를 수 있습니다.' },
  { id: 'B8-limit', group: 'B', no: '⑧', title: '각도 제한 찾기', widget: 'angle-limit-finder', how: '빔이 닿기 직전 각도를 기록해 lim 을 확정합니다.', why: '수평(trim)이 정해진 뒤라야 ± 양쪽 한계가 대칭으로 잡힙니다.' },
]);

/** 기록 키 → 단계 */
export const stepOfWidget = (w) => HW_STEPS.find((s) => s.widget === w) || null;

/**
 * 순서 경고(순수): 이 단계 앞의 단계 중 끝나지 않은 것(no 목록). 막지는 않는다 — 위젯이 경고 상자만 그린다.
 */
export function prereqMissing(records, widgetOrStepId) {
  if (!records) return [];
  const rows = stepStatus(records);
  const i = rows.findIndex((r) => r.id === widgetOrStepId || r.widget === widgetOrStepId);
  if (i < 0) return [];
  return rows.slice(0, i).filter((r) => !r.done).map((r) => `${r.no} ${r.title}`);
}

/** 위젯용 경고 문구(없으면 null) */
export function prereqText(records, widgetOrStepId) {
  const m = prereqMissing(records, widgetOrStepId);
  const s = HW_STEPS.find((r) => r.id === widgetOrStepId || r.widget === widgetOrStepId);
  return m.length ? `점검 순서 경고: 앞 단계(${m.join(', ')})가 아직 끝나지 않았습니다.${s ? ` ${s.why}` : ''} (막지는 않습니다)` : null;
}

const GROUP_LABEL = { A: 'A. 조립 전', ASM: '조립', B: 'B. 조립 후' };
const VERDICT = { pass: ['합격', 'b-ok'], fail: ['불합격', 'b-bad'], warn: ['주의', 'b-assumed'] };

/**
 * 단계 상태(순수). records: HwRecords. 반환 [{ ...step, result, done, done_at, verdict, warnPrev }]
 * done = 수동 완료 체크 또는 위젯 판정 합격. warnPrev = 앞 단계 중 완료 안 된 것이 있는데 이 단계가 시작(완료/결과 있음)됨
 */
export function stepStatus(records) {
  let prevOpen = [];
  return HW_STEPS.map((s) => {
    const result = s.widget ? records.lastResult(s.widget) : null;
    const st = records.step(s.id);
    const done = !!(st && st.done) || !!(result && result.verdict === 'pass');
    const started = done || !!result;
    const row = { ...s, result, done, done_at: st && st.done ? st.at : result && result.verdict === 'pass' ? result.at : null, verdict: result ? result.verdict : 'none', warnPrev: started && prevOpen.length ? prevOpen.slice() : [] };
    if (!done) prevOpen.push(s.no);
    return row;
  });
}

/** ⑤ 수평 카드에 붙는 수평 실측 기록 한 줄(서보각 → trim, 출처 배지). 기록 수정은 #/settings 보정 기록 표 */
function levelLine(lv) {
  if (!lv || lv.level_servo_deg == null) return null;
  const meas = lv.provenance === 'measured';
  return h('div', { class: 'level-record', style: { fontSize: '.8rem' } },
    badge(meas ? '실측' : '시뮬레이션', meas ? 'b-real' : 'b-sim'), ' ',
    `수평 기록${lv.bundle ? '(사용자 제공)' : ''} ${lv.date || ''}: 수평 서보각 ${lv.level_servo_deg}° → trim ${lv.trim_cdeg} cdeg (dir ${lv.dir}) · ${lv.method || ''}`,
    lv.edited ? h('span', { class: 'muted' }, ' · 수정됨') : null,
    h('span', { class: 'muted' }, ' · 수정은 '), h('a', { href: '#/settings' }, '보정 기록 표'));
}

const DV_VERD = { pass: ['합격', 'b-ok'], fail: ['불합격', 'b-bad'], warn: ['주의', 'b-assumed'] };
/** ⑥ 거리 검증 카드에 붙는 마지막 거리 검증 기록 한 줄(판정·기준 방식·평균 오차·기울기). 기록 표는 #/settings */
function distLine(dv) {
  if (!dv) return h('div', { class: 'dist-verify-line muted', style: { fontSize: '.8rem' } }, '거리 검증 기록 없음 — 이 단계 위젯(sensor-position-test)에서 "거리 검증 기록에 저장"을 누르세요.');
  const v = DV_VERD[dv.verdict] || ['–', 'b-unknown'];
  const meas = dv.provenance === 'measured';
  return h('div', { class: 'dist-verify-line', style: { fontSize: '.8rem' } },
    h('b', null, '마지막 거리 검증 '), badge(v[0], v[1]), ' ', badge(meas ? '실측' : '시뮬레이션', meas ? 'b-real' : 'b-sim'), ' ',
    `${String(dv.created_at || dv.date || '').slice(0, 16).replace('T', ' ')} · ${dv.ref_basis === 'center' ? '중심' : '표면'} 기준 ${(dv.points || []).length}곳 · 평균 오차 ${Number.isFinite(dv.bias_mm) ? `${dv.bias_mm >= 0 ? '+' : ''}${dv.bias_mm.toFixed(1)}` : '–'} mm · 기울기 ${dv.fit && Number.isFinite(dv.fit.slope) ? dv.fit.slope.toFixed(3) : '–'}`,
    h('span', { class: 'muted' }, ' · 기록 표는 '), h('a', { href: '#/settings' }, '하드웨어 설정'));
}

export function mount(el, props, ctx) {
  checkProps(el, WIDGET_ID, props, accepts);
  const hw = ctx.settings.hw;
  el.appendChild(head('하드웨어 점검 순서', h('span', { class: 'muted' }, '조립 전 → 조립 → 조립 후')));
  const box = h('div');
  el.appendChild(box);
  const date = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');
  const paint = () => {
    const rows = stepStatus(hw);
    const nDone = rows.filter((r) => r.done).length;
    clear(box).append(h('div', { class: 'row' }, h('b', null, `진행 ${nDone} / ${rows.length}`), h('progress', { max: rows.length, value: nDone, style: { width: '200px' } }),
      h('button', { class: 'btn small', onclick: () => { if (typeof globalThis.confirm !== 'function' || globalThis.confirm('수동 완료 표시를 모두 지울까요? (위젯 판정 기록은 남습니다)')) hw.resetSteps(); } }, '완료 표시 지우기')));
    // 카드 목록(좁은 화면에서도 칸이 잘리지 않게 flex-wrap)
    let g = null;
    for (const r of rows) {
      if (r.group !== g) { g = r.group; box.appendChild(h('h5', { style: { margin: '.8rem 0 .3rem' } }, GROUP_LABEL[g])); }
      const v = VERDICT[r.verdict];
      const chk = h('input', { type: 'checkbox', checked: !!(hw.step(r.id) && hw.step(r.id).done), onchange: (e) => hw.setStep(r.id, e.target.checked) });
      box.appendChild(h('div', { class: 'hw-step', 'data-step': r.id, style: { border: '1px solid var(--line, #ddd)', borderRadius: '6px', padding: '.5rem .7rem', margin: '.35rem 0', borderLeft: `4px solid ${r.done ? 'var(--ok, #009E73)' : 'var(--line, #bbb)'}` } },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '.4rem .8rem', alignItems: 'center' } },
          badge(r.done ? '✓ 완료' : '○ 남음', r.done ? 'b-ok' : 'b-unknown'),
          h('b', { style: { flex: '1 1 12rem' } }, `${r.no} ${r.title}`),
          r.widget ? (v ? badge(v[0], v[1]) : badge('미실시', 'b-unknown')) : h('span', { class: 'muted' }, '수동 확인'),
          h('label', { style: { whiteSpace: 'nowrap' } }, chk, ' 완료')),
        h('div', { class: 'muted', style: { fontSize: '.85rem' } }, r.how),
        h('div', { style: { fontSize: '.85rem' } }, h('i', null, '왜 이 순서? '), r.why),
        r.result ? h('div', { class: 'muted', style: { fontSize: '.8rem' } }, `마지막 판정 ${date(r.result.at)}${r.result.provenance === 'simulated' ? ' [시뮬레이션]' : ''} · ${r.result.summary}`)
          : props.show_links !== false && r.widget ? h('div', { class: 'muted', style: { fontSize: '.8rem' } }, `위젯 ${r.widget.split(':')[0]}`) : null,
        r.widget === 'level-trim' && hw.activeLevel ? levelLine(hw.activeLevel()) : null,
        r.widget === 'sensor-position-test' && hw.lastDistVerify ? distLine(hw.lastDistVerify()) : null,
        r.done_at ? h('div', { class: 'muted', style: { fontSize: '.8rem' } }, `완료 ${date(r.done_at)}`) : null,
        r.warnPrev.length ? warnBox(`앞 단계(${r.warnPrev.join(' ')})가 아직 끝나지 않았습니다. 순서대로 하는 것이 안전합니다.`) : null));
    }
  };
  const off = hw.onChange(() => paint());
  paint();
  return { unmount() { off(); }, paint, status: () => stepStatus(hw) };
}
