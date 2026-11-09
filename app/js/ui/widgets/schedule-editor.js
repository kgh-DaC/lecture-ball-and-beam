// schedule-editor: 게인 스케줄 경계·게인·전환 방식 편집 → |e|에 따른 게인 곡선 + 계단 프로파일 예측 응답 (chapter-format §6.7, 12장).
// 편집기는 gain-schedule 제어기 meta.params로 만든다(param-editor). 게인 곡선은 제어기 인스턴스의 weight(d)를 그대로 쓴다.
// bind 채널에 controller { id: 'gain-schedule', params }를 내보내고, "실습 패널에 보내기"로 controller-panel 초기값이 된다.

import { h, checkProps, clear, errorBox, warnBox, fmt, table, toast } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, head, kv, channel, simRun, sendToPractice, debounceRaf, practiceParamsFor } from './_util.js';
import { paramEditor, initialParams } from '../param-editor.js';

export const accepts = ['params', 'editable'];
const STAIR = { type: 'staircase', levels_mm: [120, 170, 270, 170], hold_s: 6 };

/** 제어기 weight(d)로 |e| → (kp, ki, kd) 곡선(순수) */
export function gainCurve(C, params, dMax = 0.25, n = 126) {
  const inst = new C(params, { Ts_s: 0.06, u_lim_rad: 0.5236 });
  const d = [], kp = [], ki = [], kd = [];
  for (let i = 0; i < n; i++) {
    const x = (dMax * i) / (n - 1);
    const w = inst.weight(x);
    d.push(x * 1000);
    kp.push((1 - w) * params.kp_near + w * params.kp_far);
    ki.push((1 - w) * params.ki_near + w * params.ki_far);
    kd.push((1 - w) * params.kd_near + w * params.kd_far);
  }
  return { d_mm: d, kp, ki, kd };
}

export function mount(el, props, ctx) {
  checkProps(el, 'schedule-editor', props, accepts);
  if (!need(el, ctx, ['registry', 'simulate', 'plant'])) return {};
  const C = ctx.control.getController('gain-schedule');
  const practice = (ctx.chapter && ctx.chapter.practice) || null;
  const plant = (practice && practice.model) || 'ball+servo';
  const profile = practice && practice.setpoint_profile && practice.controller === 'gain-schedule' ? practice.setpoint_profile : STAIR;
  const pp = practiceParamsFor(practice, 'gain-schedule');
  let params = initialParams(C.meta, { given: props.params || {}, limits: {} });
  const ch = channel(ctx, props, { controller: { id: 'gain-schedule', params }, plant });
  el.appendChild(head('게인 스케줄 편집', h('span', { class: 'muted' }, '|e| < 경계 → 가까움 게인, 그 밖 → 멂 게인')));
  const edBox = h('div');
  const read = h('div', { class: 'readout' });
  const tblBox = h('div', { class: 'tbl-wrap' });
  const acts = h('div', { class: 'row' });
  const msg = h('div');
  el.append(edBox, tblBox, read, msg, acts);
  const pG = new Plot(el, { height: 170, xLabel: '|오차| (mm)', yLabel: '게인 (SI)' });
  const pY = new Plot(el, { height: props.height_px || 210, xLabel: '시간 (s)', yLabel: '측정 거리(표면) (mm)' });
  const pK = new Plot(el, { height: 130, xLabel: '시간 (s)', yLabel: '적용 Kp, Kd' });

  if (props.editable !== false) {
    edBox.appendChild(paramEditor({ meta: C.meta, values: params, limits: pp.limits, onChange: (v) => { params = v; ch.set({ controller: { id: 'gain-schedule', params } }); redraw(); } }));
  }

  const draw = () => {
    clear(msg);
    const p = params;
    clear(tblBox).appendChild(table(['영역', 'Kp (rad/m)', 'Ki (rad/(m·s))', 'Kd (rad·s/m)'], [
      [`가까움 |e| < ${fmt(p.boundary * 1000, 0)} mm`, fmt(p.kp_near), fmt(p.ki_near), fmt(p.kd_near)],
      [`멂 |e| ≥ ${fmt(p.boundary * 1000, 0)} mm`, fmt(p.kp_far), fmt(p.ki_far), fmt(p.kd_far)]]));
    try {
      const g = gainCurve(C, p);
      pG.setAnnotations([{ type: 'vline', x: p.boundary * 1000, label: '경계' }]);
      pG.setSeries([{ label: 'Kp', x: g.d_mm, y: g.kp, ...styleOf(0) }, { label: 'Ki', x: g.d_mm, y: g.ki, ...styleOf(2) }, { label: 'Kd', x: g.d_mm, y: g.kd, ...styleOf(1) }]);
      const r = simRun(ctx, { controller: { id: 'gain-schedule', params: p }, plant, profile });
      const t = r.rows.map((q) => q.t_s);
      pY.setSeries([{ label: '예측 위치', x: t, y: r.rows.map((q) => q.y_mm), ...styleOf(0) }, { label: '설정값', x: t, y: r.rows.map((q) => q.ref_mm), ...styleOf(6), width: 1, step: true }]);
      pK.setSeries([{ label: 'Kp(t)', x: t, y: r.rows.map((q) => q.dbg_kp), ...styleOf(0), step: true }, { label: 'Kd(t)', x: t, y: r.rows.map((q) => q.dbg_kd), ...styleOf(1), step: true }]);
      const nSw = r.rows.reduce((n, q, i) => n + (i > 0 && q.dbg_region !== r.rows[i - 1].dbg_region ? 1 : 0), 0);
      clear(read).append(kv('ITAE(전 구간)', r.summary.itae), kv('u_tv', r.summary.u_tv, '°'), kv('최대 P.O.', r.summary.po, '%'), kv('영역 전환', nSw, '회'),
        h('span', { class: 'kv muted' }, `${plant === 'ball+servo' ? '서보 포함' : '서보 무시'} 모델 [시뮬레이션], 계단 ${profile.levels_mm ? profile.levels_mm.join('→') : ''} mm`));
      if (r.sim.end_hit) msg.appendChild(warnBox('예측에서 공이 빔 끝에 닿았습니다. 멂 영역 Kd를 키우거나 Kp를 줄이세요.'));
    } catch (e) { msg.appendChild(errorBox(`계산 오류: ${e.message}`)); }
  };
  const redraw = debounceRaf(draw);

  acts.append(h('button', { class: 'btn', onclick: () => { sendToPractice(ctx, { id: 'gain-schedule', params: { ...params } }); toast('스케줄을 실습 패널(게인 스케줄링)로 보냈습니다', 'ok'); } }, '실습 패널에 보내기'));
  draw();
  const off = ch.subscribe((st, partial) => {
    if (partial.controller && partial.controller.id === 'gain-schedule') { params = { ...params, ...partial.controller.params }; redraw(); }
  });
  return { unmount() { off(); pG.destroy(); pY.destroy(); pK.destroy(); } };
}
