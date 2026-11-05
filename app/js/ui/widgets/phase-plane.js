// phase-plane: 오차 위상평면 e–ė와 슬라이딩 면 s = ė + λe = 0, 경계층 |s| ≤ Φ (chapter-format §6.7, 14장).
// 좌표는 smc 제어기와 같다: e = y − ref (metrics의 e = ref − y와 부호 반대).
// source "sim": smc 시뮬레이션(debug e, ė). "live"/"session": 행에서 e를 계산하고 ė = dbg_s − λe(smc 기록이 있을 때), 없으면 중앙 차분.
// bind 채널 상태 { smc: { lambda, eta, phi, switch, kb_error_pct } }를 smc-lab과 공유한다.

import { h, checkProps, clear, infoBox, badge, provenanceBadge } from '../dom.js';
import { Plot, styleOf, COLORS } from '../plot.js';
import { need, head, kv, channel, modelFor, debounceRaf, practiceParamsFor, sourceBadges, P1 } from './_util.js';
import { resolveSources } from '../sources.js';
import { PRACTICE_CHANNEL } from './controller-panel.js';

export const accepts = ['source', 'session', 'lambda', 'phi', 'show_surface'];

/** 행(mm) → { e_m, edot_m_s } (순수). lambda: dbg_s에서 ė를 되돌릴 때 쓴 λ */
export function phaseFromRows(rows, lambda) {
  const yk = rows.some((r) => Number.isFinite(r.y_filt_mm)) ? 'y_filt_mm' : 'y_mm';
  const t = rows.map((r) => r.t_s);
  const e = rows.map((r) => (Number.isFinite(r[yk]) && Number.isFinite(r.ref_mm) ? (r[yk] - r.ref_mm) / 1000 : NaN));
  const hasS = rows.some((r) => Number.isFinite(r.dbg_s));
  const ed = new Array(e.length).fill(NaN);
  if (hasS) for (let k = 0; k < e.length; k++) ed[k] = Number.isFinite(rows[k].dbg_s) && Number.isFinite(e[k]) ? rows[k].dbg_s - lambda * e[k] : NaN;
  else for (let k = 1; k < e.length - 1; k++) ed[k] = (e[k + 1] - e[k - 1]) / (t[k + 1] - t[k - 1]);
  return { t, e_m: e, edot_m_s: ed, from_s: hasS };
}

/** 도달 시각(첫 |s| ≤ Φ)과 도달 후 s 부호 바뀜 횟수(채터링 지표, 순수) */
export function slidingStats(t, e, ed, lambda, phi, tFrom = 0) {
  let reach = null, flips = 0, prev = 0;
  for (let k = 0; k < t.length; k++) {
    if (t[k] < tFrom || !Number.isFinite(e[k]) || !Number.isFinite(ed[k])) continue;
    const s = ed[k] + lambda * e[k];
    if (reach == null && Math.abs(s) <= phi) reach = t[k] - tFrom;
    if (reach != null) { const sg = Math.sign(s); if (prev && sg && sg !== prev) flips++; if (sg) prev = sg; }
  }
  return { reach_s: reach, flips };
}

export function mount(el, props, ctx) {
  checkProps(el, 'phase-plane', props, accepts);
  const source = props.source || 'sim';
  if (source === 'sim' && !need(el, ctx, ['simulate', 'plant'])) return {};
  const practice = (ctx.chapter && ctx.chapter.practice) || null;
  const safe = practiceParamsFor(practice, 'smc').safe;
  const init = { lambda: props.lambda ?? safe.lambda ?? 1, eta: safe.eta ?? 0.1, phi: props.phi ?? safe.phi ?? 0.05, switch: safe.switch || 'sat', kb_error_pct: 0 };
  const ch = channel(ctx, props, { smc: init });
  const tag = h('span');
  el.appendChild(head('위상평면 e–ė', tag));
  const read = h('div', { class: 'readout' });
  const msg = h('div');
  const plot = new Plot(el, { height: props.height_px || 300, xLabel: 'e = y − ref (mm)', yLabel: 'ė (mm/s)', xy: true });
  el.append(read, msg);
  const pS = source === 'sim' ? new Plot(el, { height: 120, xLabel: '시간 (s)', yLabel: 's (mm/s)' }) : null;

  const smcP = () => ({ ...init, ...(ch.get().smc || {}) });
  const draw = (e, ed, t, info = {}) => {
    const p = smcP();
    const lambda = info.lambda ?? p.lambda;
    const E = e.map((v) => v * 1000), D = ed.map((v) => v * 1000);
    const fin = E.filter(Number.isFinite);
    const span = Math.max(20, ...fin.map(Math.abs)) * 1.15;
    const ser = [{ label: '궤적', x: E, y: D, ...styleOf(0), width: 1.6 }];
    const iFirst = E.findIndex(Number.isFinite);
    if (iFirst >= 0) ser.push({ label: '시작', x: [E[iFirst]], y: [D[iFirst]], color: COLORS[2], marker: 'o', markerSize: 6, pointsOnly: true });
    const ann = [{ type: 'vline', x: 0, dash: [], color: '#bbb' }, { type: 'hline', y: 0, dash: [], color: '#bbb', noScale: true }];
    if (props.show_surface !== false) {
      const xs = [-span, span];
      ser.push({ label: `슬라이딩 면 ė = −λe (λ = ${lambda})`, x: xs, y: xs.map((x) => -lambda * x), color: COLORS[1], dash: [6, 4], width: 2 });
      if (p.phi > 0) {
        ser.push({ label: `경계층 |s| ≤ Φ (${p.phi * 1000} mm/s)`, x: xs, y: xs.map((x) => -lambda * x + p.phi * 1000), color: COLORS[3], dash: [2, 3], width: 1 });
        ser.push({ label: null, noLegend: true, x: xs, y: xs.map((x) => -lambda * x - p.phi * 1000), color: COLORS[3], dash: [2, 3], width: 1 });
      }
    }
    const dfin = D.filter(Number.isFinite);
    const dspan = Math.max(20, ...dfin.map(Math.abs)) * 1.15;
    plot.setOpts({ xRange: [-span, span], yRange: [-dspan, dspan] });
    plot.setAnnotations(ann);
    plot.setSeries(ser);
    const st = slidingStats(t, e, ed, lambda, p.phi, info.tFrom || 0);
    clear(read).append(kv('λ', lambda, '1/s'), kv('Φ', p.phi * 1000, 'mm/s'), kv('면 도달', st.reach_s == null ? '도달 못 함' : st.reach_s, st.reach_s == null ? '' : 's'), kv('도달 후 s 부호 바뀜', st.flips, '회'));
    if (info.note) read.appendChild(h('span', { class: 'kv muted' }, info.note));
    if (pS) pS.setSeries([{ label: 's = ė + λe', x: t, y: t.map((_, k) => (ed[k] + lambda * e[k]) * 1000), ...styleOf(0) }, { label: '+Φ', x: [t[0], t[t.length - 1]], y: [p.phi * 1000, p.phi * 1000], ...styleOf(3), width: 1 }, { label: '−Φ', noLegend: true, x: [t[0], t[t.length - 1]], y: [-p.phi * 1000, -p.phi * 1000], ...styleOf(3), width: 1 }]);
  };

  const drawSim = () => {
    clear(msg);
    const p = smcP();
    try {
      const model = modelFor(ctx, (practice && practice.model) || 'ball+servo');
      const params = { ...safe, lambda: p.lambda, eta: p.eta, phi: p.phi, switch: p.switch };
      const sim = ctx.control.simulate(model, { id: 'smc', params }, P1, { noise: false, kb_scale: 1 + (p.kb_error_pct || 0) / 100 });
      const e = sim.debug.map((d) => (Number.isFinite(d.e) ? d.e : NaN));
      const ed = sim.debug.map((d) => (Number.isFinite(d.edot) ? d.edot : NaN));
      // 스텝 이후만(스텝 전에는 e ≈ 0)
      const k0 = sim.t_s.findIndex((t) => t >= (P1.pre_s || 0));
      clear(tag).append(badge('시뮬레이션', 'b-sim'), badge(p.switch === 'sign' ? 'sign' : 'sat', 'b-unknown'));
      draw(e.slice(k0), ed.slice(k0), sim.t_s.slice(k0).map((t) => t - P1.pre_s), { note: `서보 포함 모델, 150→200 mm 스텝, K_b 오차 ${p.kb_error_pct || 0}% [시뮬레이션]` });
    } catch (e) { msg.appendChild(infoBox(`시뮬레이션 실패: ${e.message}`)); }
  };

  const lambdaOfMeta = (meta) => (meta && meta.controller && meta.controller.id === 'smc' && meta.controller.params ? meta.controller.params.lambda : null);
  let raf = null, alive = true, lastVer = -1, lastDraw = 0, drawn = false;
  const offs = [];
  if (source === 'sim') {
    drawSim();
    const redraw = debounceRaf(drawSim);
    offs.push(ch.subscribe((st, partial) => { if (partial.smc) redraw(); }));
  } else if (source === 'live') {
    const runner = ctx.runner;
    if (!runner) { msg.appendChild(infoBox('러너 서비스가 없습니다.')); return {}; }
    const shared = ctx.bus ? ctx.bus.channel(PRACTICE_CHANNEL) : null;
    const loop = () => {
      if (!alive) return;
      const ring = runner.ring;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (ring.version !== lastVer && now - lastDraw >= 120) {
        lastVer = ring.version; lastDraw = now;
        const rows = ring.meta && ring.meta.monitor ? [] : ring.toArray();
        if (rows.length || !drawn) clear(tag).append(runner.state === 'running' ? badge('실험 중', 'b-run') : badge(rows.length ? '마지막 실험' : '대기', 'b-unknown'), provenanceBadge(ring.meta && ring.meta.provenance));
        if (!rows.length) { if (!drawn) clear(msg).appendChild(infoBox('실습 패널에서 슬라이딩모드로 실험을 시작하면 궤적이 여기에 그려집니다.')); }
        else {
          drawn = true;
          clear(msg);
          const sc = shared && shared.get().controller;
          const lambda = sc && sc.id === 'smc' && sc.params && sc.params.lambda != null ? sc.params.lambda : smcP().lambda;
          const ph = phaseFromRows(rows, lambda);
          draw(ph.e_m, ph.edot_m_s, ph.t, { lambda, note: ph.from_s ? 'ė = s − λe (제어기 기록)' : 'ė = 중앙 차분(smc 기록 없음)' });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  } else {
    const load = async () => {
      const list = (await resolveSources(ctx, [props.session || 'chapter'], { chapterLimit: 1 })).filter((s) => s.rows);
      if (!list.length) { clear(msg).appendChild(infoBox('그릴 세션이 없습니다.')); return; }
      const s = list[0];
      const lambda = lambdaOfMeta(s.meta) ?? smcP().lambda;
      const ph = phaseFromRows(s.rows, lambda);
      clear(tag).append(h('span', { class: 'muted' }, s.label), ...sourceBadges(s));
      draw(ph.e_m, ph.edot_m_s, ph.t, { lambda, note: ph.from_s ? 'ė = s − λe (제어기 기록)' : 'ė = 중앙 차분' });
    };
    load().catch((e) => clear(msg).appendChild(infoBox(e.message)));
  }
  return { unmount() { alive = false; if (raf) cancelAnimationFrame(raf); offs.forEach((f) => f()); plot.destroy(); pS && pS.destroy(); } };
}
