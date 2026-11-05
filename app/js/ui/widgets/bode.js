// bode: 개루프 L(s) = C(s)·P(s)·H(s)·e^{-sT} 보드 선도와 여유 (chapter-format §6.3).
// 크기와 위상은 단위가 달라 그래프를 나눈다(이중 축 금지).

import { h, checkProps, clear, errorBox } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, channel, head, kv, modelFor, debounceRaf } from './_util.js';

export const accepts = ['plant', 'controller', 'delay_s', 'alpha', 'w_range', 'show_margins'];

/** 채널 상태 → 개루프 L (analysis.closedLoop 재사용). 선형 제어기가 아니면 null */
export function loopTF(ctx, s) {
  const model = modelFor(ctx, s.plant || 'ball');
  const cl = ctx.analysis.closedLoop({ model, controller: s.controller, alpha: s.alpha, Ts_s: s.Ts_s, delay_s: s.delay_s || 0, pade_order: s.pade_order ?? 1, step: false });
  return cl ? { L: cl.L, stable: cl.stable, poles: cl.poles } : null;
}

export function mount(el, props, ctx) {
  checkProps(el, 'bode', props, accepts);
  if (!need(el, ctx, ['analysis', 'plant'])) return {};
  const A = ctx.analysis;
  const ch = channel(ctx, props, { plant: props.plant || 'ball', controller: props.controller, delay_s: props.delay_s ?? 0, alpha: props.alpha });
  const [wmin, wmax] = props.w_range || [0.1, 100];
  el.appendChild(head('보드 선도'));
  const pMag = new Plot(el, { height: 190, xLabel: 'ω (rad/s)', yLabel: '크기 (dB)', logX: true, xRange: [wmin, wmax], noZoom: true });
  const pPh = new Plot(el, { height: 190, xLabel: 'ω (rad/s)', yLabel: '위상 (°)', logX: true, xRange: [wmin, wmax], noZoom: true });
  const read = h('div', { class: 'readout' });
  el.appendChild(read);
  const draw = () => {
    const s = ch.get();
    if (!s.controller) { clear(read).appendChild(errorBox('제어기가 지정되지 않았습니다(props.controller 또는 bind 채널).')); return; }
    let lt;
    try { lt = loopTF(ctx, s); } catch (e) { clear(read).appendChild(errorBox(`계산 오류: ${e.message}`)); return; }
    if (!lt) { clear(read).appendChild(errorBox('비선형 제어기는 보드 선도를 그리지 않습니다.')); return; }
    const b = A.bode(lt.L, { wmin, wmax, n: 400 });
    pMag.setSeries([{ label: '|L(jω)|', x: b.w, y: b.mag_db, ...styleOf(0) }]);
    pPh.setSeries([{ label: '∠L(jω)', x: b.w, y: b.phase_deg, ...styleOf(1) }]);
    const annM = [{ type: 'hline', y: 0, label: '0 dB', dash: [2, 3] }];
    const annP = [{ type: 'hline', y: -180, label: '−180°', dash: [2, 3] }];
    clear(read);
    if (props.show_margins !== false) {
      const m = A.margins(lt.L);
      if (m.wgc) { annM.push({ type: 'vline', x: m.wgc, label: 'ωgc' }); annP.push({ type: 'vline', x: m.wgc, label: `PM ${m.pm_deg != null ? m.pm_deg.toFixed(1) : '–'}°` }); }
      if (m.wpc) { annM.push({ type: 'vline', x: m.wpc, label: `GM ${m.gm_db != null ? m.gm_db.toFixed(1) : '–'} dB`, color: '#D55E00' }); annP.push({ type: 'vline', x: m.wpc, color: '#D55E00' }); }
      read.append(kv('위상 여유', m.pm_deg, '°'), kv('ωgc', m.wgc, 'rad/s'), kv('이득 여유', m.gm_db == null ? '∞' : m.gm_db, m.gm_db == null ? '' : 'dB'), kv('ωpc', m.wpc, 'rad/s'), kv('지연 여유', m.delay_margin_s, 's'));
    }
    const notes = [];
    if ((s.delay_s || 0) > 0) notes.push(`지연 ${s.delay_s} s 포함(정확한 e^(−jωT))`);
    if (s.alpha != null && s.alpha < 1) notes.push(`센서 필터 α = ${s.alpha}`);
    if (notes.length) read.appendChild(h('span', { class: 'kv muted' }, notes.join(', ')));
    pMag.setAnnotations(annM); pPh.setAnnotations(annP);
  };
  const redraw = debounceRaf(draw);
  draw();
  const off = ch.subscribe(() => redraw());
  return { unmount() { off(); pMag.destroy(); pPh.destroy(); }, update() { redraw(); } };
}
