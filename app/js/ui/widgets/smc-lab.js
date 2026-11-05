// smc-lab: 슬라이딩모드 λ·η·Φ·스위칭 함수·K_b 오차 → 응답, 입력 채터링(u_tv), sat vs sign 비교 (chapter-format §6.7, 14장).
// 계산은 control.simulate(smc). K_b 오차는 플랜트 쪽 kb_scale(제어기는 공칭 K̂_b를 그대로 믿는다).
// sign은 시뮬레이션 전용: "실습 패널에 보내기"는 sign에서 비활성(서보 기어 손상 방지, 제어기도 실기에서 sat로 바꾼다).
// bind 채널 { smc: { lambda, eta, phi, switch, kb_error_pct } }를 phase-plane과 공유한다.

import { h, checkProps, clear, errorBox, warnBox, fmt, slider, toast, table } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, head, kv, channel, modelFor, simRun, sendToPractice, debounceRaf, practiceParamsFor, P1 } from './_util.js';

export const accepts = ['lambda', 'eta', 'phi', 'switch', 'kb_error_pct'];

export function mount(el, props, ctx) {
  checkProps(el, 'smc-lab', props, accepts);
  if (!need(el, ctx, ['registry', 'simulate', 'plant'])) return {};
  const C = ctx.control.getController('smc');
  const practice = (ctx.chapter && ctx.chapter.practice) || null;
  const pp = practiceParamsFor(practice, 'smc');
  const plant = (practice && practice.model) || 'ball+servo';
  const init = { lambda: props.lambda ?? pp.safe.lambda ?? 1, eta: props.eta ?? pp.safe.eta ?? 0.1, phi: props.phi ?? pp.safe.phi ?? 0.05, switch: props.switch || pp.safe.switch || 'sat', kb_error_pct: props.kb_error_pct ?? 0 };
  const ch = channel(ctx, props, { smc: init });
  ch.set({ smc: { ...(ch.get().smc || {}), ...init } }); // 이 위젯 props가 채널 값을 정한다(phase-plane은 읽기만)
  const cur = () => ({ ...init, ...(ch.get().smc || {}) });
  const set = (partial) => { ch.set({ smc: { ...cur(), ...partial } }); redraw(); };
  el.appendChild(head('슬라이딩모드 실험실', h('span', { class: 'muted' }, 'u = (−λė − η·sat(s/Φ)) / K̂_b,  s = ė + λe')));
  const lim = (k, a, b) => { const l = pp.limits[k]; return l ? [Math.max(a, l[0]), Math.min(b, l[1])] : [a, b]; };
  const mkS = (key, label, unit, a, b, step, scale = 1) => { const [mn, mx] = lim(key, a, b); return slider({ label, min: mn * scale, max: mx * scale, step, value: cur()[key] * scale, unit, onInput: (v) => set({ [key]: v / scale }) }); };
  const swSel = h('select', { onchange: (e) => set({ switch: e.target.value }) }, [['sat', 'sat (경계층)'], ['sign', 'sign (시뮬레이션 전용)']].map(([v, l]) => h('option', { value: v, selected: v === cur().switch }, l)));
  const ctl = h('div');
  ctl.append(mkS('lambda', 'λ (면 기울기)', '1/s', 0.1, 5, 0.05), mkS('eta', 'η (도달 속도)', 'm/s²', 0, 2, 0.01), mkS('phi', 'Φ (경계층)', 'mm/s', 0.005, 0.5, 1, 1000),
    slider({ label: 'K_b 실제/공칭 오차', min: -50, max: 50, step: 1, value: cur().kb_error_pct, unit: '%', onInput: (v) => set({ kb_error_pct: v }) }),
    h('div', { class: 'row' }, h('label', null, '스위칭 함수 ', swSel)));
  const read = h('div', { class: 'readout' });
  const tblBox = h('div', { class: 'tbl-wrap' });
  const msg = h('div');
  const acts = h('div', { class: 'row' });
  el.append(ctl, read, msg, tblBox, acts);
  const pY = new Plot(el, { height: props.height_px || 190, xLabel: '시간 (s)', yLabel: '위치 (mm)' });
  const pU = new Plot(el, { height: 140, xLabel: '시간 (s)', yLabel: '명령각 (°)' });
  const sendBtn = h('button', { class: 'btn', onclick: () => {
    const p = cur();
    if (p.switch === 'sign') return;
    sendToPractice(ctx, { id: 'smc', params: { ...pp.safe, lambda: p.lambda, eta: p.eta, phi: p.phi, switch: 'sat' } });
    toast('λ·η·Φ를 실습 패널(슬라이딩모드)로 보냈습니다', 'ok');
  } }, '실습 패널에 보내기');
  acts.append(sendBtn);

  const draw = () => {
    clear(msg); clear(read);
    const p = cur();
    try {
      const model = modelFor(ctx, plant);
      const ctrl = (sw) => ({ id: 'smc', params: { ...pp.safe, lambda: p.lambda, eta: p.eta, phi: p.phi, switch: sw } });
      const opts = { kb_scale: 1 + (p.kb_error_pct || 0) / 100 };
      const other = p.switch === 'sign' ? 'sat' : 'sign';
      const a = simRun(ctx, { controller: ctrl(p.switch), model, profile: P1, sim_opts: opts });
      const b = simRun(ctx, { controller: ctrl(other), model, profile: P1, sim_opts: opts });
      const t = a.rows.map((r) => r.t_s);
      pY.setSeries([{ label: `${p.switch}`, x: t, y: a.rows.map((r) => r.y_mm), ...styleOf(0), width: 2.2 }, { label: `비교: ${other}`, x: t, y: b.rows.map((r) => r.y_mm), ...styleOf(1), width: 1.2, alpha: 0.6 },
        { label: '설정값', x: t, y: a.rows.map((r) => r.ref_mm), ...styleOf(6), width: 1, step: true }]);
      pU.setSeries([{ label: `u (${p.switch})`, x: t, y: a.rows.map((r) => r.u_cdeg / 100), ...styleOf(0), step: true }, { label: `u (${other})`, x: t, y: b.rows.map((r) => r.u_cdeg / 100), ...styleOf(1), width: 1, alpha: 0.5, step: true }]);
      const ms = ['po', 'ts', 'itae', 'u_rms', 'u_tv'];
      const info = (ctx.metrics && ctx.metrics.METRIC_INFO) || {};
      const cell = (s, k) => (k === 'ts' && s[k] == null ? '미정착' : fmt(s[k], k === 'itae' ? 0 : 2));
      clear(tblBox).appendChild(table(['스위칭', ...ms.map((k) => `${(info[k] || {}).label || k}${(info[k] || {}).unit ? ` (${info[k].unit})` : ''}`)],
        [[`${p.switch} (선택)`, ...ms.map((k) => cell(a.summary, k))], [other, ...ms.map((k) => cell(b.summary, k))]]));
      const eq = C.equivalentPD ? C.equivalentPD({ lambda: p.lambda, eta: p.eta, phi: p.phi, kb_nominal: pp.safe.kb_nominal ?? 0.8709 }) : null;
      if (eq) read.append(kv('경계층 안 등가 Kp', eq.kp, 'rad/m'), kv('등가 Kd', eq.kd, 'rad·s/m'));
      read.append(kv('K_b 오차', p.kb_error_pct || 0, '%'), h('span', { class: 'kv muted' }, `${plant === 'ball+servo' ? '서보 포함' : '서보 무시'} 모델 [시뮬레이션]`));
      if (p.switch === 'sign') msg.appendChild(warnBox('sign은 시뮬레이션 전용입니다. 실기에서는 서보가 고주파로 떨려 기어가 상합니다(실습 패널로 보내기 비활성, 제어기도 실기에서 sat로 바꿈).'));
      if (a.sim.end_hit) msg.appendChild(warnBox('예측에서 공이 빔 끝에 닿았습니다.'));
      sendBtn.disabled = p.switch === 'sign';
      sendBtn.title = p.switch === 'sign' ? 'sign은 실기 금지' : '';
    } catch (e) { msg.appendChild(errorBox(`시뮬레이션 실패: ${e.message}`)); }
  };
  const redraw = debounceRaf(draw);
  draw();
  const off = ch.subscribe((st, partial) => { if (partial.smc) { swSel.value = cur().switch; redraw(); } });
  return { unmount() { off(); pY.destroy(); pU.destroy(); } };
}
