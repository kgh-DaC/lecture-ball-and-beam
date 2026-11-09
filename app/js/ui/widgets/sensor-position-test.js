// sensor-position-test: 조립 후 '실제 거리 vs 초음파 측정 거리' 검증(⑥).
// 초음파 규약(hw-records sonarConvention): 센서가 재는 거리 = 센서 앞면 → 공의 가까운 표면. 공 중심 = 측정 + 반지름(R, 기본 실측 26 mm).
// 학생은 줄자로 잰 실제 거리를 넣고 '무엇까지 쟀는지'(공 표면(센서 쪽 면) / 공 중심)를 고른다.
//   기대 측정 거리 = 표면 기준이면 입력값, 중심 기준이면 입력값 − R.
// '이 위치 측정'을 누르면 N초 동안 D 스트림을 모아 위치별 원측정 평균·σ(튄 값 제외, robustDistStats)·튄 값 비율,
// '실제 − 측정' 오차, 직선 맞춤(측정 = 기울기·기대 + 절편, 잔차), 공 중심(= 측정 + R)과 판정(hwtest.analyzeDistanceVerification)을 그린다.
// 결과는 하드웨어 기록의 '거리 검증'(settings.hw.addDistVerify)과 위젯 판정(recordResult 'sensor-position-test', ⑥ 카드)에 저장한다.
// 가상 장치·디지털 트윈: "공 옮겨 놓기(가상)"가 공을 기대 측정 거리에 놓는다(가상 장치 거리 = 측정 거리 좌표).
// 가상 장치(트윈 아님)에서는 시험용 센서 오차(상수 오차·배율)를 주입해 판정이 오차를 잡는지 볼 수 있다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, badge, table, fmt, toast, provenanceBadge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { prereqText } from './hardware-steps.js';
import { head } from './_util.js';
import { hwModeNote, GUIDE } from '../jog.js';
import { collectSamples, analyzeDistanceVerification, expectedMeasuredMm, REF_BASIS_LABEL, SPT_SD_MAX_MM, SPT_RESID_MAX_MM, DV_BIAS_MAX_MM, DV_SLOPE_MIN, DV_SLOPE_MAX } from '../hwtest.js';
import { radiusOf } from '../coord.js';

/** null 을 건너뛰는 append(브라우저 append(null) 은 'null' 글자를 넣는다) */
const add = (el, ...c) => el.append(...c.filter((x) => x != null && x !== false));
const sgn = (v, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${fmt(v, d)}` : '–');

export const accepts = ['positions_mm', 'duration_s', 'ref_basis', 'ball_radius_mm', 'inject_errors'];
export const WIDGET_ID = 'sensor-position-test';
const LV = { ok: ['합격', 'b-ok'], warn: ['주의', 'b-assumed'], bad: ['불합격', 'b-bad'], info: ['참고', 'b-unknown'] };
const VERD = { pass: ['합격', 'b-ok'], warn: ['주의', 'b-assumed'], fail: ['불합격', 'b-bad'] };

export function mount(el, props, ctx) {
  checkProps(el, WIDGET_ID, props, accepts);
  const dev = ctx.device;
  const hw = ctx.settings.hw;
  let positions = (props.positions_mm || [100, 150, 200, 250]).slice();
  let dur = props.duration_s ?? 5;
  let basis = props.ref_basis === 'center' ? 'center' : 'surface';
  const R = () => (Number.isFinite(props.ball_radius_mm) ? props.ball_radius_mm : radiusOf(ctx));
  const data = new Map(); // 실제 거리(입력) → { dist, filt }
  let busy = null, result = null, prov = null;
  const tag = h('span');
  el.appendChild(head('실제 거리 vs 초음파 측정 거리 검증', tag));
  const note = h('div');
  const posIn = h('input', { type: 'text', class: 'num-wide', 'data-role': 'positions', value: positions.join(', '), onchange: (e) => { const a = [...new Set(String(e.target.value).split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0))].sort((x, y) => x - y); if (a.length) positions = a; e.target.value = positions.join(', '); paint(); } });
  const durIn = h('input', { type: 'number', min: 1, max: 30, step: 1, class: 'num', value: dur, onchange: (e) => { dur = Math.max(1, Math.min(30, Number(e.target.value) || 5)); e.target.value = dur; } });
  const basisSel = h('select', { 'data-role': 'ref-basis', 'aria-label': '줄자로 잰 기준', onchange: (e) => { basis = e.target.value === 'center' ? 'center' : 'surface'; paint(); } },
    Object.entries(REF_BASIS_LABEL).map(([v, l]) => h('option', { value: v, selected: basis === v }, l)));
  const conv = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  const injBox = h('div');
  const rowsBox = h('div');
  const out = h('div');
  const msg = h('div');
  const orderBox = h('div');
  el.appendChild(orderBox);
  el.append(note,
    h('div', { class: 'row' }, h('label', null, '줄자로 잰 실제 거리(mm) ', posIn), h('label', null, ' 무엇까지 쟀나요? ', basisSel), h('label', null, ' 위치마다 수집 ', durIn, ' s'),
      h('button', { class: 'btn', onclick: () => { data.clear(); result = null; paint(); } }, '모두 지우기')),
    conv, injBox, rowsBox, msg, out);
  const plot = new Plot(el, { height: 210, xLabel: '기대 측정 거리 (mm, 줄자 → 표면 환산)', yLabel: '초음파 측정 거리 (mm)' });

  const expOf = (p) => expectedMeasuredMm(p, basis, R());

  const paintInject = () => {
    clear(injBox);
    const v = dev && dev.virtual;
    if (!v || v.kind !== 'virtual' || typeof v.setSensorError !== 'function' || props.inject_errors === false) return;
    const e = v.sensorError || { offset_mm: 0, scale: 1 };
    const off = h('input', { type: 'number', step: 'any', class: 'num', value: e.offset_mm, 'data-role': 'inject-offset' });
    const sc = h('input', { type: 'number', step: 'any', class: 'num', value: e.scale, 'data-role': 'inject-scale' });
    injBox.appendChild(h('details', { class: 'panel-sec' }, h('summary', null, `시험용 센서 오차 주입(가상 장치) — 지금 상수 오차 ${sgn(e.offset_mm, 1)} mm, 배율 ${fmt(e.scale, 3)}`),
      h('p', { class: 'muted' }, '판정이 오차를 잡는지 시험합니다. 보고 거리 = 배율 × 측정 거리 + 상수 오차. 실제 장치에는 없는 기능입니다.'),
      h('div', { class: 'row' }, h('label', null, '상수 오차(mm) ', off), h('label', null, ' 배율 ', sc),
        h('button', { class: 'btn small', onclick: () => { v.setSensorError({ offset_mm: Number(off.value) || 0, scale: Number(sc.value) || 1 }); toast('센서 오차를 주입했습니다(가상)', 'info'); paintInject(); } }, '적용'),
        h('button', { class: 'btn small', onclick: () => { v.setSensorError(); paintInject(); } }, '오차 없음'))));
  };

  const paint = () => {
    const ow = hw ? prereqText(hw, 'sensor-position-test') : null;
    clear(orderBox); if (ow) orderBox.appendChild(warnBox(ow));
    const m = hwModeNote(dev);
    clear(tag).append(badge(m.text, m.cls));
    const r = R();
    add(clear(note), infoBox(`방법: 빔을 수평(⑤ level-trim)으로 둔 채 공을 놓고 줄자로 센서 앞면에서 공까지의 실제 거리를 잽니다. "무엇까지 쟀는지"(공 표면(센서 쪽 면) / 공 중심)를 고르고, 손을 떼고 공이 멈춘 다음 "이 위치 측정"을 누릅니다. 공이 구르면 얇은 받침(테이프)으로 고정합니다.`),
      m.real ? null : infoBox('가상 장치: "공 옮겨 놓기(가상)"가 공을 기대 측정 거리에 놓습니다(가상 장치 거리 = 측정 거리 좌표). 결과는 [시뮬레이션]입니다.'));
    clear(conv).append(`초음파 규약: 측정 거리 = 센서 앞면 → 공의 가까운 표면. 공 중심 = 측정 + ${r} mm(반지름, `, h('a', { href: '#/settings' }, '공 크기 기록'),
      `). 기대 측정 거리 = ${basis === 'center' ? `줄자 값 − ${r} mm(중심까지 쟀음)` : '줄자 값 그대로(표면까지 쟀음)'}.`);
    paintInject();
    const sim = dev && dev.virtual && dev.virtual.placeBall;
    clear(rowsBox).appendChild(table(['실제 거리(줄자)', '기대 측정 거리(표면)', '안내', '측정', '상태'], positions.map((p) => {
      const d = data.get(p);
      const e = expOf(p);
      return [`${p} mm`, `${fmt(e, 0)} mm`, basis === 'center' ? `공 중심을 ${p} mm 에 놓으세요` : `공 표면(센서 쪽)을 ${p} mm 에 놓으세요`,
        h('span', null, sim ? h('button', { class: 'btn small', disabled: !!busy, onclick: () => place(p) }, '공 옮겨 놓기(가상)') : null, ' ',
          h('button', { class: 'btn small primary', disabled: !!busy, onclick: () => measure(p) }, busy === p ? '측정 중…' : '이 위치 측정')),
        d ? `${d.dist.length}개 수집` : '미측정'];
    })));
    show();
  };

  const show = () => {
    clear(out);
    const rows = positions.filter((p) => data.has(p)).map((p) => ({ actual_mm: p, ...data.get(p) }));
    if (!rows.length) { result = null; plot.setSeries([]); return; }
    result = analyzeDistanceVerification(rows, { basis, radius_mm: R() });
    const Q = result;
    const r = R();
    const v = VERD[Q.verdict];
    add(out, h('h4', null, '결과 ', provenanceBadge(prov || dev.provenance), ' ', rows.length >= 2 ? badge(v[0], v[1]) : badge('위치 2곳 이상 필요', 'b-unknown'), ' ', h('span', { class: 'muted' }, `기준: ${REF_BASIS_LABEL[basis]}, R ${r} mm`)),
      table(['실제(줄자)', '기대 측정(표면)', 'n', '유실', '측정 평균(튄 값 제외)', 'σ', 'σ(MAD)', '튄 값 비율', '필터 평균', '오차 = 실제 − 측정(표면 환산)', `공 중심 = 측정 + ${r}`],
        Q.rows.map((x) => [x.actual_mm, fmt(x.expected_mm, 0), x.n, x.n_lost, fmt(x.mean, 1), fmt(x.sd, 2), fmt(x.mad_sd, 2), `${fmt(x.outlier_ratio * 100, 1)} %`, fmt(x.filt_mean, 1),
          h('b', null, `${sgn(x.err_mm, 1)} mm`), `${fmt(x.center_mm, 1)} mm${basis === 'center' ? ` (실제 중심 ${x.actual_mm})` : ''}`]), { cls: 'dist-verify' }),
      Q.fit ? h('p', null, `직선 맞춤: 측정 = ${fmt(Q.fit.slope, 4)} × 기대 ${Q.fit.intercept < 0 ? '−' : '+'} ${fmt(Math.abs(Q.fit.intercept), 1)} mm, 잔차 최대 ${fmt(Q.fit.residual_max, 1)} mm · 평균 오차 ${sgn(Q.bias_mm, 1)} mm`) : null,
      h('table', { class: 'tbl' }, h('tbody', null, Q.checks.map((c) => h('tr', null, h('td', null, badge(LV[c.level][0], LV[c.level][1])), h('td', null, h('b', null, c.label)), h('td', null, c.text))))),
      ...Q.diagnosis.map((d) => (d.kind === 'ok' ? infoBox(d.text) : warnBox(d.text))),
      h('p', { class: 'muted' }, `판정: 위치 단조 증가, 평균 |오차| ≤ ${DV_BIAS_MAX_MM} mm [제안], 기울기 ${DV_SLOPE_MIN}~${DV_SLOPE_MAX} [제안], 위치별 σ ≤ ${SPT_SD_MAX_MM} mm, 직선 잔차 ≤ ${SPT_RESID_MAX_MM} mm. 튄 값 비율은 경고만. 안내: `, h('a', { href: GUIDE.sonar.href }, GUIDE.sonar.label)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: rows.length < 2, onclick: () => save() }, '거리 검증 기록에 저장')));
    const xs = Q.rows.map((x) => x.expected_mm);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    plot.setSeries([
      { label: '측정 = 기대(이상)', x: [lo, hi], y: [lo, hi], ...styleOf(6), dash: [4, 3], width: 1 },
      { label: '측정 평균', x: xs, y: Q.rows.map((x) => x.mean), ...styleOf(0), dash: [], pointsOnly: true, marker: 'dot', markerSize: 5 },
      ...(Q.fit ? [{ label: '직선 맞춤', x: [lo, hi], y: [Q.fit.intercept + Q.fit.slope * lo, Q.fit.intercept + Q.fit.slope * hi], ...styleOf(1), dash: [], width: 1.4 }] : []),
    ]);
  };

  /** 하드웨어 기록에 저장: 거리 검증 기록 + 위젯 판정(⑥ 카드) */
  const save = () => {
    if (!result || result.rows.length < 2) return null;
    const Q = result;
    const provenance = (prov || dev.provenance) === 'real' ? 'measured' : 'simulated';
    const V = VERD[Q.verdict][0];
    const summary = `거리 검증(${basis === 'center' ? '중심' : '표면'} 기준) ${Q.rows.length}곳: 평균 오차 ${sgn(Q.bias_mm, 1)} mm, 기울기 ${Q.fit ? fmt(Q.fit.slope, 3) : '–'} — ${V}`;
    const rec = hw.addDistVerify({
      ref_basis: basis, ball_radius_mm: R(), distance_convention: 'surface', duration_s: dur, provenance, verdict: Q.verdict, summary,
      points: Q.rows.map((x) => ({ actual_mm: x.actual_mm, expected_mm: x.expected_mm, meas_mean_mm: round(x.mean, 2), sd_mm: round(x.sd, 2), outlier_ratio: round(x.outlier_ratio, 4), n: x.n, err_mm: round(x.err_mm, 2), center_mm: round(x.center_mm, 2) })),
      fit: Q.fit && { slope: round(Q.fit.slope, 5), intercept: round(Q.fit.intercept, 2), residual_max: round(Q.fit.residual_max, 2) },
      bias_mm: round(Q.bias_mm, 2), diagnosis: Q.diagnosis.map((d) => d.kind),
      checks: Q.checks.map((c) => ({ key: c.key, level: c.level })),
    });
    hw.recordResult(WIDGET_ID, { verdict: Q.verdict, provenance, summary, data: { dist_verify_id: rec.id, ref_basis: basis, rows: rec.points, fit: rec.fit, bias_mm: rec.bias_mm, duration_s: dur } });
    toast('거리 검증 결과를 하드웨어 기록에 저장했습니다', 'ok');
    return rec;
  };

  const ensure = async () => {
    if (!dev || dev.mode === 'sample') throw new Error('샘플 재생 모드에서는 할 수 없습니다. 실제 장치 또는 가상 장치로 바꾸세요(#/settings).');
    if (!dev.connected) await dev.connect();
    if (ctx.runner && ctx.runner.state === 'running') throw new Error('실험 중입니다.');
  };
  /** 가상: 실제 거리 p(줄자, 기준 방식대로)에 공을 놓는다 = 측정 거리 좌표 기대값에 놓기 */
  const place = async (p) => {
    clear(msg);
    try {
      await ensure();
      const e = expOf(p);
      dev.virtual.placeBall(e / 1000);
      toast(`공을 놓았습니다(가상): ${basis === 'center' ? `중심 ${p} mm → 측정 거리 ${fmt(e, 0)} mm` : `표면 ${p} mm`}`, 'info');
    } catch (er) { msg.appendChild(errorBox(er.message)); }
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
      if (i >= 0 && i + 1 < positions.length) msg.appendChild(infoBox(`다음: 공을 실제 거리 ${positions[i + 1]} mm(${basis === 'center' ? '중심' : '표면'})에 옮기고 "이 위치 측정"을 누르세요.`));
      if (got.some((d) => d.mode !== 0)) msg.appendChild(warnBox('측정 중 IDLE 이 아닌 구간이 있었습니다(서보가 움직였을 수 있음).'));
    } catch (er) { msg.appendChild(errorBox(er.message)); }
    busy = null; paint();
  };
  paint();
  const offSt = dev && dev.onStatus ? dev.onStatus(() => paint()) : null;
  const offHw = hw && hw.onChange ? hw.onChange(() => { if (!busy) paint(); }) : null;
  return {
    unmount() { offSt && offSt(); offHw && offHw(); plot.destroy(); },
    measure, place, save, get result() { return result; },
    setPositions: (a) => { positions = a.slice(); posIn.value = a.join(', '); paint(); },
    setDuration: (s) => { dur = s; durIn.value = s; },
    setBasis: (b) => { basis = b === 'center' ? 'center' : 'surface'; basisSel.value = basis; paint(); },
    get basis() { return basis; },
  };
}

function round(v, d) { if (!Number.isFinite(v)) return null; const k = 10 ** d; return Math.round(v * k) / k; }
