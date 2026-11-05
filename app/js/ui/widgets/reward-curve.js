// reward-curve: 학습 곡선(17·18·19장, ai-extension §3). source 'live' = 같은 챕터 rl-trainer·imitation-lab 진행('__ai_progress'),
// 'q' | 'es' | 'bc' | 'dagger' = 번들 결과의 curve. 이동 평균 창 smooth. 보상 정의(REWARD_INFO)를 범례 아래 적는다.

import { h, checkProps, clear, infoBox } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, kv } from './_util.js';
import { loadAI, loadBundle, aiProgress, normCurve, movingAvg, SOURCE_LABEL } from '../ai/lib.js';

export const accepts = ['source', 'smooth'];

/** Progress 배열 → 그릴 계열(종류별) */
export function curveSeries(hist, kind, smooth, prefix = '') {
  const x = hist.map((p) => p.iter);
  const ser = [];
  const p = prefix ? `${prefix} ` : '';
  if (kind === 'qlearn' || (kind == null && hist.some((q) => 'epsilon' in q || 'return' in q))) {
    const r = hist.map((q) => q.return);
    ser.push({ label: `${p}에피소드 return`, x, y: r, ...styleOf(5), width: 1, alpha: 0.35, noLegend: !!prefix });
    ser.push({ label: `${p}이동 평균(${smooth})`, x, y: movingAvg(r, smooth), ...styleOf(0), width: 2.4 });
    const gi = hist.map((q, i) => (q.greedy_return != null ? i : -1)).filter((i) => i >= 0);
    if (gi.length) ser.push({ label: `${p}탐욕 정책 평가`, x: gi.map((i) => x[i]), y: gi.map((i) => hist[i].greedy_return), ...styleOf(1), marker: 'dot', markerSize: 4, pointsOnly: true });
  } else if (kind === 'es' || (kind == null && hist.some((q) => 'center_return' in q || 'mean_return' in q))) {
    const m = hist.map((q) => q.mean_return), c = hist.map((q) => q.center_return);
    ser.push({ label: `${p}집단 평균 return`, x, y: smooth > 1 ? movingAvg(m, smooth) : m, ...styleOf(0), width: 2 });
    if (c.some(Number.isFinite)) ser.push({ label: `${p}중심 정책 return`, x, y: smooth > 1 ? movingAvg(c, smooth) : c, ...styleOf(1), width: 2.4 });
    const b = hist.map((q) => q.best_return);
    if (b.some(Number.isFinite)) ser.push({ label: `${p}집단 최고`, x, y: b, ...styleOf(5), width: 1, alpha: 0.5 });
  } else {
    // 모방 학습: 라운드별 평가 return
    const e = hist.map((q) => q.eval_return ?? q.return);
    ser.push({ label: `${p}학생 평가 return`, x, y: e, ...styleOf(0), width: 2.4, marker: 'dot', markerSize: 4 });
    const ex = hist.map((q) => q.expert_return);
    if (ex.some(Number.isFinite)) ser.push({ label: `${p}선생님(전문가) return`, x, y: ex, ...styleOf(6), width: 1.4 });
  }
  return ser;
}

export async function mount(el, props, ctx) {
  checkProps(el, 'reward-curve', props, accepts);
  const ai = await loadAI();
  const source = props.source || 'live';
  let smooth = Math.max(1, Math.round(props.smooth ?? 50));
  el.appendChild(head('보상 곡선', h('span', { class: 'muted' }, source === 'live' ? '이 챕터에서 학습 중인 결과(실시간) [시뮬레이션]' : `번들 ${SOURCE_LABEL[source] || source} 학습 기록 [시뮬레이션]`)));
  const ctl = h('div', { class: 'row' });
  const msg = h('div');
  const read = h('div', { class: 'readout' });
  el.append(ctl, msg, read);
  const plot = new Plot(el, { height: props.height_px || 230, xLabel: '에피소드 / 반복 / 라운드', yLabel: '누적 보상 return (클수록 좋음)' });
  const formula = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  el.appendChild(formula);
  const RI = ai.trainEnv && ai.trainEnv.REWARD_INFO;
  if (RI) {
    if (ctx.katex && ctx.katex.renderToString) { try { formula.innerHTML = ctx.katex.renderToString(RI.formula_tex, { throwOnError: false }); } catch { formula.textContent = RI.formula_tex; } }
    else formula.textContent = `보상 항: ${RI.terms.map((t) => `${t.label}(가중치 ${t.weight})`).join(', ')}`;
  }

  let overlay = null; // 번들 곡선 겹치기
  const kindOf = (name) => (name === 'q' ? 'qlearn' : name === 'es' ? 'es' : 'imitation');

  const render = () => {
    clear(read); clear(msg);
    let ser = [];
    if (source === 'live') {
      const st = aiProgress(ctx).get();
      const hist = st.history || [];
      if (hist.length) {
        ser = curveSeries(hist, st.kind, st.kind === 'qlearn' ? smooth : Math.min(smooth, 5));
        const last = hist[hist.length - 1];
        read.append(kv(st.label || '학습', `${last.iter} / ${last.total ?? '–'}`), h('span', { class: 'kv muted' }, st.running ? '학습 중…' : '멈춤/완료'));
        if (st.kind === 'imitation-pair' && st.history2) ser.push(...curveSeries(st.history2, 'imitation', 1, 'DAgger'));
      } else msg.appendChild(infoBox('위 학습 위젯에서 “학습 시작”을 누르면 여기에 실시간으로 그려집니다. 비교하려면 “번들 곡선 겹치기”를 누르세요.'));
    } else if (overlay === null) {
      msg.appendChild(infoBox('번들 학습 기록을 불러오는 중…'));
    }
    if (overlay && overlay.hist.length) {
      const o = curveSeries(overlay.hist, overlay.kind, overlay.kind === 'qlearn' ? smooth : 1, source === 'live' ? '번들' : '');
      if (source === 'live') o.forEach((s) => { s.alpha = (s.alpha ?? 1) * 0.55; s.dash = [5, 4]; });
      ser.push(...o);
      if (source !== 'live') {
        const last = overlay.hist[overlay.hist.length - 1];
        read.append(kv('기록 길이', overlay.hist.length), kv('마지막 값', last.return ?? last.center_return ?? last.eval_return ?? null));
      }
    } else if (overlay && !overlay.hist.length) msg.appendChild(infoBox(`번들 학습 기록(data/ai/${overlay.file})이 아직 없습니다.`));
    plot.setSeries(ser);
  };

  const loadOverlay = async (name) => {
    const b = await loadBundle(ctx, name);
    overlay = { kind: kindOf(name), hist: normCurve(b && (b.curve || b.history)), file: name };
    render();
  };

  ctl.append(h('label', null, '이동 평균 창 ', h('input', { type: 'number', min: 1, max: 1000, step: 1, value: smooth, class: 'num', onchange: (e) => { const v = Math.round(Number(e.target.value)); if (v >= 1) { smooth = v; render(); } } })));
  if (source === 'live') {
    ctl.append(h('label', null, '번들 곡선 겹치기 ', h('select', { onchange: (e) => { if (e.target.value) loadOverlay(e.target.value); else { overlay = null; render(); } } },
      [['', '없음'], ['q', 'Q-러닝'], ['es', 'ES'], ['bc', '행동복제'], ['dagger', 'DAgger']].map(([v, t]) => h('option', { value: v }, t)))));
  }
  const off = source === 'live' ? aiProgress(ctx).subscribe(() => schedule()) : null;
  let pending = false;
  const schedule = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; render(); }, 120); };
  if (source === 'live') render(); else await loadOverlay(source);
  return { unmount() { off && off(); plot.destroy(); }, render };
}
