// nyquist: 나이키스트 선도, −1 근처 확대, 포위 수 Z = N + P (chapter-format §6.3).
// 슬라이더 'gain'은 제어기 이득 전체에 곱하는 배수, 'delay_s'는 추가 지연. bind면 채널에 반영한다.

import { h, checkProps, slider, clear, errorBox } from '../dom.js';
import { Plot, styleOf, COLORS } from '../plot.js';
import { need, channel, head, kv, scaleGains, debounceRaf } from './_util.js';
import { loopTF } from './bode.js';

export const accepts = ['plant', 'controller', 'delay_s', 'sliders', 'zoom_minus1'];

export function mount(el, props, ctx) {
  checkProps(el, 'nyquist', props, accepts);
  if (!need(el, ctx, ['analysis', 'plant'])) return {};
  const A = ctx.analysis;
  const ch = channel(ctx, props, { plant: props.plant || 'ball', controller: props.controller, delay_s: props.delay_s ?? 0 });
  let base = ch.get().controller;  // 이득 배수의 기준
  let gain = 1;
  el.appendChild(head('나이키스트 선도', h('span', { class: 'muted' }, '실선 ω > 0, 점선 ω < 0, ● = −1')));
  const grid = h('div', { class: props.zoom_minus1 !== false ? 'grid2' : '' });
  el.appendChild(grid);
  const pMain = new Plot(grid, { height: props.height_px || 280, xLabel: 'Re L', yLabel: 'Im L', equalAspect: true, xy: true, xRange: [-6, 3], yRange: [-5, 5], title: '전체' });
  const pZoom = props.zoom_minus1 !== false ? new Plot(grid, { height: props.height_px || 280, xLabel: 'Re L', yLabel: 'Im L', equalAspect: true, xy: true, xRange: [-2.2, 0.6], yRange: [-1.4, 1.4], title: '−1 근처 확대' }) : null;
  const read = h('div', { class: 'readout' });
  el.appendChild(read);
  const sl = {};
  for (const k of props.sliders || ['gain', 'delay_s']) {
    if (k === 'gain') {
      sl.gain = slider({ label: '이득 배수 k', min: 0.1, max: 10, value: 1, log: true, unit: '×', onInput: (v) => {
        gain = v;
        if (base) ch.set({ controller: { ...base, params: scaleGains(base.params, gain) } });
        redraw();
      } });
      el.appendChild(sl.gain);
    } else if (k === 'delay_s') {
      sl.delay = slider({ label: '추가 지연 T', min: 0, max: 0.6, step: 0.005, value: ch.get().delay_s || 0, unit: 's', onInput: (v) => { ch.set({ delay_s: v }); redraw(); } });
      el.appendChild(sl.delay);
    }
  }

  const draw = () => {
    const s = ch.get();
    if (!s.controller) { clear(read).appendChild(errorBox('제어기가 지정되지 않았습니다.')); return; }
    let lt, ny;
    try {
      lt = loopTF(ctx, s);
      if (!lt) { clear(read).appendChild(errorBox('비선형 제어기')); return; }
      ny = A.nyquist(lt.L, { wmin: 1e-2, wmax: 1e3, n: 500 });
    } catch (e) { clear(read).appendChild(errorBox(`계산 오류: ${e.message}`)); return; }
    const pos = { x: ny.re, y: ny.im };
    const neg = { x: ny.re.slice().reverse(), y: ny.im.slice().reverse().map((v) => -v) };
    const s0 = styleOf(0);
    const series = [
      { ...pos, color: s0.color, width: 2, label: 'L(jω), ω > 0' },
      { ...neg, color: s0.color, dash: [5, 4], width: 1.4, label: 'ω < 0 (대칭)' },
      { x: [-1], y: [0], color: COLORS[1], marker: 'dot', markerSize: 5, pointsOnly: true, label: '−1' },
    ];
    pMain.setSeries(series);
    const unit = [];
    for (let i = 0; i <= 72; i++) { const a = (i / 72) * 2 * Math.PI; unit.push([Math.cos(a), Math.sin(a)]); }
    const circle = { x: unit.map((p) => p[0]), y: unit.map((p) => p[1]), color: '#999', dash: [2, 3], width: 1, label: '단위원', noTip: true };
    if (pZoom) pZoom.setSeries([...series.map((x) => ({ ...x, noLegend: true })), circle]);
    const axes = [{ type: 'vline', x: 0, color: '#bbb', dash: [] }, { type: 'hline', y: 0, color: '#bbb', dash: [], noScale: true }];
    pMain.setAnnotations(axes); pZoom && pZoom.setAnnotations(axes);
    const m = A.margins(lt.L);
    clear(read).append(
      kv('개루프 우반면 극점 P', ny.P_rhp), kv('−1 시계 방향 포위 N', ny.N_cw), kv('폐루프 우반면 극점 Z = N + P', ny.Z_rhp),
      h('span', { class: 'kv', style: { color: ny.stable ? 'var(--ok)' : 'var(--bad)' } }, ny.stable ? '안정' : '불안정'),
      kv('이득 배수', gain, '×'), kv('지연', s.delay_s || 0, 's'), kv('PM', m.pm_deg, '°'), kv('GM', m.gm_db == null ? '∞' : m.gm_db, m.gm_db == null ? '' : 'dB'),
    );
    if (ny.indent && ny.indent.count) read.appendChild(h('span', { class: 'kv muted' }, `허수축 극점 ${ny.indent.count}개는 반지름 ${ny.indent.radius}의 작은 반원으로 우회(그림 밖 큰 호)`));
  };
  const redraw = debounceRaf(draw);
  draw();
  const off = ch.subscribe((state, partial) => {
    if (partial.controller) { base = state.controller; gain = 1; sl.gain && sl.gain.setValue(1); }
    if (partial.delay_s != null && sl.delay) sl.delay.setValue(partial.delay_s);
    redraw();
  });
  return { unmount() { off(); pMain.destroy(); pZoom && pZoom.destroy(); }, update() { redraw(); } };
}
