// nn-model-compare: 신경망 식별 모델 vs 물리 모델(서보 포함 / 공만) 다단계 예측 비교(16장, ai-extension §3).
// 계산은 control/ai/nn-id.compareModels(같은 시작 상태에서 기록된 u 열로 h 스텝 자유 예측 → 위치 RMSE).
// 지평별 RMSE 막대(작은 배수) + 예시 궤적. 기본은 번들 식별 망, 같은 챕터에서 학습하면 "내가 학습한 망"을 고를 수 있다.

import { h, checkProps, clear, infoBox, fmt, table } from '../dom.js';
import { Plot, styleOf, COLORS } from '../plot.js';
import { barChart } from '../bars.js';
import { head } from './_util.js';
import { loadAI, loadBundle, aiState, parseList } from '../ai/lib.js';

export const accepts = ['horizons'];
const NAMES = [['nn', '신경망'], ['phys_servo', '물리(서보 포함)'], ['phys_ball', '물리(공만)']];

export async function mount(el, props, ctx) {
  checkProps(el, 'nn-model-compare', props, accepts);
  const ai = await loadAI();
  const horizons = parseList(props.horizons, [1, 5, 20, 50]).map(Math.round).filter((x) => x >= 1);
  el.appendChild(head('식별 모델 비교: 다단계 예측', h('span', { class: 'muted' }, `지평 ${horizons.join(', ')} 스텝(Ts 0.06 s) 위치 RMSE · 같은 시험 궤적 [시뮬레이션]`)));
  if (!ai.nnId) { el.appendChild(infoBox('신경망 식별 모듈(control/ai/nn-id.js)을 불러오지 못했습니다.')); return {}; }
  const pick = h('div', { class: 'row' });
  const msg = h('div');
  const grid = h('div', { class: 'grid2' });
  const tbl = h('div', { class: 'tbl-wrap' });
  el.append(pick, msg, grid, tbl);
  const pY = new Plot(el, { height: props.height_px || 230, xLabel: '시간 (s)', yLabel: '위치 y (mm)' });
  let charts = [], cur = null, testTraj = null;

  const ensureTraj = () => {
    if (!testTraj) testTraj = ai.nnId.generateDataset({ n_samples: 200, seed: 1, n_test_traj: 3 }).test_traj;
    return testTraj;
  };

  const show = (c) => {
    cur = c;
    charts.forEach((x) => x.destroy()); charts = [];
    clear(grid); clear(tbl); clear(msg);
    if (!c) { msg.appendChild(infoBox('비교할 식별 신경망이 아직 없습니다. 위 학습 위젯에서 학습하거나 번들 결과(data/ai/nn-id.json)를 준비하세요.')); pY.setSeries([]); return; }
    let cmp = c.compare;
    const same = cmp && cmp.horizons && cmp.horizons.length === horizons.length && cmp.horizons.every((x, i) => x === horizons[i]);
    if (!same || !cmp.rmse_y_m) {
      try { cmp = ai.nnId.compareModels(c.model, c.test_traj || ensureTraj(), { horizons }); } catch (e) { msg.appendChild(infoBox(`비교 계산을 하지 못했습니다: ${e.message}`)); return; }
    }
    const r = cmp.rmse_y_m;
    horizons.forEach((hz, i) => {
      const cell = h('div');
      grid.appendChild(cell);
      charts.push(barChart(cell, NAMES.map(([k, label], j) => ({ label, mean: r[k][i] == null ? null : r[k][i] * 1000, color: COLORS[j], hatch: true })),
        { title: `${hz} 스텝(${fmt(hz * 0.06, 2)} s) 앞 예측`, unit: 'mm RMSE', height: 160 }));
    });
    tbl.appendChild(table(['모델', ...horizons.map((hz) => `${hz} 스텝`)], NAMES.map(([k, label]) => [label, ...r[k].map((v) => (v == null ? '–' : `${fmt(v * 1000, 2)} mm`))])));
    const ex = cmp.example;
    if (ex && ex.t_s) {
      const clip = (a) => a.map((v) => (Number.isFinite(v) && v > -0.1 && v < 0.45 ? v * 1000 : NaN));
      pY.setSeries([
        { label: '실제(가상 장치)', x: ex.t_s, y: clip(ex.y_true), ...styleOf(6), width: 2.6 },
        { label: '신경망', x: ex.t_s, y: clip(ex.y_nn), ...styleOf(0), width: 2 },
        { label: '물리(서보 포함)', x: ex.t_s, y: clip(ex.y_phys_servo), ...styleOf(1) },
        { label: '물리(공만)', x: ex.t_s, y: clip(ex.y_phys_ball), ...styleOf(2) },
      ]);
    }
    msg.appendChild(h('div', { class: 'muted' }, `${c.label}. 예시 궤적은 처음 상태만 주고 끝까지 모델 스스로 굴린 결과입니다(빔 밖으로 나간 값은 그리지 않음). 물리 모델에는 지연·속도 한계·빔 끝 멈춤판이 없습니다.`));
  };

  const refresh = async () => {
    const cands = [];
    const u = aiState(ctx).get().nn_id;
    if (u && u.model) cands.push({ label: '내가 학습한 망', model: u.model, compare: u.compare, test_traj: u.test_traj });
    const b = await loadBundle(ctx, 'nn-id');
    if (b && b.net) cands.push({ label: '번들 식별 망', model: b, compare: b.compare, test_traj: null });
    clear(pick);
    if (cands.length > 1) pick.append(h('label', null, '모델 ', h('select', { onchange: (e) => show(cands[Number(e.target.value)]) }, cands.map((c, i) => h('option', { value: i }, c.label)))));
    show(cands[0] || null);
  };
  await refresh();
  const off = aiState(ctx).subscribe((st, p) => { if (p && 'nn_id' in p) refresh(); });
  return { unmount() { off && off(); charts.forEach((x) => x.destroy()); pY.destroy(); }, refresh };
}
