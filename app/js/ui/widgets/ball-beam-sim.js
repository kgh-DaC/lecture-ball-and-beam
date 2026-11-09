// ball-beam-sim: 빔·공 애니메이션 + y(t) (chapter-format §6.1). 계산은 control.simulate 하나.
// mode "openloop": 서보를 theta_deg로 고정. "closedloop": props.controller(없으면 챕터 practice)로 폐루프.

import { h, checkProps, slider, clear, errorBox, badge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, head, kv, modelFor, sourceBadges, practiceController } from './_util.js';
import { simToRows, resolveSources } from '../sources.js';

export const accepts = ['mode', 'theta_deg', 'controller', 'plant', 'y0_mm', 't_end_s', 'animate', 'overlay'];

const EXAG = 3; // 화면 기울기 과장 배수

export function mount(el, props, ctx) {
  checkProps(el, 'ball-beam-sim', props, accepts);
  if (!need(el, ctx, ['simulate', 'plant'])) return {};
  const mode = props.mode || 'openloop';
  const st = { theta_deg: props.theta_deg ?? 2, y0_mm: props.y0_mm ?? 170, t_end_s: props.t_end_s ?? 5 };
  const plantName = props.plant || 'ball';
  const ctrl = mode === 'closedloop' ? (props.controller || practiceController(ctx)) : null;
  if (mode === 'closedloop' && !ctrl) { el.appendChild(errorBox('closedloop 모드에는 controller가 필요합니다.')); return {}; }
  el.appendChild(head(mode === 'openloop' ? '볼앤빔 시뮬레이터 — 개루프' : '볼앤빔 시뮬레이터 — 폐루프', badge('시뮬레이션', 'b-sim'), badge(plantName === 'ball+servo' ? '서보 포함 모델' : '서보 무시 모델', 'b-unknown')));
  const cv = h('canvas', { class: 'bb-canvas', style: { width: '100%', height: '150px', display: 'block' }, 'aria-label': '빔과 공 애니메이션', role: 'img' });
  el.appendChild(cv);
  const plot = new Plot(el, { height: props.height_px || 200, xLabel: '시간 (s)', yLabel: '측정 거리 y(표면) (mm)' });
  const read = h('div', { class: 'readout' });
  el.appendChild(read);
  const ctl = h('div', { class: 'row' });
  el.appendChild(ctl);
  if (mode === 'openloop') el.appendChild(slider({ label: '서보 각 θ', min: -5, max: 5, step: 0.1, value: st.theta_deg, unit: '°', onInput: (v) => { st.theta_deg = v; run(); } }));
  el.appendChild(slider({ label: '처음 위치 y₀', min: 30, max: 310, step: 5, value: st.y0_mm, unit: 'mm', onInput: (v) => { st.y0_mm = v; run(); } }));
  const playBtn = h('button', { class: 'btn', onclick: () => { anim.t0 = null; anim.on = true; loop(); } }, '다시 재생');
  ctl.append(playBtn);
  if (ctrl) ctl.append(h('span', { class: 'muted' }, `제어기 ${ctrl.id} ${JSON.stringify(ctrl.params)}`));

  let res = null, overlay = [];
  const anim = { on: props.animate !== false, t0: null, raf: null };
  const model = () => modelFor(ctx, plantName);

  const drawScene = (t) => {
    const g = cv.getContext && cv.getContext('2d');
    if (!g || !res) return;
    const W = cv.clientWidth || 600, H = 150, dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const m = res.model;
    const L = m.plant_params.L_m;
    let k = 0;
    while (k < res.t.length - 1 && res.t[k + 1] <= t) k++;
    const theta = res.theta[k];
    const alpha = Math.asin(Math.max(-1, Math.min(1, (m.plant_params.d_m / L) * Math.sin(theta)))) * EXAG;
    const cx = 40, cy = H / 2 + 10, len = W - 80;
    const ex = cx + len * Math.cos(alpha), ey = cy + len * Math.sin(alpha); // y>0 이면 먼 쪽이 내려감(공이 멀어짐)
    g.lineWidth = 6; g.strokeStyle = '#5d6670'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
    g.fillStyle = '#0072B2'; g.fillRect(cx - 18, cy - 22, 14, 18); // 센서
    g.fillStyle = '#5d6670'; g.font = '11px sans-serif'; g.fillText('센서', cx - 22, cy - 26);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - 10, cy + 40); g.lineTo(cx + 10, cy + 40); g.closePath(); g.fill(); // 받침
    const fr = res.y[k] / L;
    const bx = cx + len * fr * Math.cos(alpha), by = cy + len * fr * Math.sin(alpha) - 11;
    g.fillStyle = '#D55E00'; g.beginPath(); g.arc(bx, by, 10, 0, 2 * Math.PI); g.fill();
    if (Number.isFinite(res.ref[k])) { const rx = cx + len * (res.ref[k] / L) * Math.cos(alpha); g.strokeStyle = '#009E73'; g.lineWidth = 2; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(rx, cy - 40); g.lineTo(rx, cy + 20); g.stroke(); g.setLineDash([]); }
    g.fillStyle = '#1d232a';
    g.fillText(`t = ${t.toFixed(2)} s   y = ${(res.y[k] * 1000).toFixed(0)} mm   θ(서보) = ${(theta * 180 / Math.PI).toFixed(2)}°   (빔 기울기 ${EXAG}배 과장)`, 10, 14);
  };

  const loop = () => {
    if (!res) return;
    if (typeof requestAnimationFrame !== 'function') { drawScene(res.t[res.t.length - 1]); return; }
    cancelAnimationFrame(anim.raf);
    const step = (now) => {
      if (anim.t0 == null) anim.t0 = now;
      const t = (now - anim.t0) / 1000;
      const tEnd = res.t[res.t.length - 1];
      drawScene(Math.min(t, tEnd));
      plot.setAnnotations([{ type: 'vline', x: Math.min(t, tEnd), dash: [2, 2] }]);
      if (t < tEnd && anim.on) anim.raf = requestAnimationFrame(step);
    };
    anim.raf = requestAnimationFrame(step);
  };

  const run = () => {
    const m = model();
    if (!m) { clear(read).appendChild(errorBox('모델을 만들 수 없습니다')); return; }
    let sim;
    try {
      if (mode === 'openloop') {
        const profile = { type: 'const', ref_mm: st.y0_mm, duration_s: st.t_end_s };
        sim = ctx.control.simulate(m, { id: 'openloop', params: { theta: st.theta_deg * Math.PI / 180 } }, profile, { t_end_s: st.t_end_s, y0_m: st.y0_mm / 1000, noise: false, Ts_s: 0.02 });
      } else {
        const profile = (ctx.chapter && ctx.chapter.practice && ctx.chapter.practice.setpoint_profile) || { type: 'step', from_mm: st.y0_mm, to_mm: 200, pre_s: 1, hold_s: st.t_end_s - 1 };
        sim = ctx.control.simulate(m, { id: ctrl.id, params: ctrl.params }, profile, { t_end_s: st.t_end_s, y0_m: st.y0_mm / 1000, noise: false });
      }
    } catch (e) { clear(read).appendChild(errorBox(`시뮬레이션 오류: ${e.message}`)); return; }
    res = { model: m, t: sim.t_s, y: sim.y_m, theta: sim.theta_rad.map((v, i) => (Number.isFinite(v) ? v : sim.u_rad[i])), ref: mode === 'closedloop' ? sim.ref_m : sim.t_s.map(() => NaN) };
    const rows = simToRows(sim);
    const series = [{ label: '시뮬레이션 y', x: rows.map((r) => r.t_s), y: rows.map((r) => r.y_mm), ...styleOf(0) }];
    if (mode === 'closedloop') series.push({ label: '설정값', x: rows.map((r) => r.t_s), y: rows.map((r) => r.ref_mm), ...styleOf(2), width: 1.2, step: true });
    overlay.forEach((o, i) => series.push({ label: o.label, x: o.rows.map((r) => r.t_s), y: o.rows.map((r) => r.y_mm), ...styleOf(i + 3), alpha: 0.85 }));
    plot.setSeries(series);
    const endHit = sim.end_hit;
    const tHit = (() => { const L = m.plant_params.L_m; for (let i = 0; i < sim.y_m.length; i++) if (sim.y_m[i] <= 1e-4 || sim.y_m[i] >= L - 1e-4) return sim.t_s[i]; return null; })();
    clear(read).append(kv('K_b', m.K_b, 'm/s²/rad'), kv('마지막 y', rows[rows.length - 1].y_mm, 'mm'));
    if (mode === 'openloop') read.append(kv('가속도 K_b·θ', m.K_b * st.theta_deg * Math.PI / 180 * 1000, 'mm/s²'));
    if (endHit) read.appendChild(h('span', { class: 'kv', style: { color: 'var(--warn)' } }, `빔 끝 도달${tHit != null ? ` (t ≈ ${tHit.toFixed(2)} s)` : ''}`));
    anim.t0 = null;
    if (anim.on) loop(); else drawScene(res.t[res.t.length - 1]);
  };

  // 겹쳐 그릴 세션
  if (props.overlay) {
    resolveSources(ctx, props.overlay).then((list) => {
      overlay = list.filter((s) => s.rows && s.rows.length);
      for (const s of overlay) read.parentNode && el.insertBefore(h('div', { class: 'row muted' }, `겹침: ${s.label} `, ...sourceBadges(s)), ctl);
      run();
    }).catch((e) => console.warn(e));
  }
  run();
  return { unmount() { anim.on = false; typeof cancelAnimationFrame === 'function' && cancelAnimationFrame(anim.raf); plot.destroy(); }, update() { run(); } };
}
