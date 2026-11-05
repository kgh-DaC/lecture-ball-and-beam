// step-response: 1·2차 표준형 또는 bind 채널의 폐루프 스텝 응답과 지표 (chapter-format §6.1).
// 계산: analysis.tf/stepResponse/closedLoop, 지표: metrics.stepInfo.

import { h, checkProps, slider, clear, errorBox } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, channel, head, kv, modelFor, debounceRaf } from './_util.js';

export const accepts = ['order', 'K', 'tau_s', 'zeta', 'wn', 'sliders', 'show', 't_end_s', 'plant', 'controller'];

const SL = {
  K: { label: '이득 K', min: 0.1, max: 5, step: 0.1, unit: '' },
  tau_s: { label: '시정수 τ', min: 0.05, max: 5, step: 0.05, unit: 's' },
  zeta: { label: '감쇠비 ζ', min: 0.05, max: 2, step: 0.01, unit: '' },
  wn: { label: '고유진동수 ωn', min: 0.2, max: 10, step: 0.1, unit: 'rad/s' },
};
const SHOW = { tr: ['상승시간 t_r', 's'], tp: ['첨두시간 t_p', 's'], po: ['오버슈트', '%'], ts: ['정착시간 t_s(±5%)', 's'], ess: ['정상상태 오차', ''] };

/** 표준형 TF (순수: 시험용) */
export function standardTF(analysis, p) {
  if ((p.order ?? 2) === 1) return analysis.tf([p.K], [p.tau_s, 1]);
  return analysis.tf([p.K * p.wn * p.wn], [1, 2 * p.zeta * p.wn, p.wn * p.wn]);
}

export function mount(el, props, ctx) {
  checkProps(el, 'step-response', props, accepts);
  if (!need(el, ctx, ['analysis'])) return {};
  const A = ctx.analysis;
  const st = { order: props.order ?? 2, K: props.K ?? 1, tau_s: props.tau_s ?? 1, zeta: props.zeta ?? 0.5, wn: props.wn ?? 2 };
  const show = props.show || ['tr', 'tp', 'po', 'ts'];
  const tEnd = props.t_end_s ?? 10;
  const bound = !!props.bind;
  const ch = bound ? channel(ctx, props, { plant: props.plant || 'ball', controller: props.controller }) : null;
  const title = bound ? '폐루프 스텝 응답' : `${st.order}차 시스템 스텝 응답`;
  const read = h('div', { class: 'readout' });
  const formula = h('div', { class: 'muted' });
  el.append(head(title), formula);
  const plot = new Plot(el, { height: props.height_px || 230, xLabel: '시간 (s)', yLabel: '출력 y', title: '' });
  el.appendChild(read);
  const sliders = h('div');
  el.appendChild(sliders);
  if (!bound) {
    const allowed = st.order === 1 ? ['K', 'tau_s'] : ['K', 'zeta', 'wn'];
    for (const k of (props.sliders || (st.order === 1 ? ['tau_s'] : ['zeta', 'wn'])).filter((x) => allowed.includes(x))) {
      const d = SL[k];
      sliders.appendChild(slider({ label: d.label, min: d.min, max: d.max, step: d.step, value: st[k], unit: d.unit, onInput: (v) => { st[k] = v; redraw(); } }));
    }
  }

  const draw = () => {
    let t_s, y, ref = 1, note = '';
    try {
      if (bound) {
        const s = ch.get();
        if (!s.controller) { clear(read).appendChild(h('span', { class: 'muted' }, `같은 채널(bind: ${props.bind})의 근궤적 위젯을 기다리는 중…`)); return; }
        const model = modelFor(ctx, s.plant || 'ball');
        const cl = A.closedLoop({ model, controller: s.controller, alpha: s.alpha, Ts_s: s.Ts_s, delay_s: s.delay_s || 0, pade_order: s.pade_order ?? 1, t_end_s: tEnd });
        if (!cl) { clear(read).appendChild(errorBox('비선형 제어기는 선형 스텝 응답을 그리지 않습니다.')); return; }
        ({ t_s, y } = cl.step);
        note = cl.stable ? '' : '불안정 — 응답이 발산합니다';
        const p = s.controller.params;
        formula.textContent = `Kp = ${(+p.kp).toFixed(3)}, Ki = ${(+(p.ki || 0)).toFixed(3)}, Kd = ${(+(p.kd || 0)).toFixed(3)} (${s.plant === 'ball+servo' ? '서보 포함' : '서보 무시'} 모델)`;
      } else {
        const G = standardTF(A, st);
        ({ t_s, y } = A.stepResponse(G, { t_end_s: tEnd, dt_s: tEnd / 1000 }));
        ref = st.K;
        formula.textContent = st.order === 1 ? `G(s) = ${st.K.toFixed(2)} / (${st.tau_s.toFixed(2)}s + 1)` : `G(s) = ${st.K.toFixed(2)}·${(st.wn ** 2).toFixed(2)} / (s² + ${(2 * st.zeta * st.wn).toFixed(2)}s + ${(st.wn ** 2).toFixed(2)})`;
      }
    } catch (e) { clear(read).appendChild(errorBox(`계산 오류: ${e.message}`)); return; }
    const info = ctx.metrics.stepInfo(t_s, y, ref);
    const ann = [{ type: 'hline', y: ref, label: '최종값', dash: [2, 3] }, { type: 'hline', y: ref * 1.05, dash: [1, 4], noScale: true }, { type: 'hline', y: ref * 0.95, dash: [1, 4], noScale: true }];
    if (show.includes('ts') && info.ts != null) ann.push({ type: 'vline', x: info.ts, label: 'ts', color: '#009E73' });
    if (show.includes('tp') && info.tp != null && info.po > 0.1) ann.push({ type: 'vline', x: info.tp, label: 'tp', color: '#D55E00' });
    const s0 = styleOf(0);
    plot.setSeries([{ label: '응답 y(t)', x: t_s, y, ...s0 }]);
    plot.setAnnotations(ann);
    clear(read);
    for (const k of show) {
      const [lab, unit] = SHOW[k] || [k, ''];
      read.appendChild(kv(lab, k === 'ts' && info.ts == null ? '미정착' : info[k], unit));
    }
    if (!bound && st.order === 2) read.appendChild(h('span', { class: 'kv muted' }, `근사식 P.O. = ${(100 * Math.exp(-Math.PI * st.zeta / Math.sqrt(Math.max(1e-9, 1 - st.zeta ** 2)))).toFixed(1)}%${st.zeta >= 1 ? ' (ζ ≥ 1: 오버슈트 없음)' : ''}`));
    if (note) read.appendChild(h('span', { class: 'kv', style: { color: 'var(--bad)' } }, note));
  };
  const redraw = debounceRaf(draw);
  draw();
  const off = ch ? ch.subscribe(() => redraw()) : null;
  return { unmount() { off && off(); plot.destroy(); }, update() { redraw(); } };
}
