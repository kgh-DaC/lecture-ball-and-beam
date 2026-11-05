// policy-map: 정책 지도(17·18·19장, ai-extension §3). policyMap(policy) → (e, v) 평면에서 정책이 내는 서보 각 u.
// 옆에 같은 축의 PD 지도 u = kp·e − kd·v(포화 포함)를 그리고, 두 그림 모두에 PD의 u = 0 직선(v = kp/kd · e)을 겹친다.
// source: 'user' | 'es' | 'bc' | 'dagger' | 'q' (내가 학습한 것이 있으면 고를 수 있다). compare_pd = "kp,kd" (SI).

import { h, checkProps, clear, infoBox, fmt, slider } from '../dom.js';
import { head, kv } from './_util.js';
import { Heatmap, edgesFromCenters } from '../heatmap.js';
import { loadAI, aiState, policyCandidates, describePolicy, parseList, SOURCE_LABEL, DEG } from '../ai/lib.js';

export const accepts = ['source', 'compare_pd', 'e_range_mm', 'v_range_mm_s', 'n'];

export async function mount(el, props, ctx) {
  checkProps(el, 'policy-map', props, accepts);
  const ai = await loadAI();
  const source = props.source || 'user';
  const [kp, kd] = parseList(props.compare_pd, [0.5, 1.25]);
  const eR = parseList(props.e_range_mm, [-150, 150]).map((x) => x / 1000);
  const vR = parseList(props.v_range_mm_s, [-400, 400]).map((x) => x / 1000);
  const n = Math.max(9, Math.min(81, props.n ?? 41));
  el.appendChild(head('정책 지도', h('span', { class: 'muted' }, `${SOURCE_LABEL[source] || source} vs PD(Kp ${kp}, Kd ${kd}) · 색 = 서보 각 u (파랑 +, 주황 −) [시뮬레이션]`)));
  if (!ai.policy) { el.appendChild(infoBox('정책 모듈(control/ai/policy.js)을 불러오지 못했습니다.')); return {}; }
  const pick = h('div', { class: 'row' });
  const msg = h('div');
  const grid = h('div', { class: 'grid2' });
  const cellA = h('div'), cellB = h('div');
  grid.append(cellA, cellB);
  const read = h('div', { class: 'readout' });
  el.append(pick, msg, grid);
  const H = props.height_px || 250;
  const hmA = new Heatmap(cellA, { height: H, xLabel: 'e (mm)', yLabel: 'v (mm/s)', unit: '°', title: '학습한 정책' });
  const hmB = new Heatmap(cellB, { height: H, xLabel: 'e (mm)', yLabel: 'v (mm/s)', unit: '°', title: `PD (Kp ${kp}, Kd ${kd})` });
  let uPrev = 0, cur = null, policy = null;
  const uSl = slider({ label: '직전 u (신경망 입력)', min: -30, max: 30, step: 1, value: 0, unit: '°', onInput: (v) => { uPrev = v / DEG; draw(); } });
  el.append(uSl, read);

  const draw = () => {
    clear(read);
    if (!policy) return;
    const lim = (cur.json.u_lim_rad ?? 0.5236);
    const pm = ai.policy.policyMap(policy, { e_range_m: eR, v_range_m_s: vR, n_e: n, n_v: n, u_prev: uPrev });
    const pd = { act: (o) => Math.max(-lim, Math.min(lim, kp * o[0] - kd * o[1])) };
    const pdm = ai.policy.policyMap(pd, { e_range_m: eR, v_range_m_s: vR, n_e: n, n_v: n, u_prev: uPrev });
    const xE = edgesFromCenters(pm.e.map((x) => x * 1000)), yE = edgesFromCenters(pm.v.map((x) => x * 1000));
    const toDeg = (u) => u.map((r) => r.map((x) => x * DEG));
    // 색 범위: 학습한 정책이 실제로 내는 최대 |u|(최소 5°). PD는 그 범위 밖이면 끝색(포화처럼 보임)
    let umax = 0;
    for (const r of pm.u) for (const x of r) if (Number.isFinite(x)) umax = Math.max(umax, Math.abs(x));
    const a = Math.max(5, Math.min(lim, umax) * DEG);
    const range = [-a, a];
    // PD u = 0 직선: kp·e = kd·v → v = (kp/kd)·e  (mm 와 mm/s 비율 그대로)
    const ex = [xE[0], xE[xE.length - 1]];
    const line = kd > 0 ? { x: ex, y: ex.map((e) => (kp / kd) * e), color: '#222222', width: 1.6, dash: [6, 4], label: 'PD의 u = 0' } : null;
    hmA.set({ xEdges: xE, yEdges: yE, z: toDeg(pm.u), range, lines: line ? [line] : [] });
    hmB.set({ xEdges: xE, yEdges: yE, z: toDeg(pdm.u), range, lines: line ? [line] : [] });
    let sAbs = 0, sxy = 0, sxx = 0, syy = 0, mx = 0, my = 0, N = 0, signAgree = 0;
    pm.u.forEach((r, i) => r.forEach((u, j) => { const p = pdm.u[i][j]; N++; mx += u; my += p; }));
    mx /= N; my /= N;
    pm.u.forEach((r, i) => r.forEach((u, j) => { const p = pdm.u[i][j]; sAbs += Math.abs(u - p); sxy += (u - mx) * (p - my); sxx += (u - mx) ** 2; syy += (p - my) ** 2; if (Math.sign(u) === Math.sign(p)) signAgree++; }));
    read.append(kv('색 범위 ±', a, '°'), kv('PD와 평균 차이 |Δu|', (sAbs / N) * DEG, '°'), kv('상관계수', sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null), kv('부호 일치', (signAgree / N) * 100, '%'),
      h('span', { class: 'kv muted' }, `${cur.label} — ${describePolicy(cur.json)}`));
  };

  const select = (c) => {
    cur = c; clear(msg);
    if (!c) { policy = null; msg.appendChild(infoBox(`${SOURCE_LABEL[source] || source} 정책이 아직 없습니다. 학습 위젯에서 학습하거나 번들 결과(data/ai/)를 준비하세요.`)); clear(read); return; }
    try { policy = ai.policy.policyFromJSON(c.json); } catch (e) { policy = null; msg.appendChild(infoBox(`정책을 읽지 못했습니다: ${e.message}`)); return; }
    if (source === 'user' && c.origin !== 'user') msg.appendChild(infoBox('아직 이 챕터에서 학습한 정책이 없어 번들(사전 학습) 정책을 보여 줍니다.'));
    uSl.setDisabled(policy.kind === 'q');
    if (policy.kind === 'q') msg.appendChild(h('div', { class: 'muted' }, 'Q 표 정책은 직전 u를 보지 않으므로 슬라이더가 꺼져 있습니다. 칸 모양의 계단이 표의 구간입니다.'));
    draw();
  };

  const refresh = async () => {
    const cands = await policyCandidates(ctx, source);
    clear(pick);
    if (cands.length > 1) pick.append(h('label', null, '정책 ', h('select', { onchange: (e) => select(cands[Number(e.target.value)]) }, cands.map((c, i) => h('option', { value: i }, c.label)))));
    select(cands[0] || null);
  };
  await refresh();
  const off = aiState(ctx).subscribe(() => refresh());
  return { unmount() { off && off(); hmA.destroy(); hmB.destroy(); }, refresh };
}
