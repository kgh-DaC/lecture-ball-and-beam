// imitation-lab: 모방 학습 실험실(19장, ai-extension §3). 같은 선생님(전문가 제어기)·같은 데이터 양으로
// 행동복제(BC)와 DAgger를 나란히 학습(createImitation, Worker 2개 또는 주 스레드 청크)하고,
// 라운드별 평가 return, 분포 이동 산점도(distributionShift: 선생님이 간 상태 vs 학생이 간 상태), 평가 표(evaluatePolicy)를 보인다.
// 처음에는 번들 BC·DAgger 결과(data/ai/bc-policy.json, dagger-policy.json)를 보여 준다.

import { h, checkProps, clear, infoBox, warnBox, fmt, toast, table } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, kv, sendToPractice } from './_util.js';
import { loadAI, loadBundle, aiState, aiProgress, normCurve } from '../ai/lib.js';
import { startTask } from '../ai/runner.js';

export const accepts = ['expert', 'rounds', 'demo_episodes', 'rollouts_per_round', 'hidden', 'seed'];
const METHODS = [['bc', '행동복제(BC)'], ['dagger', 'DAgger']];

export async function mount(el, props, ctx) {
  checkProps(el, 'imitation-lab', props, accepts);
  const ai = await loadAI();
  const cfg = { expert: props.expert || 'pd', rounds: props.rounds ?? 6, demo_episodes: props.demo_episodes ?? 6, rollouts_per_round: props.rollouts_per_round ?? 4, seed: props.seed ?? 1,
    hidden: Array.isArray(props.hidden) ? props.hidden : String(props.hidden || '16,16').split(',').map(Number) };
  if (!ai.imitation || !ai.policy) {
    el.appendChild(head('모방 학습 실험실'));
    el.appendChild(infoBox('모방 학습 모듈(control/ai/imitation.js)을 불러오지 못했습니다.'));
    return {};
  }
  const EX = ai.imitation.EXPERTS[cfg.expert];
  el.appendChild(head('모방 학습 실험실: BC vs DAgger', h('span', { class: 'muted' }, `선생님 ${EX ? EX.label : cfg.expert} · 시연은 설정값 근처 시작(쉬운 상황), 평가는 넓은 시작 범위 [시뮬레이션]`)));
  const form = h('div', { class: 'row' });
  const ctl = h('div', { class: 'row' });
  const bar = h('progress', { max: 1, value: 0, style: { width: '100%' } });
  const msg = h('div');
  el.append(form, ctl, bar, msg);
  const pR = new Plot(el, { height: props.height_px || 220, xLabel: '라운드', yLabel: '평가 return (클수록 좋음)' });
  const tbl = h('div', { class: 'tbl-wrap' });
  el.appendChild(tbl);
  const dsHead = h('div', { class: 'row' });
  el.appendChild(dsHead);
  const pS = new Plot(el, { height: 240, xLabel: '오차 e (mm)', yLabel: '속도 v (mm/s)', crosshair: false });
  const dsRead = h('div', { class: 'readout' });
  el.appendChild(dsRead);

  const num = (key, label, step, title = '') => h('label', { title }, `${label} `, h('input', { type: 'number', step, min: 1, value: cfg[key], class: 'num', onchange: (e) => { const v = Math.round(Number(e.target.value)); if (v >= 1) cfg[key] = v; } }));
  form.append(num('rounds', '라운드', 1), num('demo_episodes', '첫 시연 에피소드', 1), num('rollouts_per_round', '라운드당 에피소드', 1, 'BC: 시연 추가, DAgger: 학생 주행 + 선생님 라벨'), num('seed', '시드', 1));

  // 결과 상태: method → { label, origin, policy(json), hist[] }
  const res = { bc: null, dagger: null };
  let runs = [], dsPick = 'bc';

  const drawCurves = () => {
    const ser = [];
    let expertRet = null;
    METHODS.forEach(([m, label], i) => {
      const r = res[m];
      if (!r || !r.hist.length) return;
      ser.push({ label: `${label}${r.origin === 'bundled' ? ' (번들)' : ''}`, x: r.hist.map((p) => p.iter), y: r.hist.map((p) => p.eval_return), ...styleOf(i), width: 2.4, marker: 'dot', markerSize: 4 });
      const ex = r.hist.find((p) => Number.isFinite(p.expert_return));
      if (ex) expertRet = ex.expert_return;
    });
    if (expertRet != null) pR.setAnnotations([{ type: 'hline', y: expertRet, color: '#444444', label: `선생님 return ${fmt(expertRet, 1)}` }]);
    pR.setSeries(ser);
    clear(tbl);
    const rows = METHODS.map(([m, label]) => {
      const r = res[m];
      const p = r && r.hist[r.hist.length - 1];
      return [label + (r && r.origin === 'bundled' ? ' (번들)' : r ? ' (내 학습)' : ''), p ? p.iter : '–', p ? p.dataset_size ?? '–' : '–', p ? fmt(p.eval_return, 1) : '–', p ? fmt(p.eval_rmse_m * 1000, 1) : '–', p ? `${fmt(p.eval_fail_rate * 100, 0)}%` : '–'];
    });
    tbl.appendChild(table(['방법', '라운드', '데이터 수', '평가 return', '위치 RMSE (mm)', '빔 끝 충돌률'], rows));
  };

  const drawShift = () => {
    clear(dsRead);
    const r = res[dsPick];
    if (!r || !r.policy) { pS.setSeries([]); dsRead.append(h('span', { class: 'kv muted' }, '정책이 준비되면 분포 이동 산점도를 그립니다.')); return; }
    try {
      const pol = ai.policy.policyFromJSON(r.policy);
      const d = ai.imitation.distributionShift(pol, cfg.expert, { seed: 1000, episodes: 3 });
      const sx = (a) => a.map((s) => s[0] * 1000), sy = (a) => a.map((s) => s[1] * 1000);
      pS.setSeries([
        { label: '선생님 시연이 간 상태', x: sx(d.states_expert), y: sy(d.states_expert), ...styleOf(6), pointsOnly: true, marker: 'dot', markerSize: 2.5 },
        { label: `학생(${dsPick === 'bc' ? 'BC' : 'DAgger'})이 간 상태`, x: sx(d.states_policy), y: sy(d.states_policy), ...styleOf(dsPick === 'bc' ? 0 : 1), pointsOnly: true, marker: 'dot', markerSize: 2.5 },
      ]);
      dsRead.append(kv('학생·선생님 명령 차이 평균', d.mean_abs_disagreement_rad * 180 / Math.PI, '°'), h('span', { class: 'kv muted' }, '학생이 시연에 없던 곳(회색 점 밖)으로 가면 배운 적 없는 상황이라 실수가 쌓입니다.'));
    } catch (e) { dsRead.append(h('span', { class: 'kv muted' }, `산점도를 그리지 못했습니다: ${e.message}`)); }
  };
  const renderDsHead = () => {
    clear(dsHead);
    dsHead.append(h('strong', null, '분포 이동 '), h('span', { class: 'mode-tabs' }, METHODS.map(([m, label]) => h('button', { class: dsPick === m ? 'on' : '', onclick: () => { dsPick = m; renderDsHead(); drawShift(); } }, label))));
  };

  const publishUser = () => {
    const st = {};
    if (res.bc && res.bc.origin === 'user') st.bc = res.bc.policy;
    if (res.dagger && res.dagger.origin === 'user') st.dagger = res.dagger.policy;
    const lastKey = st.dagger ? 'dagger' : st.bc ? 'bc' : null;
    if (lastKey) aiState(ctx).set({ ...st, last_policy: st[lastKey], last_policy_kind: lastKey });
  };

  const start = () => {
    if (runs.some((r) => r.running)) return;
    clear(msg);
    const prog = aiProgress(ctx);
    const hist = { bc: [], dagger: [] };
    for (const [m] of METHODS) res[m] = { label: m, origin: 'user', policy: null, hist: hist[m] };
    prog.set({ kind: 'imitation-pair', label: '내 BC (실선) / DAgger', history: hist.bc, history2: hist.dagger, running: true });
    bar.max = cfg.rounds * 2; bar.value = 0;
    startBtn.disabled = true; stopBtn.disabled = false;
    let finished = 0;
    runs = METHODS.map(([m, label]) => startTask({ kind: 'imitation', opts: { expert: cfg.expert, method: m, rounds: cfg.rounds, demo_episodes: cfg.demo_episodes, rollouts_per_round: cfg.rollouts_per_round, hidden: cfg.hidden, seed: cfg.seed } }, {
      onProgress: (items) => { hist[m].push(...items); bar.value = hist.bc.length + hist.dagger.length; drawCurves(); prog.set({ running: true }); },
      onDone: (payload, info) => {
        res[m].policy = payload.policy;
        finished++;
        msg.appendChild(h('div', { class: 'muted' }, `${label}: ${info.stopped ? '중간에 멈춤' : '완료'} · ${hist[m].length} 라운드, ${fmt(info.elapsed_ms / 1000, 1)} s${info.mode === 'worker' ? ' (Worker)' : ''}`));
        if (finished === METHODS.length) {
          startBtn.disabled = false; stopBtn.disabled = true;
          prog.set({ running: false });
          publishUser(); drawCurves(); drawShift(); sendBtns();
        }
      },
      onError: (e) => { finished++; msg.appendChild(warnBox(`${label} 학습을 끝내지 못했습니다: ${e}`)); if (finished === METHODS.length) { startBtn.disabled = false; stopBtn.disabled = true; prog.set({ running: false }); } },
    }));
    drawCurves();
  };

  const startBtn = h('button', { class: 'btn primary', onclick: start }, 'BC와 DAgger 학습');
  const stopBtn = h('button', { class: 'btn', disabled: true, onclick: () => runs.forEach((r) => r.running && r.stop()) }, '멈추기');
  const sendSpan = h('span');
  const sendBtns = () => {
    clear(sendSpan);
    for (const [m, label] of METHODS) {
      const r = res[m];
      sendSpan.appendChild(h('button', { class: 'btn', disabled: !r || !r.policy, onclick: () => {
        if (r.origin === 'user') {
          try { ai.policy.registerPolicy('user-nn', r.policy); } catch (e) { toast(e.message, 'error'); return; }
          sendToPractice(ctx, { id: 'nn-policy', params: { policy: 'user' } });
        } else sendToPractice(ctx, { id: 'nn-policy', params: { policy: m } });
        toast(`${label} 정책을 실습 패널(nn-policy)로 보냈습니다`, 'ok');
      } }, `${label} → 실습 패널`));
    }
  };
  ctl.append(startBtn, stopBtn, sendSpan);

  // 번들 결과로 시작
  for (const [m] of METHODS) {
    const b = await loadBundle(ctx, m);
    if (b && b.format === 'nn-policy') res[m] = { label: m, origin: 'bundled', policy: b, hist: normCurve(b.curve) };
  }
  if (!res.bc && !res.dagger) msg.appendChild(infoBox('번들 BC·DAgger 결과(data/ai/)가 아직 없습니다. “BC와 DAgger 학습”을 눌러 직접 만들어 보세요(수십 초).'));
  else msg.appendChild(h('div', { class: 'muted' }, '처음 그림은 번들(사전 학습) 결과입니다. 같은 조건으로 직접 학습해 비교해 보세요.'));
  renderDsHead(); drawCurves(); drawShift(); sendBtns();
  return { unmount() { runs.forEach((r) => r.running && r.cancel()); pR.destroy(); pS.destroy(); }, start };
}
