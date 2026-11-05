// root-locus: 근궤적 + 현재 폐루프 극점 + (선택) 사양 영역·스텝 응답 (chapter-format §6.3).
// 게인 K = Kp로 두고 정규화 제어기 C(s)/Kp(Tf는 현재 값으로 고정)를 analysis.rlocus에 넘긴다.
// 따라서 K = 현재 Kp인 점이 analysis.closedLoop의 폐루프 극점과 같다.
// 조작: 극점(■)을 끌면 궤적을 따라 Kp가 바뀌고, PD일 때 영점(○)을 실수축 위로 끌면 Kd가 바뀐다.

import { h, checkProps, slider, clear, errorBox, fmt } from '../dom.js';
import { Plot, styleOf, COLORS } from '../plot.js';
import { need, channel, head, kv, modelFor, cxSeries, specBounds, specAnnotations, inSpec, debounceRaf } from './_util.js';

export const accepts = ['plant', 'controller', 'editable', 'k_range', 'delay_s', 'pade_order', 'show_step', 'spec'];

const DEF_CTRL = { id: 'pid', params: { kp: 0.574, ki: 0, kd: 0.994, n_filt: 8, d_on: 'error' } };

/** 정규화 제어기 파라미터(Kp = 1, Tf 유지) */
export function normalizedParams(p) {
  const kp = Math.max(Math.abs(p.kp || 0), 1e-6);
  return { ...p, kp: 1, ki: (p.ki || 0) / kp, kd: (p.kd || 0) / kp };
}

/** 지배 극점(허수부가 양인 것 중 실수부 최대, 없으면 실수부 최대)의 ζ, ωn */
export function dominant(poles) {
  if (!poles || !poles.length) return null;
  const sorted = poles.slice().sort((a, b) => b.re - a.re);
  const p = sorted.find((x) => x.im > 1e-9 && x.re >= sorted[0].re - 1e-6) || sorted[0];
  const wn = Math.hypot(p.re, p.im);
  return { pole: p, wn, zeta: wn > 0 ? -p.re / wn : null };
}

export function mount(el, props, ctx) {
  checkProps(el, 'root-locus', props, accepts);
  if (!need(el, ctx, ['analysis', 'plant'])) return {};
  const A = ctx.analysis;
  const ctrl0 = props.controller || DEF_CTRL;
  if (ctrl0.id !== 'pid') { el.appendChild(errorBox('root-locus는 선형 PID 계열 제어기만 지원합니다.')); return {}; }
  const ch = channel(ctx, props, { plant: props.plant || 'ball', controller: ctrl0, delay_s: props.delay_s ?? 0, pade_order: props.pade_order ?? 1, spec: props.spec });
  const [kmin, kmax] = props.k_range || [0, 20];
  const editable = props.editable || ['kp', 'kd'];
  const read = h('div', { class: 'readout' });
  el.appendChild(head('근궤적', h('span', { class: 'muted' }, '■ 현재 폐루프 극점(끌기)  × 개루프 극점  ○ 영점')));
  const plot = new Plot(el, { height: props.height_px || 330, xLabel: '실수부 Re(s)', yLabel: '허수부 Im(s)', equalAspect: true, xy: true, legend: true });
  el.appendChild(read);
  const sliderBox = h('div');
  el.appendChild(sliderBox);
  let stepPlot = null, stepRead = null;
  if (props.show_step !== false) {
    stepPlot = new Plot(el, { height: 180, xLabel: '시간 (s)', yLabel: 'y (단위 스텝)' });
    stepRead = h('div', { class: 'readout' });
    el.appendChild(stepRead);
  }

  const sl = {};
  const limits = (k, v) => ({ kp: [Math.max(kmin, 0), kmax], ki: [0, Math.max(2, 5 * (v || 0))], kd: [0, Math.max(10, 3 * (v || 0))] }[k]);
  const setParam = (key, v, fromSlider) => {
    const s = ch.get();
    ch.set({ controller: { ...s.controller, params: { ...s.controller.params, [key]: v } } });
    if (!fromSlider && sl[key]) sl[key].setValue(v);
    redraw();
  };
  for (const key of editable) {
    const v = ch.get().controller.params[key] ?? 0;
    const [mn, mx] = limits(key, v);
    sl[key] = slider({ label: { kp: 'Kp (게인 K)', ki: 'Ki', kd: 'Kd' }[key] || key, min: mn, max: mx, step: 0.001, value: v, unit: { kp: 'rad/m', ki: 'rad/(m·s)', kd: 'rad·s/m' }[key], onInput: (x) => setParam(key, x, true) });
    sliderBox.appendChild(sl[key]);
  }

  let cache = null; // 마지막 계산(끌기용)
  let lowres = false;
  const compute = () => {
    const s = ch.get();
    const model = modelFor(ctx, s.plant || 'ball');
    const p = s.controller.params;
    const common = { model, alpha: s.alpha, Ts_s: s.Ts_s, delay_s: s.delay_s || 0, pade_order: s.pade_order ?? 1 };
    const cl = A.closedLoop({ ...common, controller: s.controller, step: props.show_step !== false, t_end_s: 15 });
    const Ln = A.closedLoop({ ...common, controller: { id: 'pid', params: normalizedParams(p) }, step: false }).L;
    const rl = A.rlocus(Ln, { kmin, kmax: Math.max(kmax, (p.kp || 0) * 1.05), n: lowres ? 60 : 200, lowres, pade_order: s.pade_order ?? 1 });
    const zc = A.zeros(A.controllerTF('pid', p)).filter((z) => Number.isFinite(z.re));
    return { s, p, cl, rl, zc };
  };

  const draw = () => {
    let c;
    try { c = compute(); } catch (e) { clear(read).appendChild(errorBox(`계산 오류: ${e.message}`)); return; }
    cache = c;
    const { s, p, cl, rl, zc } = c;
    const series = [];
    const st0 = styleOf(0);
    rl.branches.forEach((br, i) => {
      const xy = cxSeries(br);
      series.push({ ...xy, color: st0.color, dash: [], width: 1.6, label: i === 0 ? '근궤적 (Kp 변화)' : null, noLegend: i > 0, alpha: 0.85 });
    });
    if (rl.open_poles.length) series.push({ ...cxSeries(rl.open_poles), color: COLORS[6], marker: 'x', pointsOnly: true, label: '개루프 극점' });
    const oz = rl.open_zeros.filter((z) => Math.abs(z.re) < 1e6);
    if (oz.length) series.push({ ...cxSeries(oz), color: COLORS[6], marker: 'o', pointsOnly: true, label: '개루프 영점' });
    if (zc.length) series.push({ ...cxSeries(zc), color: COLORS[2], marker: 'o', markerSize: 7, pointsOnly: true, label: '제어기 영점(끌기)' });
    series.push({ ...cxSeries(cl.poles), color: COLORS[1], marker: 'sq', markerSize: 6, pointsOnly: true, label: `폐루프 극점 (Kp = ${fmt(p.kp)})` });
    // 보기 범위
    const pts = [...cl.poles, ...zc, ...rl.open_poles].filter((z) => Number.isFinite(z.re) && Math.abs(z.re) < 200);
    const b = specBounds(s.spec);
    let xmin = Math.min(-1, ...pts.map((z) => z.re * 1.3));
    if (b) xmin = Math.min(xmin, -b.sigma * 2);
    xmin = Math.max(xmin, -60);
    const ymax = Math.max(1, ...pts.map((z) => Math.abs(z.im) * 1.3), Math.abs(xmin) * 0.5);
    plot.setOpts({ xRange: [xmin, Math.max(1, Math.abs(xmin) * 0.25)], yRange: [-ymax, ymax] });
    const ann = [{ type: 'vline', x: 0, color: '#999', dash: [] }, { type: 'hline', y: 0, color: '#bbb', dash: [], noScale: true }, ...specAnnotations(b, 200)];
    plot.setAnnotations(ann);
    plot.setSeries(series);
    // 읽기
    clear(read);
    const dom = dominant(cl.poles);
    read.append(kv('Kp', p.kp), kv('Ki', p.ki || 0), kv('Kd', p.kd || 0));
    if (dom) read.append(kv('지배 극점', `${fmt(dom.pole.re)} ± ${fmt(Math.abs(dom.pole.im))}j`), kv('ζ', dom.zeta), kv('ωn', dom.wn, 'rad/s'));
    read.appendChild(h('span', { class: 'kv', style: { color: cl.stable ? 'var(--ok)' : 'var(--bad)' } }, cl.stable ? '안정' : '불안정'));
    if (b) {
      const ok = cl.poles.filter((q) => Math.abs(q.im) > 1e-9 || q.re > -50).every((q) => inSpec(q, b));
      read.appendChild(h('span', { class: 'kv', style: { color: ok ? 'var(--ok)' : 'var(--warn)' } }, ok ? '모든 극점이 사양 영역 안' : '사양 영역 밖 극점 있음'));
    }
    if ((s.delay_s || 0) > 0) read.appendChild(h('span', { class: 'kv muted' }, `지연 ${s.delay_s} s (Padé ${s.pade_order ?? 1}차 근사)`));
    if (stepPlot && cl.step) {
      const info = ctx.metrics.stepInfo(cl.step.t_s, cl.step.y, 1);
      stepPlot.setSeries([{ label: '폐루프 스텝 응답', x: cl.step.t_s, y: cl.step.y, ...styleOf(1) }]);
      stepPlot.setAnnotations([{ type: 'hline', y: 1, dash: [2, 3] }, ...(info.ts != null ? [{ type: 'vline', x: info.ts, label: 'ts' }] : [])]);
      clear(stepRead).append(kv('오버슈트', info.po, '%'), kv('tr', info.tr, 's'), kv('ts(±5%)', info.ts == null ? '미정착' : info.ts, info.ts == null ? '' : 's'));
    }
  };
  const redraw = debounceRaf(draw);

  // 끌기
  let drag = null;
  plot.onPointer = (ev) => {
    if (!cache) return;
    if (ev.type === 'down') {
      const near = (list) => list.reduce((best, z, i) => { const q = plot.toPx(z.re, z.im); const d = q ? Math.hypot(q.X - ev.X, q.Y - ev.Y) : Infinity; return d < best.d ? { d, i } : best; }, { d: Infinity, i: -1 });
      const np = near(cache.cl.poles);
      const nz = near(cache.zc);
      if (editable.includes('kd') && !(cache.p.ki > 0) && nz.d < 14 && nz.d <= np.d) drag = 'zero';
      else if (editable.includes('kp') && np.d < 16) drag = 'gain';
      if (drag) { lowres = true; ev.ev.preventDefault(); }
    } else if (ev.type === 'move' && drag) {
      if (drag === 'gain') {
        let best = { d: Infinity, k: null };
        const { gains, branches } = cache.rl;
        for (const br of branches) for (let i = 0; i < br.length; i++) {
          const d = Math.hypot(br[i].re - ev.x, br[i].im - ev.y);
          if (d < best.d) best = { d, k: gains[i] };
        }
        if (best.k != null) setParam('kp', Math.min(kmax, Math.max(Math.max(kmin, 1e-3), best.k)));
      } else {
        const z = Math.min(-0.01, ev.x);
        const p = cache.p;
        const n = p.n_filt || 8;
        const kd = p.kp / (Math.abs(z) * (1 + 1 / n));
        setParam('kd', Math.min(limits('kd', p.kd)[1], kd));
      }
    } else if (ev.type === 'up' && drag) { drag = null; lowres = false; redraw(); }
  };

  draw();
  const off = ch.subscribe((state, partial) => {
    if (partial.controller) for (const k of Object.keys(sl)) sl[k].setValue(state.controller.params[k] ?? 0);
    redraw();
  });
  return { unmount() { off(); plot.destroy(); stepPlot && stepPlot.destroy(); }, update() { redraw(); } };
}
