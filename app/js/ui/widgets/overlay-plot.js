// overlay-plot: 세션·샘플·슬롯·예측 겹쳐 그리기 (chapter-format §6.4). 출처 배지(실측/시뮬레이션/조건 불명)를 항상 그린다.

import { h, checkProps, clear, infoBox, warnBox, fmt } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, sourceBadges } from './_util.js';
import { resolveSources, predict, stepTime, SIGNAL_INFO, unitOf } from '../sources.js';

export const accepts = ['sources', 'signals', 'align', 'show_metrics', 'predict'];

export function mount(el, props, ctx) {
  checkProps(el, 'overlay-plot', props, accepts);
  const refs = props.sources || ['chapter'];
  const signals = props.signals || ['y_mm', 'ref_mm'];
  const align = props.align || 'step';
  el.appendChild(head('겹쳐 보기', h('span', { class: 'muted' }, align === 'step' ? '스텝 시작을 t = 0으로 맞춤' : '기록 시작을 t = 0으로 맞춤')));
  const units = [...new Set(signals.map(unitOf))];
  const plots = units.map((u) => new Plot(el, { height: props.height_px || 230, xLabel: align === 'step' ? '스텝 후 시간 (s)' : '시간 (s)', yLabel: u === 'cdeg' ? '각도 (°)' : u === 'mm' ? '측정 거리(표면) (mm)' : u }));
  const legend = h('div');
  const msgs = h('div');
  const tbl = h('div', { class: 'tbl-wrap' });
  el.append(legend, msgs, tbl);
  let busy = false, again = false;

  const draw = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const list = await resolveSources(ctx, refs, { chapterKind: signals.some((s) => s === 'cmd_cdeg' || s === 'theta_cdeg') ? 'id' : 'control' });
      const ok = list.filter((s) => s.rows && s.rows.length);
      if (props.predict && ctx.control && ctx.control.simulate) {
        const prof = (ok.find((s) => s.meta && s.meta.setpoint_profile && s.meta.setpoint_profile.type !== 'const') || {}).meta?.setpoint_profile
          || (ctx.chapter && ctx.chapter.practice && ctx.chapter.practice.setpoint_profile) || (ok[0] && ok[0].meta && ok[0].meta.setpoint_profile);
        const lim = ctx.chapter && ctx.chapter.practice && ctx.chapter.practice.angle_limit_deg;
        let prof2 = prof;
        if (prof && prof.type === 'const' && prof.duration_s == null) prof2 = { ...prof, duration_s: 10 };
        try {
          const y0 = ok[0] && ok[0].rows.find((r) => Number.isFinite(r.y_filt_mm ?? r.y_mm));
          const pr = prof2 && predict(ctx, { controller: props.predict.controller, plant: props.predict.plant || 'ball', profile: prof2, lim_cdeg: lim != null ? lim * 100 : undefined,
            y0_m: prof2.type === 'const' && y0 ? (y0.y_filt_mm ?? y0.y_mm) / 1000 : undefined });
          if (pr) ok.push({ kind: 'prediction', id: 'prediction', label: pr.meta.title, meta: pr.meta, rows: pr.rows, provenance: 'simulated' });
        } catch (e) { console.warn('예측 실패', e); }
      }
      clear(msgs);
      for (const s of list) if (s.empty || s.error) msgs.appendChild((s.error ? warnBox : infoBox)(`${s.label || s.ref}: ${s.message || s.error}`));
      units.forEach((u, pi) => {
        const ser = [];
        ok.forEach((s, si) => {
          const t0 = align === 'step' ? stepTime(s.rows) : (s.rows[0] ? s.rows[0].t_s : 0);
          const st = styleOf(si);
          for (const sig of signals.filter((x) => unitOf(x) === u)) {
            if (!s.rows.some((r) => Number.isFinite(r[sig]))) continue;
            const sc = u === 'cdeg' ? 0.01 : 1;
            const isRef = sig === 'ref_mm';
            ser.push({ label: `${s.label} · ${(SIGNAL_INFO[sig] || {}).label || sig}`, x: s.rows.map((r) => r.t_s - t0), y: s.rows.map((r) => (typeof r[sig] === 'number' ? r[sig] * sc : NaN)),
              color: st.color, dash: isRef ? [2, 3] : sig === 'y_filt_mm' || sig === 'theta_cdeg' ? [6, 3] : st.dash, width: isRef ? 1 : s.kind === 'prediction' ? 1.6 : 2, step: isRef || sig === 'cmd_cdeg', alpha: sig === 'y_mm' && signals.includes('y_filt_mm') ? 0.55 : 1 });
          }
        });
        plots[pi].setSeries(ser);
      });
      clear(legend);
      ok.forEach((s, i) => legend.appendChild(h('div', { class: 'row', style: { margin: '.1rem 0' } }, h('span', { style: { color: styleOf(i).color, fontWeight: 700 } }, '■'), ` ${s.label} `, ...sourceBadges(s))));
      clear(tbl);
      if (props.show_metrics !== false) {
        const rows = ok.map((s) => {
          const m = s.kind === 'prediction' || !s.meta.metrics ? (ctx.metrics.compute(s.rows, s.meta).summary || {}) : (s.meta.metrics.summary || {});
          return h('tr', null, h('td', null, s.label, ' ', ...sourceBadges(s)), ...['tr', 'po', 'ts', 'ess', 'itae'].map((k) => h('td', { class: 'numc' }, k === 'ts' && m.ts == null && m.computable !== false && m.ts_settled === false ? '미정착' : fmt(m[k], k === 'itae' ? 0 : 2))),
            h('td', null, m.computable === false ? (ctx.metrics.REASON_LABEL || {})[m.reason] || m.reason || '' : ''));
        });
        if (rows.length) tbl.appendChild(h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['출처', 'tr(s)', 'P.O.(%)', 'ts(s)', 'e_ss(mm)', 'ITAE', '비고'].map((t) => h('th', null, t)))), h('tbody', null, rows)));
      }
    } catch (e) {
      clear(msgs).appendChild(warnBox(`겹쳐 보기 오류: ${e.message}`));
    } finally {
      busy = false;
      if (again) { again = false; draw(); }
    }
  };
  draw();
  const offs = [];
  if (ctx.samples && ctx.samples.onChange) offs.push(ctx.samples.onChange(() => draw()));
  if (ctx.store && ctx.store.onChange) offs.push(ctx.store.onChange((ev) => { if (ev.type === 'finish' || ev.type === 'save' || ev.type === 'delete') draw(); }));
  return { unmount() { offs.forEach((f) => f()); plots.forEach((p) => p.destroy()); }, update() { draw(); } };
}
