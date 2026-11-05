// q-table-view: Q 표 히트맵(17장, ai-extension §3). qTableView(qjson) → 탭: 최대 Q(상태 가치), 탐욕 행동 u, 방문 수.
// source 'bundled' = 번들 Q 표(data/ai/q-table.json), 'user' = 같은 챕터 rl-trainer 결과(없으면 번들을 보이고 그렇다고 알림).
// 가로 = 오차 e(mm), 세로 = 속도 v(mm/s). 칸 경계는 표의 e_edges/v_edges 그대로(0 근처가 촘촘). 끝 칸은 경계 밖 전체를 뜻한다.

import { h, checkProps, clear, infoBox, fmt } from '../dom.js';
import { head, kv } from './_util.js';
import { Heatmap } from '../heatmap.js';
import { loadAI, aiState, policyCandidates, describePolicy, DEG } from '../ai/lib.js';

export const accepts = ['source'];
const TABS = [['greedy', '탐욕 행동 u (°)'], ['maxq', '최대 Q (상태 가치)'], ['visits', '방문 수']];

/** 표 경계 → 그림 경계(바깥 칸은 안쪽 칸 폭만큼 연장) */
export function plotEdges(edges) {
  const lo = edges[0] - (edges[1] - edges[0]), hi = edges[edges.length - 1] + (edges[edges.length - 1] - edges[edges.length - 2]);
  return [lo, ...edges, hi];
}

export async function mount(el, props, ctx) {
  checkProps(el, 'q-table-view', props, accepts);
  const ai = await loadAI();
  const source = props.source || 'bundled';
  el.appendChild(head('Q 표 들여다보기', h('span', { class: 'muted' }, '가로 오차 e = ref − y, 세로 속도 v = ẏ · 회색 = 한 번도 안 가 본 칸 [시뮬레이션]')));
  if (!ai.qlearn) { el.appendChild(infoBox('Q-러닝 모듈(control/ai/qlearn.js)을 불러오지 못했습니다.')); return {}; }
  const pick = h('div', { class: 'row' });
  const tabs = h('div', { class: 'mode-tabs', role: 'tablist' });
  const msg = h('div');
  const read = h('div', { class: 'readout' });
  el.append(pick, tabs, msg);
  const hm = new Heatmap(el, { height: props.height_px || 280, xLabel: '오차 e (mm)', yLabel: '속도 v (mm/s)' });
  el.appendChild(read);
  let tab = 'greedy', cur = null, view = null;

  const renderTabs = () => {
    clear(tabs);
    for (const [k, t] of TABS) tabs.appendChild(h('button', { class: tab === k ? 'on' : '', role: 'tab', 'aria-selected': tab === k, onclick: () => { tab = k; renderTabs(); draw(); } }, t));
  };

  const draw = () => {
    if (!view) return;
    const xE = plotEdges(view.e_edges).map((v) => v * 1000), yE = plotEdges(view.v_edges).map((v) => v * 1000);
    let z, unit, diverging = true;
    if (tab === 'greedy') { z = view.greedy_u.map((r) => r.map((u) => (u == null ? null : u * DEG))); unit = '°'; }
    else if (tab === 'maxq') { z = view.maxQ.map((r, iv) => r.map((q, ie) => (view.visits[iv][ie] > 0 ? q : null))); unit = 'Q'; diverging = false; }
    else { z = view.visits.map((r) => r.map((v) => (v > 0 ? Math.log10(v) : null))); unit = 'log₁₀ 방문'; diverging = false; }
    hm.opts.diverging = diverging; hm.opts.unit = unit;
    hm.set({ xEdges: xE, yEdges: yE, z,
      lines: [{ x: [xE[0], xE[xE.length - 1]], y: [0, 0], color: '#444444', width: 1, dash: [3, 3] }, { x: [0, 0], y: [yE[0], yE[yE.length - 1]], color: '#444444', width: 1, dash: [3, 3] }],
      tip: (iv, ie) => `방문 ${view.visits[iv][ie]}회${view.greedy_u[iv][ie] == null ? '' : `, 탐욕 u ${fmt(view.greedy_u[iv][ie] * DEG, 1)}°`}` });
  };

  const select = (c) => {
    cur = c; clear(msg); clear(read);
    if (!c) { view = null; msg.appendChild(infoBox('보여 줄 Q 표가 없습니다. 위 학습 위젯에서 Q-러닝을 돌리거나 번들 결과(data/ai/q-table.json)를 준비하세요.')); return; }
    try { view = ai.qlearn.qTableView(c.json); } catch (e) { view = null; msg.appendChild(infoBox(`Q 표를 읽지 못했습니다: ${e.message}`)); return; }
    if (source === 'user' && c.origin !== 'user') msg.appendChild(infoBox('아직 이 챕터에서 학습한 Q 표가 없어 번들(사전 학습) 표를 보여 줍니다. 학습이 끝나면 자동으로 바뀝니다.'));
    let nVis = 0, nAll = 0;
    view.visits.forEach((r) => r.forEach((v) => { nAll++; if (v > 0) nVis++; }));
    read.append(kv('칸', `${view.e_edges.length + 1} × ${view.v_edges.length + 1}`), kv('행동 후보', view.actions_rad.map((a) => fmt(a * DEG, 1)).join(', '), '°'), kv('가 본 칸', (nVis / nAll) * 100, '%'),
      h('span', { class: 'kv muted' }, `${c.label} — ${describePolicy(c.json)}`));
    draw();
  };

  const refresh = async () => {
    const cands = (await policyCandidates(ctx, source === 'user' ? 'q' : 'bundled')).filter((c) => c.json.format === 'q-table');
    clear(pick);
    if (cands.length > 1) pick.append(h('label', null, '표 ', h('select', { onchange: (e) => select(cands[Number(e.target.value)]) }, cands.map((c, i) => h('option', { value: i }, c.label)))));
    select(source === 'bundled' ? (cands.find((c) => c.origin === 'bundled') || cands[0]) : cands[0] || null);
  };
  renderTabs();
  await refresh();
  const off = aiState(ctx).subscribe((st, p) => { if (p && 'q' in p) refresh(); });
  return { unmount() { off && off(); hm.destroy(); }, refresh };
}
