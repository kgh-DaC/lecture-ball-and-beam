// convergence-plot: 시뮬레이션 기반 최적화 튜닝(autotune.optimize, Nelder–Mead)의 반복별 비용·게인 곡선 (chapter-format §6.7, 11장).
// 모든 평가는 control.simulate(같은 모델·프로파일). 시작 게인 vs 최적 게인 응답을 겹쳐 그린다.
// 계산이 수백 번의 시뮬레이션이라 버튼을 눌렀을 때만 돈다(본문을 여는 순간 화면이 멈추지 않게).

import { h, checkProps, clear, errorBox, infoBox, fmt, toast, slider } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, head, kv, modelFor, simRun, sendToPractice, P1 } from './_util.js';

export const accepts = ['cost', 'init', 'max_iter', 'plant', 'profile'];
const COST_LABEL = { itae: 'ITAE Σ(t−t₀)|e|dt', iae: 'IAE Σ|e|dt', ise: 'ISE Σe²dt' };

export function mount(el, props, ctx) {
  checkProps(el, 'convergence-plot', props, accepts);
  if (!need(el, ctx, ['autotune', 'simulate', 'plant'])) return {};
  const at = ctx.control.autotune;
  let cost = props.cost || 'itae';
  let maxIter = props.max_iter ?? 60;
  const plant = props.plant || 'ball+servo';
  const profile = props.profile || P1;
  const init = { kp: 0.86, ki: 0.08, kd: 1.67, ...(props.init || {}) };
  el.appendChild(head('최적화 튜닝 수렴', h('span', { class: 'muted' }, `비용 ${COST_LABEL[cost] || cost} · ${plant === 'ball+servo' ? '서보 포함' : '서보 무시'} 모델 [시뮬레이션]`)));
  const ctl = h('div', { class: 'row' });
  const msg = h('div');
  const read = h('div', { class: 'readout' });
  el.append(ctl, msg, read);
  const pJ = new Plot(el, { height: 170, xLabel: '반복', yLabel: `비용 J (${cost})` });
  const pK = new Plot(el, { height: 170, xLabel: '반복', yLabel: '게인 (SI)' });
  const pY = new Plot(el, { height: props.height_px || 210, xLabel: '시간 (s)', yLabel: '위치 (mm)' });
  let result = null;

  const initRun = () => simRun(ctx, { controller: { id: 'pid', params: { ...init, n_filt: 10, d_on: 'measurement' } }, plant, profile });
  const drawResponses = (a, b) => {
    const ser = [];
    if (a) ser.push({ label: `시작 게인 (J = ${fmt(at.simCost(a.sim, cost, profile.type === 'step' ? profile.pre_s || 0 : 0), 4)})`, x: a.rows.map((r) => r.t_s), y: a.rows.map((r) => r.y_mm), ...styleOf(1) });
    if (b) ser.push({ label: `최적 게인 (J = ${fmt(result.J, 4)})`, x: b.rows.map((r) => r.t_s), y: b.rows.map((r) => r.y_mm), ...styleOf(0), width: 2.4 });
    const any = a || b;
    if (any) ser.push({ label: '설정값', x: any.rows.map((r) => r.t_s), y: any.rows.map((r) => r.ref_mm), ...styleOf(6), width: 1, step: true });
    pY.setSeries(ser);
  };

  const run = () => {
    clear(msg); clear(read);
    try {
      const model = modelFor(ctx, plant);
      const t0 = Date.now();
      result = at.optimize(model, init, { cost, profile, max_iter: maxIter, n_filt: 10 });
      const ms = Date.now() - t0;
      const it = result.history.map((q) => q.iter);
      pJ.setSeries([{ label: `최선 비용 J`, x: it, y: result.history.map((q) => q.J), ...styleOf(0), marker: 'dot', markerSize: 2.5 }]);
      pK.setSeries(['kp', 'ki', 'kd'].map((k, i) => ({ label: { kp: 'Kp', ki: 'Ki', kd: 'Kd' }[k], x: it, y: result.history.map((q) => q[k]), ...styleOf(i) })));
      const b = simRun(ctx, { controller: { id: 'pid', params: { ...result.best, n_filt: 10, d_on: 'measurement' } }, plant, profile });
      const a = initRun();
      drawResponses(a, b);
      read.append(kv('반복', result.history.length), kv('시뮬레이션 횟수', result.evals), kv('Kp', result.best.kp), kv('Ki', result.best.ki), kv('Kd', result.best.kd), kv('J', result.J),
        kv('P.O.', b.summary.po, '%'), kv('ts', b.summary.ts == null ? '미정착' : b.summary.ts, b.summary.ts == null ? '' : 's'), h('span', { class: 'kv muted' }, `${ms} ms`));
      if (result.history.length >= maxIter) msg.appendChild(infoBox(`최대 반복(${maxIter})에서 멈췄습니다. 비용이 아직 줄고 있으면 반복을 늘려 보세요.`));
      msg.appendChild(infoBox('모델이 실제와 다르면 최적 게인도 실기에서는 최적이 아닙니다. 실습 패널에 보내 가상 장치·실기로 확인하세요.'));
    } catch (e) { msg.appendChild(errorBox(`최적화 실패: ${e.message}`)); }
  };

  const costSel = h('select', { onchange: (e) => { cost = e.target.value; } }, ['itae', 'iae', 'ise'].map((c) => h('option', { value: c, selected: c === cost }, c.toUpperCase())));
  ctl.append(h('label', null, '비용 ', costSel),
    slider({ label: '최대 반복', min: 5, max: 200, step: 1, value: maxIter, onInput: (v) => { maxIter = Math.round(v); } }),
    h('button', { class: 'btn primary', onclick: run }, '최적화 실행'),
    h('button', { class: 'btn', onclick: () => {
      if (!result) { toast('먼저 최적화를 실행하세요', 'info'); return; }
      sendToPractice(ctx, { id: 'pid', params: { ...result.best, n_filt: 10, d_on: 'measurement' } });
      toast('최적 게인을 실습 패널(PID)로 보냈습니다', 'ok');
    } }, '최적 게인을 실습 패널에 보내기'));
  read.append(kv('시작 Kp', init.kp), kv('Ki', init.ki), kv('Kd', init.kd), h('span', { class: 'kv muted' }, '“최적화 실행”을 누르세요'));
  try { drawResponses(initRun(), null); } catch (e) { msg.appendChild(errorBox(`시작 게인 시뮬레이션 실패: ${e.message}`)); }
  return { unmount() { pJ.destroy(); pK.destroy(); pY.destroy(); }, run };
}
