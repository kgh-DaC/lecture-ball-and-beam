// model-compare: 같은 제어기를 서보 무시 / 서보 포함 모델에 넣어 근궤적·보드·스텝을 나란히 비교 + 비교 데이터(props.measured) 겹침 (chapter-format §6.4, 08장).
// 비교 데이터의 이름은 출처(provenance)로 정한다: real → "실측", simulated → "시뮬레이션"(G-3: 시뮬레이션을 실측처럼 보이게 하지 않는다).
// 계산은 analysis.closedLoop·rlocus·bode·margins, 시간 응답은 control.simulate(sources.predict), 지표는 metrics.compute.
// 근궤적 게인 K = Kp(정규화 제어기, root-locus와 같은 방식). 비교 데이터는 스텝 시작에 맞춰 겹친다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, fmt, table, provenanceWord } from '../dom.js';
import { Plot, styleOf, COLORS } from '../plot.js';
import { need, head, modelFor, cxSeries, sourceBadges, practiceController, P1 } from './_util.js';
import { normalizedParams, dominant } from './root-locus.js';
import { predict, resolveSources, stepTime } from '../sources.js';

/** 스텝 그래프 제목: 비교 데이터가 없으면 모델 예측만, 있으면 그 출처 이름을 붙인다 */
const STEP_TITLE = (word) => (word ? `스텝 응답: 모델 예측(점선 계열) vs ${word}(실선)` : '스텝 응답: 모델 예측(점선 계열)');

export const accepts = ['models', 'controller', 'views', 'measured'];
const NAME = { ball: '서보 무시', 'ball+servo': '서보 포함' };

/** 모델 하나의 해석 묶음(순수: analysis·model만 사용) */
export function analyzeModel(A, model, controller, opts = {}) {
  const common = { model, alpha: model.sensor.alpha, Ts_s: model.sensor.Ts_s, delay_s: opts.delay_s || 0, pade_order: 1 };
  const cl = A.closedLoop({ ...common, controller, step: false });
  if (!cl) throw new Error('선형 PID 계열 제어기만 비교할 수 있습니다');
  const Ln = A.closedLoop({ ...common, controller: { id: 'pid', params: normalizedParams(controller.params) }, step: false }).L;
  const kp = controller.params.kp || 0;
  const rl = A.rlocus(Ln, { kmin: 0, kmax: Math.max(10, kp * 2), n: 160 });
  const bd = A.bode(cl.L, { wmin: opts.w_range ? opts.w_range[0] : 0.1, wmax: opts.w_range ? opts.w_range[1] : 100, n: 300 });
  const mg = A.margins(cl.L);
  return { cl, rl, bd, mg, dom: dominant(cl.poles) };
}

export function mount(el, props, ctx) {
  checkProps(el, 'model-compare', props, accepts);
  if (!need(el, ctx, ['analysis', 'plant', 'simulate'])) return {};
  const A = ctx.analysis;
  const models = props.models || ['ball', 'ball+servo'];
  const views = props.views || ['rlocus', 'bode', 'step'];
  const controller = props.controller || practiceController(ctx) || { id: 'pid', params: { kp: 1, ki: 0, kd: 1, n_filt: 8, d_on: 'measurement' } };
  el.appendChild(head('서보 포함 모델 비교', h('span', { class: 'muted' }, `Kp ${fmt(controller.params.kp)} · Ki ${fmt(controller.params.ki || 0)} · Kd ${fmt(controller.params.kd || 0)}`)));
  const msg = h('div');
  const tblBox = h('div', { class: 'tbl-wrap' });
  el.append(msg, tblBox);
  const grid = h('div', { class: 'grid2' });
  el.appendChild(grid);
  const plots = [];
  const mk = (host, o) => { const p = new Plot(host, o); plots.push(p); return p; };
  const cRL = h('div'), cB = h('div');
  if (views.includes('rlocus')) grid.appendChild(cRL);
  if (views.includes('bode')) grid.appendChild(cB);
  const pRL = views.includes('rlocus') ? mk(cRL, { height: 260, xLabel: 'Re(s)', yLabel: 'Im(s)', xy: true, equalAspect: true, title: '근궤적 (K = Kp)' }) : null;
  const pMag = views.includes('bode') ? mk(cB, { height: 130, xLabel: 'ω (rad/s)', yLabel: '|L| (dB)', logX: true, title: '보드 선도(센서 필터·지연 포함)' }) : null;
  const pPh = views.includes('bode') ? mk(cB, { height: 130, xLabel: 'ω (rad/s)', yLabel: '∠L (°)', logX: true }) : null;
  const pStep = views.includes('step') ? mk(el, { height: props.height_px || 230, xLabel: '스텝 후 시간 (s)', yLabel: '위치 (mm)', title: STEP_TITLE() }) : null;
  const measNote = h('div');
  el.appendChild(measNote);

  const draw = async () => {
    clear(msg);
    const res = [];
    for (const kind of models) {
      try {
        const model = modelFor(ctx, kind);
        res.push({ kind, model, ...analyzeModel(A, model, controller) });
      } catch (e) { msg.appendChild(errorBox(`${NAME[kind] || kind} 모델 계산 오류: ${e.message}`)); }
    }
    // 근궤적
    if (pRL) {
      const ser = [];
      let xmin = -2, ymax = 1;
      res.forEach((r, i) => {
        const c = COLORS[i % COLORS.length];
        r.rl.branches.forEach((br, j) => ser.push({ ...cxSeries(br), color: c, dash: i ? [6, 4] : [], width: 1.4, alpha: 0.8, label: j === 0 ? `${NAME[r.kind] || r.kind} 근궤적` : null, noLegend: j > 0 }));
        ser.push({ ...cxSeries(r.cl.poles), color: c, marker: 'sq', markerSize: 6, pointsOnly: true, label: `${NAME[r.kind] || r.kind} 폐루프 극점` });
        for (const p of [...r.cl.poles, ...r.rl.open_poles]) if (Number.isFinite(p.re) && Math.abs(p.re) < 60) { xmin = Math.min(xmin, p.re * 1.2); ymax = Math.max(ymax, Math.abs(p.im) * 1.2); }
      });
      xmin = Math.max(xmin, -40);
      ymax = Math.max(ymax, Math.abs(xmin) * 0.5);
      pRL.setOpts({ xRange: [xmin, Math.abs(xmin) * 0.25], yRange: [-ymax, ymax] });
      pRL.setAnnotations([{ type: 'vline', x: 0, dash: [], color: '#999' }, { type: 'hline', y: 0, dash: [], color: '#bbb', noScale: true }]);
      pRL.setSeries(ser);
    }
    if (pMag) {
      pMag.setSeries(res.map((r, i) => ({ label: NAME[r.kind] || r.kind, x: r.bd.w, y: r.bd.mag_db, ...styleOf(i) })));
      pMag.setAnnotations([{ type: 'hline', y: 0, dash: [2, 3] }]);
      pPh.setSeries(res.map((r, i) => ({ label: NAME[r.kind] || r.kind, x: r.bd.w, y: r.bd.phase_deg, ...styleOf(i) })));
      pPh.setAnnotations([{ type: 'hline', y: -180, dash: [2, 3], label: '−180°' }]);
    }
    // 비교 데이터(props.measured): 이름은 provenance로 정한다
    let meas = null;
    clear(measNote);
    if (props.measured) {
      try {
        const [s] = await resolveSources(ctx, [props.measured]);
        if (s && s.rows) meas = s;
        else measNote.appendChild(infoBox(`비교 데이터(${typeof props.measured === 'string' ? props.measured : JSON.stringify(props.measured)}): ${(s && (s.message || s.error)) || '없음'}`));
      } catch (e) { measNote.appendChild(infoBox(`비교 데이터 불러오기 실패: ${e.message}`)); }
    }
    const profile = (meas && meas.meta && meas.meta.setpoint_profile && meas.meta.setpoint_profile.type === 'step') ? meas.meta.setpoint_profile : P1;
    const preds = [];
    for (const r of res) {
      try {
        const pr = predict(ctx, { controller, plant: r.kind, profile });
        if (pr) { const m = ctx.metrics.compute(pr.rows, pr.meta); preds.push({ kind: r.kind, rows: pr.rows, summary: m.summary || {} }); }
      } catch (e) { msg.appendChild(errorBox(`${NAME[r.kind]} 예측 오류: ${e.message}`)); }
    }
    const word = meas ? provenanceWord(meas) : null;
    if (pStep) {
      pStep.setOpts({ title: STEP_TITLE(word) });
      if (pStep.canvas) pStep.canvas.setAttribute('aria-label', STEP_TITLE(word));
      const ser = [];
      preds.forEach((p, i) => { const t0 = stepTime(p.rows); ser.push({ label: `예측: ${NAME[p.kind] || p.kind}`, x: p.rows.map((q) => q.t_s - t0), y: p.rows.map((q) => q.y_mm), ...styleOf(i), dash: [6, 4] }); });
      if (meas) {
        const t0 = stepTime(meas.rows);
        const yk = meas.rows.some((q) => Number.isFinite(q.y_filt_mm)) ? 'y_filt_mm' : 'y_mm';
        ser.push({ label: `${word}: ${meas.label}`, x: meas.rows.map((q) => q.t_s - t0), y: meas.rows.map((q) => q[yk]), color: '#222', dash: [], width: 2.2 });
        ser.push({ label: '설정값', x: meas.rows.map((q) => q.t_s - t0), y: meas.rows.map((q) => q.ref_mm), ...styleOf(6), width: 1, step: true });
        if (word !== '실측') measNote.appendChild(warnBox(word === '출처 미상 데이터'
          ? `비교 데이터(${meas.label})의 출처가 기록되어 있지 않습니다. 실측인지 확인할 수 없으므로 모델 검증 근거로 쓰지 마세요.`
          : `비교 데이터가 실측이 아니라 ${word}입니다(${meas.label}). 시뮬레이션은 모델로 만든 데이터라 모델이 실제 장치와 맞는지 검증하는 근거가 되지 않습니다.`));
        measNote.append(h('div', { class: 'row' }, h('span', { class: 'muted' }, `비교 데이터(${word}) 출처 `), ...sourceBadges(meas)));
        const mc = meas.meta && meas.meta.controller;
        if (mc && JSON.stringify({ kp: mc.params.kp, kd: mc.params.kd }) !== JSON.stringify({ kp: controller.params.kp, kd: controller.params.kd })) measNote.appendChild(infoBox(`${word} 세션의 게인(Kp ${fmt(mc.params.kp)}, Kd ${fmt(mc.params.kd)})이 위 제어기와 다릅니다 — 모델 차이와 게인 차이가 섞여 보입니다.`));
      } else if (preds[0]) {
        const p = preds[0]; const t0 = stepTime(p.rows);
        ser.push({ label: '설정값', x: p.rows.map((q) => q.t_s - t0), y: p.rows.map((q) => q.ref_mm), ...styleOf(6), width: 1, step: true });
      }
      pStep.setSeries(ser);
    }
    // 표
    const rows = res.map((r) => {
      const p = preds.find((q) => q.kind === r.kind) || { summary: {} };
      return [NAME[r.kind] || r.kind, r.cl.stable ? '안정' : '불안정', r.mg.pm_deg == null ? '–' : `${fmt(r.mg.pm_deg, 1)}°`, r.mg.gm_db == null ? '∞' : `${fmt(r.mg.gm_db, 1)} dB`,
        r.mg.delay_margin_s == null ? '–' : `${fmt(r.mg.delay_margin_s * 1000, 0)} ms`, r.dom ? fmt(r.dom.zeta, 2) : '–', r.dom ? fmt(r.dom.wn, 2) : '–',
        fmt(p.summary.po, 1), p.summary.ts == null ? '미정착' : fmt(p.summary.ts, 2), fmt(p.summary.itae, 0)];
    });
    if (meas) {
      const s = (meas.meta && meas.meta.metrics && meas.meta.metrics.summary) || (ctx.metrics.compute(meas.rows, meas.meta).summary || {});
      rows.push([`${word} (${meas.label})`, '–', '–', '–', '–', '–', '–', fmt(s.po, 1), s.ts == null ? '미정착' : fmt(s.ts, 2), fmt(s.itae, 0)]);
    }
    clear(tblBox).append(table(['모델', '폐루프', '위상 여유', '이득 여유', '지연 여유', '지배 ζ', 'ωn (rad/s)', 'P.O. (%)', 'ts (s)', 'ITAE'], rows),
      h('div', { class: 'muted', style: { fontSize: '.85rem' } }, '모델 행은 [시뮬레이션](잡음 없음). 서보 포함 모델은 식별 결과(없으면 가정 서보)를 씁니다.'));
  };
  draw().catch((e) => msg.appendChild(errorBox(e.message)));
  const off = ctx.samples && ctx.samples.onChange ? ctx.samples.onChange(() => draw()) : null;
  return { unmount() { off && off(); plots.forEach((p) => p.destroy()); }, update() { draw(); } };
}
