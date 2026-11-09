// qr-explorer: Q(대각)·R → 이산 LQR 이득 K, 폐루프 극점, 스텝 응답·입력 (chapter-format §6.7, 13장).
// 설계는 lqr 제어기 자신(controllers/lqr.js의 design: stateSpace → c2d → dlqr)을 그대로 쓴다. 응답은 control.simulate.
// bind 채널에 controller { id: 'lqr', params }를 내보낸다.

import { h, checkProps, clear, errorBox, warnBox, fmt, slider, toast } from '../dom.js';
import { Plot, styleOf, COLORS } from '../plot.js';
import { need, head, kv, channel, modelFor, simRun, sendToPractice, debounceRaf, practiceParamsFor, P1 } from './_util.js';
import { initialParams } from '../param-editor.js';

export const accepts = ['plant', 'q', 'r', 'log_sliders'];

/** lqr 제어기 인스턴스로 설계 결과(순수에 가까움: 제어기 생성만) */
export function lqrDesignOf(C, model, params, Ts_s) {
  const inst = new C(params, { model, Ts_s, u_lim_rad: model.u_lim_rad });
  return inst.d;
}

export function mount(el, props, ctx) {
  checkProps(el, 'qr-explorer', props, accepts);
  if (!need(el, ctx, ['registry', 'simulate', 'plant'])) return {};
  const C = ctx.control.getController('lqr');
  const plant = props.plant || 'ball+servo';
  const practice = (ctx.chapter && ctx.chapter.practice) || null;
  const pp = practiceParamsFor(practice, 'lqr');
  const q = props.q || {};
  let params = initialParams(C.meta, { safe: pp.safe, given: { ...(q.e != null ? { q_e: q.e } : {}), ...(q.edot != null ? { q_edot: q.edot } : {}), ...(q.theta != null ? { q_theta: q.theta } : {}), ...(props.r != null ? { r: props.r } : {}) } });
  const ch = channel(ctx, props, { controller: { id: 'lqr', params }, plant });
  const log = props.log_sliders !== false;
  el.appendChild(head('Q/R 탐색 (이산 LQR)', h('span', { class: 'muted' }, 'J = Σ (xᵀQx + R u²), u = −Kx')));
  const sl = h('div');
  const read = h('div', { class: 'readout' });
  const msg = h('div');
  const acts = h('div', { class: 'row' });
  el.append(sl, read, msg, acts);
  const grid = h('div', { class: 'grid2' });
  el.appendChild(grid);
  const cP = h('div'), cY = h('div');
  grid.append(cP, cY);
  const pP = new Plot(cP, { height: 240, xLabel: 'Re(s)', yLabel: 'Im(s)', xy: true, equalAspect: true });
  const pY = new Plot(cY, { height: 150, xLabel: '시간 (s)', yLabel: '측정 거리(표면) (mm)' });
  const pU = new Plot(cY, { height: 110, xLabel: '시간 (s)', yLabel: '명령각 (°)' });
  const lim = (k, a, b) => { const l = pp.limits[k]; return l ? [Math.max(a, l[0]), Math.min(b, l[1])] : [a, b]; };
  const mk = (key, label, unit, a, b) => {
    const [mn, mx] = lim(key, a, b);
    return slider({ label, min: mn, max: mx, step: 0.01, value: Math.min(mx, Math.max(mn, params[key])), unit, log, onInput: (v) => { params = { ...params, [key]: v }; ch.set({ controller: { id: 'lqr', params } }); redraw(); } });
  };
  const rows = { q_e: mk('q_e', 'Q_e (위치)', '1/m²', 1, 1e5), q_edot: mk('q_edot', 'Q_ė (속도)', 's²/m²', 0.1, 1e4), q_theta: mk('q_theta', 'Q_θ (서보각)', '1/rad²', 0.1, 1e4), r: mk('r', 'R (입력)', '1/rad²', 0.01, 1000) };
  sl.append(...Object.values(rows));
  if (plant !== 'ball+servo') { rows.q_theta.setDisabled(true); sl.appendChild(h('div', { class: 'muted' }, '서보 무시 모델에는 θ 상태가 없어 Q_θ는 쓰이지 않습니다.')); }

  const draw = () => {
    clear(msg); clear(read);
    try {
      const model = modelFor(ctx, plant);
      const Ts = model.sensor.Ts_s;
      const d = lqrDesignOf(C, model, params, Ts);
      const K = d.K;
      read.append(...d.ss.states.map((s, i) => kv(`K_${{ y: 'e', ydot: 'ė', theta: 'θ' }[s] || s}`, K[i])), ...(params.integral ? [kv('K_i', K[d.n])] : []), kv('Ts', Ts, 's'));
      const pl = d.poles_s.filter((p) => Number.isFinite(p.re));
      const slow = pl.slice().sort((a, b) => b.re - a.re)[0];
      if (slow) read.append(kv('가장 느린 극점', `${fmt(slow.re)}${Math.abs(slow.im) > 1e-9 ? ` ± ${fmt(Math.abs(slow.im))}j` : ''}`), kv('ζ', Math.hypot(slow.re, slow.im) > 0 ? -slow.re / Math.hypot(slow.re, slow.im) : null));
      const xmin = Math.min(-1, ...pl.map((p) => p.re * 1.3));
      const ym = Math.max(1, ...pl.map((p) => Math.abs(p.im) * 1.3), Math.abs(xmin) * 0.4);
      pP.setOpts({ xRange: [xmin, Math.abs(xmin) * 0.15], yRange: [-ym, ym] });
      pP.setAnnotations([{ type: 'vline', x: 0, dash: [], color: '#999' }, { type: 'hline', y: 0, dash: [], color: '#bbb', noScale: true }]);
      pP.setSeries([{ label: '폐루프 극점(연속 등가 ln z/Ts)', x: pl.map((p) => p.re), y: pl.map((p) => p.im), color: COLORS[1], marker: 'sq', markerSize: 6, pointsOnly: true }]);
      const r = simRun(ctx, { controller: { id: 'lqr', params }, model, profile: (practice && practice.setpoint_profile && practice.controller === 'lqr') ? practice.setpoint_profile : P1 });
      const t = r.rows.map((x) => x.t_s);
      pY.setSeries([{ label: '예측 위치', x: t, y: r.rows.map((x) => x.y_mm), ...styleOf(0) }, { label: '설정값', x: t, y: r.rows.map((x) => x.ref_mm), ...styleOf(6), width: 1, step: true }]);
      pU.setSeries([{ label: '명령각', x: t, y: r.rows.map((x) => x.u_cdeg / 100), ...styleOf(1) }]);
      read.append(kv('P.O.', r.summary.po, '%'), kv('ts', r.summary.ts == null ? '미정착' : r.summary.ts, r.summary.ts == null ? '' : 's'), kv('u_rms', r.summary.u_rms, '°'), kv('포화', r.summary.u_sat_ratio != null ? r.summary.u_sat_ratio * 100 : null, '%'));
      if ((r.summary.u_sat_ratio || 0) > 0.1) msg.appendChild(warnBox('입력이 10 % 넘게 포화합니다. R을 키우거나 Q_e를 줄이세요(선형 설계 가정이 깨짐).'));
      read.appendChild(h('span', { class: 'kv muted' }, `${plant === 'ball+servo' ? '서보 포함' : '서보 무시'} 모델, 관측기 ${params.observer} [시뮬레이션]`));
    } catch (e) { msg.appendChild(errorBox(`설계 실패: ${e.message}`)); }
  };
  const redraw = debounceRaf(draw);
  acts.append(h('button', { class: 'btn', onclick: () => { sendToPractice(ctx, { id: 'lqr', params: { ...params } }); toast('Q/R을 실습 패널(LQR)로 보냈습니다', 'ok'); } }, '실습 패널에 보내기'));
  draw();
  const off = ch.subscribe((st, partial) => {
    if (partial.controller && partial.controller.id === 'lqr') { params = { ...params, ...partial.controller.params }; for (const k of Object.keys(rows)) rows[k].setValue(params[k]); redraw(); }
  });
  return { unmount() { off(); pP.destroy(); pY.destroy(); pU.destroy(); } };
}
