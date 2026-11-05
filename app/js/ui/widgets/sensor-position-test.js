// sensor-position-test: 조립 후 초음파 위치 응답 시험. 공(또는 평판)을 줄자로 잰 기준 거리(센서 앞면 → 공 앞면)에 놓고
// '이 위치 측정'을 누르면 N초 동안 D 스트림을 모아 위치별 원측정 평균·σ(튄 값 제외, robustDistStats 재사용)·튄 값 비율·필터 평균을 표로,
// 기준 거리 대비 측정 거리 직선(기울기≈1, 절편, 잔차)과 판정(hwtest.analyzeSensorPositions, 기준 상수와 근거는 hwtest.js)을 그린다.
// 가상 장치·디지털 트윈에서는 "공 옮겨 놓기(가상)" 버튼이 공을 그 위치에 놓는다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, badge, table, fmt, toast, provenanceBadge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { prereqText } from './hardware-steps.js';
import { head } from './_util.js';
import { hwModeNote, GUIDE } from '../jog.js';
import { collectSamples, analyzeSensorPositions, SPT_RESID_MAX_MM, SPT_SD_MAX_MM } from '../hwtest.js';

/** null 을 건너뛰는 append(브라우저 append(null) 은 'null' 글자를 넣는다) */
const add = (el, ...c) => el.append(...c.filter((x) => x != null && x !== false));

export const accepts = ['positions_mm', 'duration_s'];
export const WIDGET_ID = 'sensor-position-test';
const LV = { ok: ['합격', 'b-ok'], warn: ['주의', 'b-assumed'], bad: ['불합격', 'b-bad'], info: ['참고', 'b-unknown'] };

export function mount(el, props, ctx) {
  checkProps(el, WIDGET_ID, props, accepts);
  const dev = ctx.device;
  const hw = ctx.settings.hw;
  let positions = (props.positions_mm || [100, 150, 200, 250]).slice();
  let dur = props.duration_s ?? 5;
  const data = new Map(); // ref_mm → { dist, filt }
  let busy = null, result = null, prov = null;
  const tag = h('span');
  el.appendChild(head('초음파 위치 응답 시험', tag));
  const note = h('div');
  const posIn = h('input', { type: 'text', class: 'num-wide', value: positions.join(', '), onchange: (e) => { const a = [...new Set(String(e.target.value).split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0))].sort((x, y) => x - y); if (a.length) positions = a; e.target.value = positions.join(', '); paint(); } });
  const durIn = h('input', { type: 'number', min: 1, max: 30, step: 1, class: 'num', value: dur, onchange: (e) => { dur = Math.max(1, Math.min(30, Number(e.target.value) || 5)); e.target.value = dur; } });
  const rowsBox = h('div');
  const out = h('div');
  const msg = h('div');
  const orderBox = h('div');
  el.appendChild(orderBox);
  el.append(note, h('div', { class: 'row' }, h('label', null, '기준 거리(mm, 줄자) ', posIn), h('label', null, ' 위치마다 수집 ', durIn, ' s'),
    h('button', { class: 'btn', onclick: () => { data.clear(); result = null; paint(); } }, '모두 지우기')), rowsBox, msg, out);
  const plot = new Plot(el, { height: 200, xLabel: '기준 거리 (mm, 줄자)', yLabel: '측정 거리 (mm)' });

  const paint = () => {
    const ow = ctx.settings.hw ? prereqText(ctx.settings.hw, 'sensor-position-test') : null;
    clear(orderBox); if (ow) orderBox.appendChild(warnBox(ow));
    const m = hwModeNote(dev);
    clear(tag).append(badge(m.text, m.cls));
    add(clear(note), infoBox('방법: 빔을 수평(level-trim)으로 둔 채 공을 줄자로 잰 거리(센서 앞면 → 공 앞면)에 놓고, 손을 떼고 공이 멈춘 다음 "이 위치 측정"을 누릅니다. 순서대로 위치를 옮기며 반복합니다. 공이 구르면 얇은 받침(테이프)으로 고정하거나 평판을 세워도 됩니다.'),
      m.real ? null : infoBox('가상 장치: "공 옮겨 놓기(가상)"로 공을 그 위치에 놓습니다. 결과는 [시뮬레이션]입니다.'));
    clear(rowsBox).appendChild(table(['기준 거리', '안내', '측정', '상태'], positions.map((p) => {
      const d = data.get(p);
      const sim = dev && dev.virtual && dev.virtual.placeBall;
      return [`${p} mm`, `공을 ${p} mm 에 놓으세요`,
        h('span', null, sim ? h('button', { class: 'btn small', disabled: !!busy, onclick: () => place(p) }, '공 옮겨 놓기(가상)') : null, ' ',
          h('button', { class: 'btn small primary', disabled: !!busy, onclick: () => measure(p) }, busy === p ? '측정 중…' : '이 위치 측정')),
        d ? `${d.dist.length}개 수집` : '미측정'];
    })));
    show();
  };

  const show = () => {
    clear(out);
    const rows = positions.filter((p) => data.has(p)).map((p) => ({ ref_mm: p, ...data.get(p) }));
    if (!rows.length) { plot.setSeries([]); return; }
    result = analyzeSensorPositions(rows);
    const R = result;
    add(out, h('h4', null, '결과 ', provenanceBadge(prov || dev.provenance), ' ', rows.length >= 2 ? badge(R.pass ? '합격' : '불합격', R.pass ? 'b-ok' : 'b-bad') : badge('위치 2곳 이상 필요', 'b-unknown')),
      table(['기준(mm)', 'n', '유실', '원측정 중앙값', '평균(튄 값 제외)', 'σ(튄 값 제외)', 'σ(MAD)', '튄 값 비율', '필터 평균', '오차(평균 − 기준)'],
        R.rows.map((r) => [r.ref_mm, r.n, r.n_lost, fmt(r.median, 0), fmt(r.mean, 1), fmt(r.sd, 2), fmt(r.mad_sd, 2), `${fmt(r.outlier_ratio * 100, 1)} %`, fmt(r.filt_mean, 1), `${r.err >= 0 ? '+' : ''}${fmt(r.err, 1)}`])),
      R.fit ? h('p', null, `직선: 측정 = ${fmt(R.fit.slope, 4)}·기준 ${R.fit.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(R.fit.intercept), 1)} mm, 잔차 최대 ${fmt(R.fit.residual_max, 1)} mm`) : null,
      h('table', { class: 'tbl' }, h('tbody', null, R.checks.map((c) => h('tr', null, h('td', null, badge(LV[c.level][0], LV[c.level][1])), h('td', null, h('b', null, c.label)), h('td', null, c.text))))),
      h('p', { class: 'muted' }, `판정: 단조 증가, 직선 잔차 ≤ ${SPT_RESID_MAX_MM} mm, 위치별 σ ≤ ${SPT_SD_MAX_MM} mm. 튄 값 비율은 경고만. 안내: `, h('a', { href: GUIDE.sonar.href }, GUIDE.sonar.label)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: rows.length < 2, onclick: () => save() }, '하드웨어 기록에 저장')));
    const xs = R.rows.map((r) => r.ref_mm);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    plot.setSeries([
      { label: '기준 = 측정', x: [lo, hi], y: [lo, hi], ...styleOf(6), dash: [4, 3], width: 1 },
      { label: '측정 평균', x: xs, y: R.rows.map((r) => r.mean), ...styleOf(0), dash: [], pointsOnly: true, marker: 'dot', markerSize: 5 },
      ...(R.fit ? [{ label: '직선 맞춤', x: [lo, hi], y: [R.fit.intercept + R.fit.slope * lo, R.fit.intercept + R.fit.slope * hi], ...styleOf(1), dash: [], width: 1.4 }] : []),
    ]);
  };

  const save = () => {
    if (!result || result.rows.length < 2) return null;
    const r = hw.recordResult(WIDGET_ID, { verdict: result.pass ? (result.checks.some((c) => c.level === 'warn') ? 'warn' : 'pass') : 'fail', provenance: (prov || dev.provenance) === 'real' ? 'measured' : 'simulated',
      summary: `${result.rows.length}곳, 기울기 ${result.fit ? fmt(result.fit.slope, 3) : '–'}, 잔차 최대 ${result.fit ? fmt(result.fit.residual_max, 1) : '–'} mm`,
      data: { rows: result.rows, fit: result.fit && { slope: result.fit.slope, intercept: result.fit.intercept, residual_max: result.fit.residual_max }, duration_s: dur } });
    toast('초음파 위치 응답 결과를 하드웨어 기록에 저장했습니다', 'ok');
    return r;
  };

  const ensure = async () => {
    if (!dev || dev.mode === 'sample') throw new Error('샘플 재생 모드에서는 할 수 없습니다. 실제 장치 또는 가상 장치로 바꾸세요(#/settings).');
    if (!dev.connected) await dev.connect();
    if (ctx.runner && ctx.runner.state === 'running') throw new Error('실험 중입니다.');
  };
  const place = async (p) => {
    clear(msg);
    try { await ensure(); dev.virtual.placeBall(p / 1000); toast(`공을 ${p} mm 에 놓았습니다(가상)`, 'info'); } catch (e) { msg.appendChild(errorBox(e.message)); }
  };
  const measure = async (p) => {
    if (busy) return;
    clear(msg);
    busy = p; paint();
    try {
      await ensure();
      prov = dev.provenance;
      const got = await collectSamples(dev, dur * 1000);
      if (got.length < 5) throw new Error('D 줄을 거의 받지 못했습니다. 연결을 확인하세요.');
      data.set(p, { dist: got.map((d) => d.dist_mm), filt: got.map((d) => d.filt_mm) });
      const i = positions.indexOf(p);
      if (i >= 0 && i + 1 < positions.length) msg.appendChild(infoBox(`다음: 공을 ${positions[i + 1]} mm 에 옮기고 "이 위치 측정"을 누르세요.`));
      if (got.some((d) => d.mode !== 0)) msg.appendChild(warnBox('측정 중 IDLE 이 아닌 구간이 있었습니다(서보가 움직였을 수 있음).'));
    } catch (e) { msg.appendChild(errorBox(e.message)); }
    busy = null; paint();
  };
  paint();
  const offSt = dev && dev.onStatus ? dev.onStatus(() => paint()) : null;
  return { unmount() { offSt && offSt(); plot.destroy(); }, measure, place, save, get result() { return result; }, setPositions: (a) => { positions = a.slice(); posIn.value = a.join(', '); paint(); }, setDuration: (s) => { dur = s; durIn.value = s; } };
}
