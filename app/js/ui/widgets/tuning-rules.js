// tuning-rules: Ku, Tu → 규칙별 PID 게인 표(autotune.applyRule) + 서보 포함 모델 예측 응답 (chapter-format §6.7, 11장).
// Ku, Tu 출처 우선순위: props(ku, tu_s) > bind 채널의 relay > relay-test 채널('__relay') > 기본 릴레이 시뮬레이션(40 s).
// 고른 규칙의 게인을 bind 채널 controller로 내보내고, "실습 패널에 보내기"로 controller-panel의 pid 초기값이 된다.

import { h, checkProps, clear, errorBox, infoBox, fmt, badge, toast } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, head, kv, simRun, sendToPractice, P1 } from './_util.js';
import { RELAY_CHANNEL, simulateRelay } from './relay-test.js';

export const accepts = ['rules', 'ku', 'tu_s', 'kd_stab'];

/** 규칙별 게인(순수). kd_stab은 릴레이 안쪽 미분 이득(applyRule이 kd에 더함) */
export function ruleTable(autotune, rules, ku, tu_s, kd_stab = 0) {
  return rules.map((r) => {
    try { return { rule: r, label: (autotune.RULES[r] || {}).label || r, params: { ...autotune.applyRule(r, ku, tu_s, { kd_stab }), n_filt: 8, d_on: 'measurement' } }; }
    catch (e) { return { rule: r, label: r, error: e.message }; }
  });
}

export function mount(el, props, ctx) {
  checkProps(el, 'tuning-rules', props, accepts);
  if (!need(el, ctx, ['autotune', 'simulate', 'plant'])) return {};
  const at = ctx.control.autotune;
  const rules = props.rules || ['zn', 'tl', 'no_overshoot'];
  const plant = (ctx.chapter && ctx.chapter.practice && ctx.chapter.practice.model) || 'ball+servo';
  el.appendChild(head('튜닝 규칙 표', h('span', { class: 'muted' }, 'kp = c·Ku, ki = kp/(a·Tu), kd = kp·b·Tu + kd_stab')));
  const src = h('div', { class: 'readout' });
  const tbl = h('div', { class: 'tbl-wrap' });
  const acts = h('div', { class: 'row' });
  const msg = h('div');
  el.append(src, msg, tbl, acts);
  const plot = new Plot(el, { height: props.height_px || 220, xLabel: '시간 (s)', yLabel: '측정 거리(표면) (mm)' });
  const bindCh = props.bind && ctx.bus ? ctx.bus.channel(props.bind) : null;
  const relayCh = ctx.bus ? ctx.bus.channel(RELAY_CHANNEL) : null;
  let fallback = null;
  let pick = 0;
  let table = [];

  const source = () => {
    if (props.ku != null && props.tu_s != null) return { ku: props.ku, tu_s: props.tu_s, kd_stab: props.kd_stab ?? 0, source: 'props' };
    const b = bindCh && bindCh.get().relay;
    if (b) return b;
    const r = relayCh && relayCh.get().relay;
    if (r) return r;
    if (!fallback) {
      const kd = props.kd_stab ?? 1.5;
      const s = simulateRelay(ctx, { h_deg: 2.9, eps_mm: 6, max_time_s: 40, kd_stab: kd, discard: 2, min_cycles: 5 }, plant);
      fallback = s.res.ok ? { ku: s.res.Ku, tu_s: s.res.Tu_s, kd_stab: kd, source: 'default-sim' } : { failed: s.res.reason };
    }
    return fallback;
  };

  const select = (i) => {
    pick = i;
    const row = table[i];
    if (row && row.params && bindCh) bindCh.set({ controller: { id: 'pid', params: row.params }, plant });
    draw(false);
  };

  const draw = (recompute = true) => {
    clear(msg);
    let s;
    try { s = source(); } catch (e) { clear(src); msg.appendChild(errorBox(`Ku, Tu를 구하지 못했습니다: ${e.message}`)); return; }
    clear(src);
    if (!s || s.failed) { msg.appendChild(infoBox('릴레이 실험 결과가 아직 없습니다. 위 릴레이 실험에서 분석에 성공하면 표가 채워집니다.')); return; }
    src.append(kv('Ku', s.ku, 'rad/m'), kv('Tu', s.tu_s, 's'), kv('kd_stab', s.kd_stab), badge({ props: '주어진 값', simulation: '릴레이 시뮬레이션', 'default-sim': '기본 릴레이 시뮬레이션(h 2.9°, 40 s)', device: '실제 장치', virtual: '가상 장치', sample: '샘플' }[s.source] || s.source, s.source === 'device' || s.source === 'sample' ? 'b-real' : 'b-sim'));
    if (recompute) {
      table = ruleTable(at, rules, s.ku, s.tu_s, s.kd_stab || 0);
      for (const r of table) {
        if (!r.params) continue;
        try { r.run = simRun(ctx, { controller: { id: 'pid', params: r.params }, plant, profile: P1 }); } catch (e) { r.simError = e.message; }
      }
    }
    const info = (ctx.metrics && ctx.metrics.METRIC_INFO) || {};
    const name = `tr-${Math.random().toString(36).slice(2, 7)}`;
    clear(tbl).appendChild(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['선택', '규칙', 'Kp', 'Ki', 'Kd', `P.O. (%)`, `ts (s)`, `ITAE (${(info.itae || {}).unit || ''})`, 'u_tv (°)'].map((x) => h('th', null, x)))),
      h('tbody', null, table.map((r, i) => {
        if (r.error) return h('tr', null, h('td', null, ''), h('td', null, r.label), h('td', { colspan: 7 }, `계산 불가: ${r.error}`));
        const m = (r.run && r.run.summary) || {};
        return h('tr', { style: i === pick ? { fontWeight: 700 } : null },
          h('td', null, h('input', { type: 'radio', name, checked: i === pick, onchange: () => select(i) })), h('td', null, r.label),
          h('td', { class: 'numc' }, fmt(r.params.kp)), h('td', { class: 'numc' }, fmt(r.params.ki)), h('td', { class: 'numc' }, fmt(r.params.kd)),
          h('td', { class: 'numc' }, fmt(m.po, 1)), h('td', { class: 'numc' }, m.ts == null ? '미정착' : fmt(m.ts, 2)), h('td', { class: 'numc' }, fmt(m.itae, 0)), h('td', { class: 'numc' }, fmt(m.u_tv, 1)));
      }))));
    tbl.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `응답 지표는 ${plant === 'ball+servo' ? '서보 포함' : '서보 무시'} 모델 시뮬레이션(잡음 없음, 150→200 mm 스텝)입니다 [시뮬레이션].`));
    const ser = [];
    table.forEach((r, i) => {
      if (!r.run) return;
      const st = styleOf(i);
      ser.push({ label: r.label, x: r.run.rows.map((q) => q.t_s), y: r.run.rows.map((q) => q.y_mm), color: st.color, dash: st.dash, width: i === pick ? 2.6 : 1.4, alpha: i === pick ? 1 : 0.6 });
    });
    const any = table.find((r) => r.run);
    if (any) ser.push({ label: '설정값', x: any.run.rows.map((q) => q.t_s), y: any.run.rows.map((q) => q.ref_mm), ...styleOf(6), width: 1, step: true });
    plot.setSeries(ser);
  };

  acts.append(h('button', { class: 'btn', onclick: () => {
    const r = table[pick];
    if (!r || !r.params) return;
    sendToPractice(ctx, { id: 'pid', params: r.params });
    toast(`${r.label} 게인을 실습 패널(PID)로 보냈습니다. 실습 패널에서 PID를 고르세요.`, 'ok');
  } }, '선택 게인을 실습 패널에 보내기'));

  draw();
  if (table[pick] && table[pick].params && bindCh) bindCh.set({ controller: { id: 'pid', params: table[pick].params }, plant });
  const offs = [];
  if (relayCh) offs.push(relayCh.subscribe((st, partial) => { if (partial && 'relay' in partial) draw(); }));
  if (bindCh) offs.push(bindCh.subscribe((st, partial) => { if (partial && 'relay' in partial) draw(); }));
  return { unmount() { offs.forEach((f) => f()); plot.destroy(); }, update() { draw(); } };
}
