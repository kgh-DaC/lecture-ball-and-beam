// pot-mapping-test: 조립 전 포텐쇼미터 매핑 시험(서보 혼만 달린 상태, 링크·빔 없음).
// 펌웨어 1.2.0 벤치 모드(P,bench,1 → 하드 한계 ±90°)로 서보각 0/90/180°를 N회씩 오가며 이동·정착 후 A0 평균 →
// 점별 평균·σ, 직선 맞춤, 기록된 기준값(보정 기록, 기본 60/330/598)과 비교 → 판정(hwtest.js 기준 상수) → '보정 기록으로 저장'.
// 안전: 시작 전 체크리스트 2개 확인, 실행 중 비상 정지 항상 활성, 끝나거나 중단되면 반드시 M,0 → P,bench,0 → trim·dir·lim 복원(hwtest.safeExitBench).
// 펌웨어 1.0.0/1.1.0(그리고 디지털 트윈)은 bench 가 없어 "펌웨어 1.2.0 업로드 필요"만 띄우고 시작하지 않는다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, badge, table, fmt, toast, provenanceBadge } from '../dom.js';
import { prereqText } from './hardware-steps.js';
import { head } from './_util.js';
import { hwModeNote } from '../jog.js';
import { runPotBench, analyzePotTest, potTestPlan, POT_SD_MAX_LSB, POT_REF_ERR_MAX_LSB, POT_RESID_MAX_LSB } from '../hwtest.js';
import { SERVO_PRESETS } from '../../config/servo-presets.js';

/** null 을 건너뛰는 append(브라우저 append(null) 은 'null' 글자를 넣는다) */
const add = (el, ...c) => el.append(...c.filter((x) => x != null && x !== false));

export const accepts = ['angles_deg', 'repeats', 'settle_s', 'avg_n', 'rate_deg_s'];
export const WIDGET_ID = 'pot-mapping-test';
const LV = { ok: ['합격', 'b-ok'], warn: ['주의', 'b-assumed'], bad: ['불합격', 'b-bad'], info: ['참고', 'b-unknown'] };

export function mount(el, props, ctx) {
  checkProps(el, WIDGET_ID, props, accepts);
  const dev = ctx.device;
  const hw = ctx.settings.hw;
  const st = { angles: (props.angles_deg || [0, 90, 180]).slice(), repeats: props.repeats ?? 10, settle_s: props.settle_s ?? 1.0, avg_n: props.avg_n ?? 10, rate: props.rate_deg_s ?? 90 };
  let running = false, abort = { aborted: false }, visits = [], result = null, lastErr = null, progress = null, provenance = null;
  const tag = h('span');
  el.appendChild(head('포텐쇼미터 매핑 시험 (조립 전)', tag));
  const note = h('div');
  const chkLink = h('input', { type: 'checkbox', onchange: () => paintBtns() });
  const chkPow = h('input', { type: 'checkbox', onchange: () => paintBtns() });
  const anglesIn = h('input', { type: 'text', value: st.angles.join(', '), class: 'num-wide', onchange: (e) => { const a = String(e.target.value).split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x)); if (a.length >= 2) st.angles = a; e.target.value = st.angles.join(', '); paint(); } });
  const repIn = h('input', { type: 'number', min: 1, max: 30, step: 1, value: st.repeats, class: 'num', onchange: (e) => { st.repeats = Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 1))); e.target.value = st.repeats; paint(); } });
  const setIn = h('input', { type: 'number', min: 0.3, max: 5, step: 0.1, value: st.settle_s, class: 'num', onchange: (e) => { st.settle_s = Math.max(0.3, Math.min(5, Number(e.target.value) || 1)); e.target.value = st.settle_s; paint(); } });
  const avgIn = h('input', { type: 'number', min: 1, max: 50, step: 1, value: st.avg_n, class: 'num', onchange: (e) => { st.avg_n = Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 10))); e.target.value = st.avg_n; paint(); } });
  const startBtn = h('button', { class: 'btn primary', onclick: () => run() }, '시험 시작');
  const stopBtn = h('button', { class: 'btn estop', onclick: () => estop() }, '비상 정지(M,0 → 벤치 해제)');
  const fwBox = h('div');
  const prog = h('div', { class: 'muted' });
  const out = h('div');
  const orderBox = h('div');
  el.appendChild(orderBox);
  el.append(note,
    h('div', { class: 'panel-sec' }, h('h4', null, '1. 시작 전 확인'),
      h('div', null, h('label', null, chkLink, ' 서보에서 링크·빔을 떼어 냈고, 혼만 달려 있습니다(혼이 0~180° 돌아도 아무것도 닿지 않음)')),
      h('div', null, h('label', null, chkPow, ' 서보 전원이 외부 5.0 V 입니다(멀티미터로 확인, 5.0 V 넘지 않음 — 와이퍼 전압 = A0 보호)'))),
    h('div', { class: 'panel-sec' }, h('h4', null, '2. 시험 설정'),
      h('div', { class: 'row' }, h('label', null, '서보각(°) ', anglesIn), h('label', null, ' 각 점 반복 N ', repIn), h('label', null, ' 정착 대기 ', setIn, ' s'), h('label', null, ' A0 평균 개수 ', avgIn))),
    fwBox, h('div', { class: 'row' }, startBtn, stopBtn), prog, out);

  const refRecord = () => hw.activePot(ctx.settings.device.servo_model) || hw.activePot('HS5645MG');
  const estimate = () => {
    const plan = potTestPlan(st.angles, st.repeats);
    let t = 0, prev = 90;
    for (const v of plan) { t += Math.abs(v.servo_deg - prev) / st.rate + st.settle_s + st.avg_n * 0.06 + 0.1; prev = v.servo_deg; }
    return { n: plan.length, s: t };
  };
  const paintBtns = () => {
    const fwOk = !dev.connected || (dev.fw && dev.fw.bench);
    startBtn.disabled = running || !chkLink.checked || !chkPow.checked || !fwOk || dev.mode === 'sample';
    stopBtn.disabled = false; // 비상 정지는 항상 누를 수 있다
  };
  const paint = () => {
    const ow = ctx.settings.hw ? prereqText(ctx.settings.hw, 'pot-mapping-test') : null;
    clear(orderBox); if (ow) orderBox.appendChild(warnBox(ow));
    const m = hwModeNote(dev);
    clear(tag).append(badge(m.text, m.cls));
    add(clear(note), warnBox('벤치 모드(펌웨어 1.2.0)는 각도 한계를 ±90°로 풉니다. 빔·링크가 달린 장치에서 하면 기구가 부서집니다 — 혼만 달린 서보에서만 하세요. 이상하면 즉시 "비상 정지".'),
      m.real ? null : infoBox('가상 장치: 사용자 실측 직선(서보 0° → 60, 90° → 330, 180° → 598) + 잡음으로 A0 값을 흉내 냅니다(연습용, 결과는 [시뮬레이션]).'));
    clear(fwBox);
    if (dev.mode === 'sample') fwBox.appendChild(infoBox('샘플 재생 모드에서는 시험할 수 없습니다. 실제 장치 또는 가상 장치로 바꾸세요(#/settings).'));
    else if (dev.connected && !(dev.fw && dev.fw.bench)) fwBox.appendChild(errorBox(`펌웨어 1.2.0 업로드 필요 — 연결된 장치(${dev.hello?.fw_ver ?? '?'})는 벤치 모드(P,bench)가 없어 ±90° 시험을 할 수 없습니다. firmware/ball_beam 1.2.0 을 올린 뒤 다시 연결하세요.`));
    else {
      const e = estimate();
      fwBox.appendChild(h('div', { class: 'muted' }, `측정 ${e.n}회(서보각 ${st.angles.join('/')}° × ${st.repeats}), 예상 약 ${Math.ceil(e.s)} s. ${dev.connected ? `펌웨어 ${dev.hello?.fw_ver} — 벤치 모드 지원` : '시작하면 연결합니다(펌웨어 1.2.0 필요).'}`));
    }
    paintBtns();
  };

  const showResult = () => {
    clear(out);
    if (lastErr) out.appendChild(errorBox(lastErr));
    if (!visits.length) return;
    const ref = refRecord();
    result = analyzePotTest(visits, ref);
    const R = result;
    add(out, h('h4', null, '3. 결과 ', provenanceBadge(provenance || dev.provenance), ' ', badge(R.pass ? '합격' : '불합격', R.pass ? 'b-ok' : 'b-bad')),
      table(['서보각(°)', 'A0 평균', 'σ (LSB)', 'n', '기준값', '오차 (LSB)'], R.points.map((p) => [p.servo_deg, fmt(p.mean, 1), fmt(p.sd, 2), p.n, p.ref_raw ?? '–', p.err == null ? '–' : `${p.err >= 0 ? '+' : ''}${fmt(p.err, 1)}`])),
      R.fit ? h('p', null, `직선: raw = ${fmt(R.fit.raw_at_0, 2)} + ${fmt(R.fit.slope_lsb_per_deg, 4)}·서보각 → 90° raw ${fmt(R.fit.raw_at_90, 1)}, 변환 cdeg = ${fmt(R.fit.a_cdeg_per_lsb, 4)}·raw ${R.fit.b_cdeg < 0 ? '−' : '+'} ${fmt(Math.abs(R.fit.b_cdeg), 1)} (혼 각도 기준), 잔차 최대 ${fmt(R.fit.residual_max_lsb, 2)} LSB`) : null,
      h('p', { class: 'muted' }, `기준: ${ref ? `${ref.bundle ? '번들 기본 ' : ''}보정 기록 ${ref.date || ref.created_at} (${ref.source || ref.method || ''})` : '없음'}. 판정 기준: 점별 σ ≤ ${POT_SD_MAX_LSB} LSB, 기준 대비 ≤ ${POT_REF_ERR_MAX_LSB} LSB, 직선 잔차 ≤ ${POT_RESID_MAX_LSB} LSB, 단조 증가.`),
      h('table', { class: 'tbl' }, h('tbody', null, R.checks.map((c) => h('tr', null, h('td', null, badge(LV[c.level][0], LV[c.level][1])), h('td', null, h('b', null, c.label)), h('td', null, c.text))))));
    const act = h('input', { type: 'checkbox', checked: R.pass });
    add(out, h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !R.fit, onclick: () => save(act.checked) }, '보정 기록으로 저장'), h('label', null, act, ' 저장 후 이 기록을 적용(러너·위젯의 A0 → 각도 변환)')));
  };

  const save = (activate = false) => {
    if (!result || !result.fit) return null;
    const prov = (provenance || dev.provenance) === 'real' ? 'measured' : 'simulated';
    const rec = hw.addPot({
      date: new Date().toISOString().slice(0, 10), servo_model: ctx.settings.device.servo_model,
      method: `pot-mapping-test: 서보각 ${st.angles.join('/')}° 각 ${st.repeats}회 이동·정착 ${st.settle_s} s 후 A0 ${st.avg_n}개 평균 (벤치 모드, ${dev.hello?.fw_ver ?? ''})`,
      source: prov === 'measured' ? '실측(pot-mapping-test)' : '가상 장치(시뮬레이션)', provenance: prov,
      points: result.points.map((p) => ({ servo_deg: p.servo_deg, raw_mean: +p.mean.toFixed(2), raw_sd: +p.sd.toFixed(3), n: p.n })),
      verdict: result.pass ? 'pass' : 'fail',
    }, { activate });
    toast(`보정 기록 저장${activate ? '·적용' : ''}: 90° raw ${fmt(rec.fit.raw_at_90, 1)}`, 'ok');
    return rec;
  };

  const run = async () => {
    if (running) return;
    clear(out); lastErr = null; visits = []; result = null;
    if (!chkLink.checked || !chkPow.checked) { out.appendChild(errorBox('시작 전 확인 두 가지를 먼저 체크하세요.')); return; }
    if (ctx.runner && ctx.runner.state === 'running') { out.appendChild(errorBox('실험 중입니다. 실험을 멈춘 뒤 하세요.')); return; }
    running = true; abort = { aborted: false }; paint();
    try {
      if (!dev.connected) await dev.connect();
      paint();
      if (!dev.fw.bench) throw Object.assign(new Error(`펌웨어 1.2.0 업로드 필요 — 이 장치(${dev.hello?.fw_ver ?? '?'})는 벤치 모드가 없습니다. 시험을 시작하지 않았습니다.`), { needFw: true });
      provenance = dev.provenance;
      const r = await runPotBench(dev, {
        angles: st.angles, repeats: st.repeats, settle_ms: st.settle_s * 1000, avg_n: st.avg_n, rate_deg_s: st.rate, abort, restore: ctx.settings.device,
        onProgress: (p) => { progress = p; if (p.visits) visits = p.visits.slice(); prog.textContent = `${p.i}/${p.total} — 서보 ${p.servo_deg}° ${({ move: '이동 중', settle: '정착 대기', measure: 'A0 측정', done: '측정 완료' })[p.phase]}`; if (p.phase === 'done') showResult(); },
      });
      visits = r.visits;
      prog.textContent = r.aborted ? `중단됨(비상 정지) — 벤치 해제·명령 0(서보 90°)·설정 복원 완료. 측정 ${visits.length}회까지 표시` : `완료 — 벤치 해제·서보 90°·설정 복원(trim ${ctx.settings.device.trim}, dir ${ctx.settings.device.dir}, lim ${ctx.settings.device.lim})`;
    } catch (e) { lastErr = e.message; prog.textContent = ''; }
    running = false;
    showResult();
    if (result) hw.recordResult(WIDGET_ID, { verdict: abort.aborted ? 'fail' : result.pass ? 'pass' : 'fail', provenance: provenance === 'real' ? 'measured' : 'simulated', summary: `${abort.aborted ? '중단 · ' : ''}90° raw ${result.fit ? fmt(result.fit.raw_at_90, 1) : '–'}, σ최대 ${fmt(Math.max(...result.points.map((p) => p.sd)), 2)} LSB`, data: { points: result.points } });
    paint();
  };

  const estop = async () => {
    abort.aborted = true;
    try { await dev.estop(); } catch { /* */ }
    if (!running && dev.connected) { try { const { safeExitBench } = await import('../hwtest.js'); await safeExitBench(dev, ctx.settings.device); } catch { /* */ } }
    toast('비상 정지: M,0(서보 90°) — 벤치 모드를 해제합니다', 'warn');
  };

  const offSt = dev && dev.onStatus ? dev.onStatus(() => paint()) : null;
  paint();
  // 프리셋 안내(혼 각도 기준)
  const pre = SERVO_PRESETS.HS5645MG.pot_preset;
  el.appendChild(h('p', { class: 'muted', style: { fontSize: '.85rem' } }, `이 시험의 각도는 '서보 혼 각도'입니다(trim 0·dir 1, cmd = (서보각 − 90°)·100). 빔 수평은 조립 후 trim으로 맞춥니다. 번들 기본 직선: 90° raw ${fmt(pre.raw_at_90, 1)}, ${fmt(pre.slope_lsb_per_deg, 3)} LSB/°.`));
  return {
    unmount() { offSt && offSt(); if (running) estop(); },
    run, estop, save,
    get result() { return result; }, get visits() { return visits; }, get running() { return running; },
    check: (link = true, pow = true) => { chkLink.checked = link; chkPow.checked = pow; paint(); },
    set: (o) => { Object.assign(st, o); paint(); },
  };
}
