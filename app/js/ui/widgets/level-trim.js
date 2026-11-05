// level-trim: 조립 후 서보 수평 잡기. 서보를 명령 0(서보 90° + trim)으로 둔 채 trim 을 ±버튼/입력으로 조절해 장치에 바로 적용(P,trim, IDLE)하고
// 설정에 저장한다. IDLE 은 명령 0 을 유지하므로 HOST·하트비트가 필요 없다(펌웨어는 IDLE 에서 P,trim 을 받으면 바로 applyCmd(0)).
// A0 값과 기대값(보정 기록 직선의 90° + trim 값)을 함께 보이고, 수평 판정은 level-finder 의 공 굴림 속도(Theil–Sen, 튄 값에 강함)를 재사용한다.
// 수평 서보각 직접 입력: 공이 흘러가지 않는 서보각(예: 83°)을 넣으면 trim = (서보각 − 90°)·100 cdeg 로 바꿔 적용(P,trim)·저장한다(±15° = 75°~105°).
// 실제 장치에서 수평 확인이 합격이면 수평 기록(settings.hw level, #/settings 표)에도 남긴다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, badge, fmt, toast } from '../dom.js';
import { prereqText } from './hardware-steps.js';
import { head, kv } from './_util.js';
import { hwModeNote, GUIDE } from '../jog.js';
import { ballSlopeStats, levelCorrection } from './level-finder.js';
import { levelTrimHint, expectedRaw, LEVEL_FLAT_MM_S } from '../hwtest.js';
import { levelDegToTrim, trimToServoDeg, TRIM_LIMIT_CDEG } from '../../config/servo-presets.js';

/** null 을 건너뛰는 append(브라우저 append(null) 은 'null' 글자를 넣는다) */
const add = (el, ...c) => el.append(...c.filter((x) => x != null && x !== false));

export const accepts = ['step_deg', 'ball_assist'];
export const WIDGET_ID = 'level-trim';
const TRIM_MAX = TRIM_LIMIT_CDEG;

/** trim 범위 자르기(순수, protocol: ±1500 cdeg) */
export const clampTrim = (v) => Math.max(-TRIM_MAX, Math.min(TRIM_MAX, Math.round(v)));

/**
 * 수평 서보각(°) → trim 변환과 범위 판정(순수). cmd 0 에서 서보각 = 90° + trim/100 이므로 trim = (서보각 − 90°)·100 (dir 와 무관).
 * 반환 { ok, trim, deg, reason? } — ok=false 면 trim 은 잘린 값(참고용)
 */
export function trimFromServoDeg(deg) {
  const d = Number(deg);
  if (deg === '' || deg == null || !Number.isFinite(d)) return { ok: false, trim: null, deg: null, reason: '수평 서보각(°)을 넣으세요' };
  const t = levelDegToTrim(d);
  if (Math.abs(t) > TRIM_MAX) return { ok: false, trim: clampTrim(t), deg: d, reason: `trim ${t / 100}° 는 ±${TRIM_MAX / 100}° 밖입니다(서보각 ${90 - TRIM_MAX / 100}°~${90 + TRIM_MAX / 100}°만 trim 으로 맞출 수 있음). 서보 혼을 한 칸 옮겨 다시 끼우세요(servo-center-assist).` };
  return { ok: true, trim: t, deg: d };
}

export function mount(el, props, ctx) {
  checkProps(el, WIDGET_ID, props, accepts);
  const dev = ctx.device;
  const hw = ctx.settings.hw;
  const step = Math.round((props.step_deg ?? 0.1) * 100);
  const pp = (ctx.control && ctx.control.plant && ctx.control.plant.DEFAULT_PLANT_PARAMS) || { L_m: 0.34, d_m: 0.052 };
  let trim = ctx.settings.device.trim, samples = [], busy = false;
  const tag = h('span');
  el.appendChild(head('수평 찾기(trim)', tag));
  const note = h('div');
  const trimIn = h('input', { type: 'number', step: 0.05, class: 'num', value: trim / 100 });
  const alphaIn = h('input', { type: 'number', step: 0.1, class: 'num', placeholder: '예: 0.5' });
  const degIn = h('input', { type: 'number', step: 0.1, min: 90 - TRIM_MAX / 100, max: 90 + TRIM_MAX / 100, class: 'num', placeholder: '예: 83', 'data-role': 'level-deg' });
  const formula = h('div');
  const read = h('div', { class: 'readout' });
  const assist = h('div');
  const msg = h('div');
  const tb = (label, d) => h('button', { class: 'btn', onclick: () => apply(trim + d) }, label);
  const orderBox = h('div');
  el.appendChild(orderBox);
  el.append(note,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => start() }, '1. 서보를 명령 0(수평 위치)으로'), h('button', { class: 'btn estop', onclick: () => estop() }, '비상 정지(M,0)')),
    h('div', { class: 'row' }, h('b', null, '2. trim '), tb(`−${(step * 10) / 100}°`, -step * 10), tb(`−${step / 100}°`, -step), tb(`+${step / 100}°`, step), tb(`+${(step * 10) / 100}°`, step * 10),
      h('label', null, ' 직접 ', trimIn, '°'), h('button', { class: 'btn', onclick: () => apply(Number(trimIn.value) * 100) }, '적용(P,trim)')),
    h('div', { class: 'row' }, h('label', null, '수평 서보각 직접 입력 ', degIn, '°'),
      h('button', { class: 'btn', onclick: () => applyServoDeg(degIn.value) }, '서보각 → trim 으로 적용·저장')),
    formula,
    h('div', { class: 'row' }, h('label', null, '디지털 수평계 값(센서 쪽 높으면 +) ', alphaIn, '°'),
      h('button', { class: 'btn', onclick: () => { const a = Number(alphaIn.value); if (!Number.isFinite(a)) { clear(msg).appendChild(errorBox('수평계 값을 넣으세요')); return; } apply(trim + ctx.settings.device.dir * levelCorrection(a, pp.L_m, pp.d_m)); } }, '보정각만큼 trim 바꾸기(θ ≈ α·L/d)')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => saveTrim() }, '3. 이 trim 을 설정에 저장'), h('button', { class: 'btn', onclick: () => recordLevel() }, '4. 수평 확인 기록')),
    read, assist, msg);
  const offS = dev && dev.onSample ? dev.onSample((d) => { samples.push(d); if (samples.length > 200) samples.shift(); }) : null;
  const record = () => hw.activePot(ctx.settings.device.servo_model) || hw.activePot('HS5645MG');

  const guard = async (fn) => {
    if (busy) return;
    busy = true; clear(msg);
    try { await fn(); } catch (e) { msg.appendChild(errorBox(e.message)); }
    busy = false; paint();
  };
  const ensure = async () => {
    if (!dev || dev.mode === 'sample') throw new Error('샘플 재생 모드에서는 할 수 없습니다. 실제 장치 또는 가상 장치로 바꾸세요(#/settings).');
    if (!dev.connected) await dev.connect();
    if (ctx.runner && ctx.runner.state === 'running') throw new Error('실험 중입니다. 실험을 멈춘 뒤 하세요.');
    if (dev.bench) await dev.setBench(false); // 조립 후에는 벤치 모드를 쓰지 않는다
    if (dev.devMode !== 0 && dev.devMode != null) await dev.setDeviceMode(0);
  };
  const sendTrim = async (v) => {
    const r = await dev.configure({ trim: v }, ['trim']);
    const bad = r.filter((x) => !x.ok);
    if (bad.length) throw new Error(`P,trim 실패: ${bad.map((b) => b.err).join(', ')}`);
  };
  const start = () => guard(async () => { await ensure(); trim = ctx.settings.device.trim; await sendTrim(trim); trimIn.value = trim / 100; samples = []; });
  const apply = (v) => guard(async () => {
    if (!Number.isFinite(v)) throw new Error('trim 값을 넣으세요');
    const nv = clampTrim(v);
    if (Math.abs(v) > TRIM_MAX) msg.appendChild(warnBox('trim 은 ±15°까지입니다. 더 필요하면 서보 혼을 한 칸 옮겨 다시 끼우세요(servo-center-assist).'));
    await ensure();
    await sendTrim(nv);
    trim = nv; trimIn.value = nv / 100;
    samples = []; // 새 기울기에서 공 굴림을 다시 본다
  });
  /** 수평 서보각(°) → trim 적용(P,trim, 연결 가능할 때)·설정 저장. 샘플 모드·장치 없음이면 저장만 */
  const applyServoDeg = (deg) => guard(async () => {
    const c = trimFromServoDeg(deg);
    if (!c.ok) throw new Error(c.reason);
    const canSend = dev && dev.mode !== 'sample';
    if (canSend) { await ensure(); await sendTrim(c.trim); }
    trim = c.trim; trimIn.value = c.trim / 100; samples = [];
    const r = ctx.settings.save({ trim: c.trim });
    if (!r.ok) throw new Error(r.errors.join(', '));
    toast(`수평 서보각 ${c.deg}° → trim ${c.trim} cdeg ${canSend ? '적용·' : ''}저장`, 'ok');
    if (!canSend) msg.appendChild(infoBox('저장만 했습니다(샘플 재생 모드). 장치를 연결하면 P,trim 으로 보냅니다.'));
  });
  const saveTrim = () => guard(async () => {
    const r = ctx.settings.save({ trim });
    if (!r.ok) throw new Error(r.errors.join(', '));
    toast(`trim = ${trim} cdeg 저장(연결할 때마다 P,trim 으로 보냄)`, 'ok');
  });
  const recordLevel = () => {
    const stt = ballSlopeStats(samples);
    const v = stt ? stt.slope_mm_s : null;
    const hint = levelTrimHint(v, ctx.settings.device.dir);
    const pw = samples.slice(-15).map((d) => d.pot_raw);
    const a0 = pw.length ? pw.reduce((a, b) => a + b, 0) / pw.length : NaN;
    const exp = expectedRaw(record(), 90 + trim / 100);
    const saved = ctx.settings.device.trim === trim;
    const verdict = hint == null ? 'warn' : hint.flat && saved ? 'pass' : 'fail';
    hw.recordResult(WIDGET_ID, { verdict, provenance: dev.provenance === 'real' ? 'measured' : 'simulated',
      summary: `trim ${trim} cdeg${saved ? '' : '(저장 안 됨)'}, 공 속도 ${v == null ? '–' : fmt(v, 1)} mm/s, A0 ${fmt(a0, 1)}(기대 ${fmt(exp, 1)})`, data: { trim_cdeg: trim, saved, slope_mm_s: v, a0, a0_expected: exp } });
    if (verdict === 'pass' && dev.provenance === 'real' && hw.addLevel) {
      hw.addLevel({ date: new Date().toISOString().slice(0, 10), servo_model: ctx.settings.device.servo_model, level_servo_deg: trimToServoDeg(trim), dir: ctx.settings.device.dir,
        method: `level-trim 수평 확인(공 속도 ${fmt(v, 1)} mm/s)`, source: 'level-trim 위젯(실제 장치)', provenance: 'measured' });
    }
    clear(msg).appendChild(verdict === 'pass' ? infoBox('수평 확인을 기록했습니다.') : warnBox(hint == null ? '공을 빔 가운데에 올려 두고 잠시 기다린 뒤 기록하세요(공 굴림 판정 없음 → 주의로 기록).' : !hint.flat ? '아직 공이 굴러갑니다 → 불합격으로 기록. trim 을 더 조절하세요.' : 'trim 을 설정에 저장하지 않았습니다(3번) → 불합격으로 기록.'));
    paint();
  };
  const paintFormula = () => {
    const lv = hw.activeLevel ? hw.activeLevel() : null;
    clear(formula).append(h('div', { class: 'muted', style: { fontSize: '.85rem' } },
      h('div', null, '환산식(펌웨어): 서보각 = 90° + trim/100 + dir·cmd/100 [trim·cmd 단위 cdeg = 0.01°]. 명령 0(수평 위치)에서는 서보각 = 90° + trim/100 이므로'),
      h('div', null, h('b', null, 'trim = (수평 서보각 − 90°) × 100 cdeg'), ` — 예: 83° → (83 − 90) × 100 = −700 cdeg(−7°). dir 은 cmd 의 방향만 바꾸고 이 식에는 들어가지 않습니다.`),
      h('div', null, `trim 한계 ±${TRIM_MAX / 100}° → 수평 서보각 ${90 - TRIM_MAX / 100}°~${90 + TRIM_MAX / 100}° 안에서만 trim 으로 맞춥니다. 밖이면 서보 혼을 한 칸 옮겨 다시 끼우세요.`)),
    lv && lv.level_servo_deg != null ? h('div', { class: 'row', style: { fontSize: '.85rem' } },
      h('span', null, `수평 기록${lv.bundle ? '(사용자 장치 실측)' : ''}: ${lv.date || ''} 서보각 ${fmt(lv.level_servo_deg, 2)}° → trim ${lv.trim_cdeg} cdeg (dir ${lv.dir})${Number.isFinite(lv.a0_expected) ? ` · 기대 A0 ${fmt(lv.a0_expected, 1)}` : ''} `),
      badge(lv.provenance === 'measured' ? '실측' : '시뮬레이션', lv.provenance === 'measured' ? 'b-real' : 'b-sim'),
      h('button', { class: 'btn small', onclick: () => { degIn.value = lv.level_servo_deg; applyServoDeg(lv.level_servo_deg); } }, '이 서보각으로 적용'),
      dev && dev.mode !== 'device' ? h('span', { class: 'muted' }, '(실제 장치용 값 — 가상 기구·트윈은 trim 0 이 수평)') : null) : null);
  };
  const estop = async () => { try { await dev.estop(); } catch { /* */ } toast('비상 정지(M,0)', 'warn'); paint(); };

  const paint = () => {
    const ow = ctx.settings.hw ? prereqText(ctx.settings.hw, 'level-trim') : null;
    clear(orderBox); if (ow) orderBox.appendChild(warnBox(ow));
    const m = hwModeNote(dev);
    clear(tag).append(badge(m.text, m.cls));
    clear(note).appendChild(infoBox('순서: ① 디지털 수평계나 스마트폰 수평계 앱을 빔 위에 올려 대략 맞춥니다(아래 "수평계 값" 칸에 읽은 값을 넣으면 그만큼 trim 을 바꿈). ② 공을 빔 가운데에 올려 두고, 공 굴림 속도가 ±3 mm/s 안이 될 때까지 trim 을 0.1°씩 미세 조정합니다. ③ "설정에 저장" → "수평 확인 기록". 공 굴림은 초음파로 재므로 센서 연결 기본 확인(④)을 먼저 하세요.'));
    note.appendChild(m.real ? warnBox('조립이 끝난 장치에서 합니다(벤치 모드 아님). 서보는 IDLE 명령 0 에 있고 trim 만 바뀝니다 — 한 번에 1°보다 크게 바꾸지 마세요.') : infoBox('가상 장치: 가상 기구는 trim 0 이 수평입니다(연습용).'));
    paintFormula();
    const rec = record();
    const exp = expectedRaw(rec, 90 + trim / 100);
    const pw = samples.slice(-15).map((d) => d.pot_raw);
    const a0 = pw.length ? pw.reduce((a, b) => a + b, 0) / pw.length : NaN;
    const devTrim = dev.config && dev.config.trim != null ? dev.config.trim : null;
    add(clear(read), kv('장치 trim', devTrim == null ? '–' : devTrim / 100, '°'), kv('저장된 trim', ctx.settings.device.trim / 100, '°'),
      h('span', { class: 'kv', 'data-role': 'servo-deg-now' }, h('b', null, '현재 서보각 = 90° + trim = '), `90° ${trim < 0 ? '−' : '+'} ${fmt(Math.abs(trim) / 100, 2)}° = ${fmt(trimToServoDeg(trim), 2)}°`), kv('A0(최근 평균)', Number.isFinite(a0) ? fmt(a0, 1) : '–'), kv('기대 A0(보정 직선)', Number.isFinite(exp) ? fmt(exp, 1) : '–'),
      Number.isFinite(a0) && Number.isFinite(exp) ? kv('차이', fmt(a0 - exp, 1), 'LSB') : null);
    clear(assist);
    if (props.ball_assist !== false) {
      const stt = ballSlopeStats(samples);
      const v = stt ? stt.slope_mm_s : null;
      const hint = levelTrimHint(v, ctx.settings.device.dir);
      if (!hint) assist.appendChild(h('div', { class: 'muted' }, '공 굴림 판정: 공을 빔 가운데에 올려 두세요. 굴러가는 속도로 기울기를 알려 줍니다.'));
      else assist.appendChild(h('div', { class: 'row' }, h('b', null, '공 굴림 '), kv('속도(원측정, 중앙값 기울기)', v, 'mm/s'), kv('튄 값', `${stt.n_outlier}/${stt.n}`),
        hint.flat ? badge(`● 수평(|v| < ${LEVEL_FLAT_MM_S} mm/s)`, 'b-ok') : badge(`${v > 0 ? '▲ 공이 센서에서 멀어짐(센서 쪽이 높음)' : '▼ 공이 센서 쪽으로 옴(먼 쪽이 높음)'} → trim 을 ${hint.sign > 0 ? '+' : '−'} 쪽으로`, 'b-assumed')));
    }
    const lr = hw.lastResult(WIDGET_ID);
    if (lr) assist.appendChild(h('div', { class: 'muted' }, `마지막 기록: ${lr.verdict === 'pass' ? '합격' : lr.verdict === 'fail' ? '불합격' : '주의'} · ${String(lr.at).slice(0, 16).replace('T', ' ')} · ${lr.summary}`));
    assist.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, 'dir(방향) 확인은 "방향·수평 맞추기(level-finder)" 1번을 쓰세요. 안내: ', h('a', { href: GUIDE.pwm.href }, GUIDE.pwm.label)));
  };
  let t = setInterval(() => paint(), 500);
  paint();
  return { unmount() { clearInterval(t); t = null; offS && offS(); }, start, apply, applyServoDeg, saveTrim, recordLevel, get trim() { return trim; } };
}
