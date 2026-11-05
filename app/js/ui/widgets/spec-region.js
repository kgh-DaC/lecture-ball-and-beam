// spec-region: 성능 사양(P.O., ts) → 2차 근사 허용 영역(ζ ≥ ζmin, ζωn ≥ 3/ts). bind면 채널 spec을 바꿔
// 같은 채널의 root-locus가 영역을 겹쳐 그리고, 현재 폐루프 극점의 사양 만족 여부를 보여 준다.

import { h, checkProps, slider, clear } from '../dom.js';
import { Plot, COLORS } from '../plot.js';
import { channel, head, kv, modelFor, cxSeries, specBounds, specAnnotations, inSpec, debounceRaf } from './_util.js';

export const accepts = ['ts_s', 'po_pct'];

export function mount(el, props, ctx) {
  checkProps(el, 'spec-region', props, accepts);
  const spec0 = { ts_s: props.ts_s ?? 3, po_pct: props.po_pct ?? 5 };
  const ch = channel(ctx, props, {});
  // 이 위젯의 사양을 채널에 쓴다(root-locus의 spec보다 우선)
  ch.set({ spec: spec0 });
  const read = h('div', { class: 'readout' });
  el.append(head('사양 영역', h('span', { class: 'muted' }, '초록 영역 = 2차 근사로 사양을 만족하는 극점 위치')));
  const plot = new Plot(el, { height: props.height_px || 240, xLabel: 'Re(s)', yLabel: 'Im(s)', equalAspect: true, xy: true });
  el.appendChild(read);
  const sp = { ...spec0 };
  el.append(
    slider({ label: '최대 오버슈트', min: 0.5, max: 40, step: 0.5, value: sp.po_pct, unit: '%', onInput: (v) => { sp.po_pct = v; ch.set({ spec: { ...sp } }); redraw(); } }),
    slider({ label: '최대 정착시간', min: 0.5, max: 20, step: 0.1, value: sp.ts_s, unit: 's', onInput: (v) => { sp.ts_s = v; ch.set({ spec: { ...sp } }); redraw(); } }),
  );

  const draw = () => {
    const b = specBounds(sp);
    const s = ch.get();
    let poles = [];
    if (s.controller && ctx.analysis && ctx.control) {
      try {
        const cl = ctx.analysis.closedLoop({ model: modelFor(ctx, s.plant || 'ball'), controller: s.controller, alpha: s.alpha, Ts_s: s.Ts_s, delay_s: s.delay_s || 0, pade_order: s.pade_order ?? 1, step: false });
        if (cl) poles = cl.poles;
      } catch (e) { console.warn(e); }
    }
    const X = Math.max(4, b.sigma * 3, ...poles.filter((p) => Math.abs(p.re) < 50).map((p) => Math.abs(p.re) * 1.3));
    plot.setOpts({ xRange: [-X, X * 0.25], yRange: [-X * 0.7, X * 0.7] });
    plot.setAnnotations([{ type: 'vline', x: 0, color: '#999', dash: [] }, ...specAnnotations(b, X * 3)]);
    const t = Math.tan(b.phi);
    const series = [{ x: [0, -X * 3], y: [0, X * 3 * t], color: COLORS[2], dash: [4, 3], width: 1, label: `ζ = ${b.zeta.toFixed(3)} 선` }, { x: [0, -X * 3], y: [0, -X * 3 * t], color: COLORS[2], dash: [4, 3], width: 1, noLegend: true }];
    if (poles.length) series.push({ ...cxSeries(poles), color: COLORS[1], marker: 'sq', markerSize: 6, pointsOnly: true, label: '현재 폐루프 극점' });
    plot.setSeries(series);
    clear(read).append(kv('ζ ≥', b.zeta), kv('각도 cos⁻¹ζ', b.phi * 180 / Math.PI, '°'), kv('ζωn ≥', b.sigma, '1/s'));
    if (poles.length) {
      const fast = poles.filter((p) => p.re > -50);
      const ok = fast.every((p) => inSpec(p, b));
      read.appendChild(h('span', { class: 'kv', style: { color: ok ? 'var(--ok)' : 'var(--warn)' } }, ok ? '현재 극점 모두 영역 안' : '영역 밖 극점 있음(영점 영향은 근사식에 없음)'));
    }
  };
  const redraw = debounceRaf(draw);
  draw();
  const off = ch.subscribe(() => redraw());
  return { unmount() { off(); plot.destroy(); }, update() { redraw(); } };
}
