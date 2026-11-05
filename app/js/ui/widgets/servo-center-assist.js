// servo-center-assist: 조립용 서보 90° 고정.
// 펌웨어 IDLE 은 명령 0 을 유지한다(리셋 직후도 서보 90° = 9000 + trim). HOST/ID 가 아니라 IDLE 에 두고 P,trim,0 을 명시적으로 보내
// 서보를 정확히 90°에 세운다(dir 은 명령 0 에서 상관없음). 현재 A0 를 보정 기록 직선의 90° 기대값(약 329~330, ±CENTER_TOL_LSB)과 비교해
// "서보가 90°에 있음/아님"을 보이고, 조립 절차와 주의(쉬운 말)를 함께 보여 준다. 가상 장치에서도 같다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, badge, fmt, toast, provenanceBadge } from '../dom.js';
import { prereqText } from './hardware-steps.js';
import { head, kv } from './_util.js';
import { hwModeNote, GUIDE } from '../jog.js';
import { collectSamples, centerCheck, expectedRaw, CENTER_TOL_LSB } from '../hwtest.js';

/** null 을 건너뛰는 append(브라우저 append(null) 은 'null' 글자를 넣는다) */
const add = (el, ...c) => el.append(...c.filter((x) => x != null && x !== false));

export const accepts = ['tol_lsb', 'measure_s'];
export const WIDGET_ID = 'servo-center-assist';

export function mount(el, props, ctx) {
  checkProps(el, WIDGET_ID, props, accepts);
  const dev = ctx.device;
  const hw = ctx.settings.hw;
  const tol = props.tol_lsb ?? CENTER_TOL_LSB;
  const measMs = (props.measure_s ?? 1) * 1000;
  let last = null, busy = false, live = [];
  const tag = h('span');
  el.appendChild(head('조립용 서보 90° 고정', tag));
  const note = h('div');
  const read = h('div', { class: 'readout' });
  const msg = h('div');
  const btn = h('button', { class: 'btn primary', onclick: () => center() }, '서보를 90°로 고정(IDLE, trim 0)');
  const orderBox = h('div');
  el.appendChild(orderBox);
  el.append(note, h('div', { class: 'row' }, btn, h('button', { class: 'btn', onclick: () => check() }, 'A0 다시 확인'), h('button', { class: 'btn estop', onclick: () => estop() }, '비상 정지(M,0)')), read, msg,
    h('div', { class: 'panel-sec' }, h('h4', null, '조립 절차'), h('ol', null,
      h('li', null, '위 버튼을 눌러 서보를 90°에 세웁니다. "서보가 90°에 있음"이 뜨는지 봅니다.'),
      h('li', null, '서보 전원(5.0 V)을 켠 채로 둡니다. 전원이 있어야 서보가 90°를 붙잡고 있습니다.'),
      h('li', null, '빔이 수평이 되는 방향으로 서보 혼을 축에 끼웁니다. 혼 톱니 한 칸 차이가 나면 가장 수평에 가까운 칸을 고릅니다(남는 차이는 나중에 trim으로 맞춤).'),
      h('li', null, '혼 나사를 조입니다. 링크(서보 혼 ↔ 빔) 길이가 도면과 같은지, 빔이 걸리지 않는지 확인합니다.'),
      h('li', null, '조립 중에 서보 전원을 껐거나 혼이 밀렸다면, 전원을 다시 켜고 이 버튼을 한 번 더 눌러 90°로 돌린 뒤 확인합니다.'),
      h('li', null, '조립이 끝나면 센서 연결 기본 확인(④) 뒤 "수평 찾기(level-trim)"로 넘어갑니다.'))),
    h('div', { class: 'panel-sec' }, h('h4', null, '주의'), h('ul', null,
      h('li', null, '전원이 켜진 서보의 혼을 손으로 억지로 돌리지 마세요. 기어가 상하고 전원이 출렁여 보드가 리셋될 수 있습니다.'),
      h('li', null, '이상한 소리·떨림·열이 나면 "비상 정지"를 누르고 서보 전원을 끕니다.'),
      h('li', null, '시리얼 포트를 닫거나 다시 열면 Nano가 DTR 신호로 리셋됩니다. 리셋 뒤에는 trim이 0이고 IDLE이라 서보는 90°로 돌아갑니다 — 조립 중에는 그게 정상입니다.'),
      h('li', null, '이 버튼은 저장된 trim 도 0 으로 되돌립니다. 조립 뒤 수평은 level-trim 으로 다시 정합니다.'))));

  const record = () => hw.activePot(ctx.settings.device.servo_model) || hw.activePot('HS5645MG');
  const offS = dev && dev.onSample ? dev.onSample((d) => { live.push(d); if (live.length > 40) live.shift(); }) : null;
  const paint = () => {
    const ow = ctx.settings.hw ? prereqText(ctx.settings.hw, 'servo-center-assist') : null;
    clear(orderBox); if (ow) orderBox.appendChild(warnBox(ow));
    const m = hwModeNote(dev);
    clear(tag).append(badge(m.text, m.cls));
    clear(note).appendChild(m.real ? warnBox('실제 장치: 서보가 90°로 움직입니다. 손을 혼·빔에서 떼세요.') : infoBox('가상 장치: 사용자 실측 직선으로 A0 를 흉내 냅니다(연습용).'));
    const rec = record();
    const exp = expectedRaw(rec, 90);
    const cur = live.length ? live[live.length - 1] : null;
    const recent = live.slice(-15).map((d) => d.pot_raw);
    const rm = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : NaN;
    add(clear(read), kv('기대 A0(90°)', Number.isFinite(exp) ? fmt(exp, 1) : '기록 없음'), kv('허용', `±${tol}`, 'LSB'),
      kv('현재 A0', cur ? cur.pot_raw : '–'), kv('최근 평균', Number.isFinite(rm) ? fmt(rm, 1) : '–'), kv('모드', cur ? ({ 0: 'IDLE', 1: 'HOST', 2: 'ID' })[cur.mode] ?? cur.mode : '–'),
      kv('trim(장치)', dev.config && dev.config.trim != null ? dev.config.trim : '–', 'cdeg'));
    if (last) {
      add(read, last.known ? badge(last.ok ? '● 서보가 90°에 있음' : '■ 서보가 90°에 있지 않음', last.ok ? 'b-ok' : 'b-bad') : badge('판정 불가(기록 없음)', 'b-unknown'),
        last.known ? kv('차이', `${last.err >= 0 ? '+' : ''}${fmt(last.err, 1)}`, 'LSB') : null, provenanceBadge(last.provenance === 'real' ? 'real' : 'simulated'));
    }
  };

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
  };
  const check = () => guard(async () => {
    await ensure();
    const got = await collectSamples(dev, measMs, (d) => d.mode === 0);
    if (got.length < 3) throw new Error('A0 값을 받지 못했습니다(IDLE D 줄 없음). 연결을 확인하세요.');
    const mean = got.reduce((s, d) => s + d.pot_raw, 0) / got.length;
    const exp = expectedRaw(record(), 90);
    const c = centerCheck(mean, exp, tol);
    last = { ...c, mean, expected: exp, n: got.length, provenance: dev.provenance, trim: dev.config.trim };
    hw.recordResult(WIDGET_ID, { verdict: !c.known ? 'warn' : c.ok ? 'pass' : 'fail', provenance: dev.provenance === 'real' ? 'measured' : 'simulated', summary: `A0 ${fmt(mean, 1)} (기대 ${fmt(exp, 1)} ±${tol}), trim ${dev.config.trim}`, data: { mean, expected: exp, n: got.length } });
    if (c.known && !c.ok) msg.appendChild(warnBox(`A0 가 기대값과 ${fmt(Math.abs(c.err), 1)} LSB 다릅니다(허용 ±${tol}). 확인: ① 서보 전원이 5.0 V 인가(와이퍼 전압이 전원을 따라감) ② 서보가 실제로 돌았나(신호선 D9, 공통 GND) ③ 보정 기록이 이 서보의 것인가(#/settings 보정 기록) ④ 포텐쇼미터 와이퍼 배선. `,
      h('a', { href: GUIDE.wiper.href }, GUIDE.wiper.label)));
  });
  const center = () => guard(async () => {
    await ensure();
    if (dev.devMode !== 0 && dev.devMode != null) await dev.setDeviceMode(0); // IDLE = 명령 0
    if (dev.bench) await dev.setBench(false);
    const r = await dev.configure({ trim: 0 }, ['trim']);
    if (r.some((x) => !x.ok)) throw new Error(`P,trim,0 실패: ${r.map((x) => x.err).filter(Boolean).join(', ')}`);
    if (ctx.settings.device.trim !== 0) { ctx.settings.save({ trim: 0 }); toast('저장된 trim 을 0 으로 되돌렸습니다(조립 후 level-trim 으로 다시 정함)', 'info'); }
    busy = false;
    await new Promise((res) => setTimeout(res, 400)); // 서보가 90°까지 가는 시간
    await check();
  });
  const estop = async () => { try { await dev.estop(); } catch { /* */ } toast('비상 정지(M,0): IDLE·명령 0', 'warn'); paint(); };

  let t = setInterval(() => paint(), 500);
  paint();
  return { unmount() { clearInterval(t); t = null; offS && offS(); }, center, check, get last() { return last; } };
}
