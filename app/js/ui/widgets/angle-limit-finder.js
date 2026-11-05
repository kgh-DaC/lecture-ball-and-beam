// angle-limit-finder: 서보 각도 한계 결정. 작은 한계(±5°)로 시작해 한 방향씩 0.5° 조그(램프·하트비트 유지)하며
// 빔이 기구 한계·걸림에 닿기 직전 각도를 '최대 +/−'로 기록 → 권장 lim = 닿는 각도의 80 %(양쪽 중 작은 쪽, 대칭) →
// 확정하면 P,lim 전송 + 설정 저장(이후 모든 실습의 각도 한계 상한). 포텐쇼미터가 연결돼 있으면 pot 변화로 추종을 확인한다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, badge, fmt, toast } from '../dom.js';
import { head, kv } from './_util.js';
import { Jogger, hwModeNote, SAFE_START_LIM_CDEG, GUIDE } from '../jog.js';
import { potToCdeg } from '../../loop/runner.js';
import { withTrimDir } from '../../config/hw-records.js';

export const accepts = ['start_lim_deg', 'step_deg', 'margin'];

/** 권장 lim(cdeg, 순수): 양쪽 닿는 각 중 작은 쪽 × margin, 50 cdeg 단위로 내림. 한쪽이라도 없으면 null */
export function recommendLim(maxPos_cdeg, maxNeg_cdeg, margin = 0.8) {
  if (!Number.isFinite(maxPos_cdeg) || !Number.isFinite(maxNeg_cdeg)) return null;
  const m = Math.min(Math.abs(maxPos_cdeg), Math.abs(maxNeg_cdeg)) * margin;
  return Math.max(0, Math.min(3000, Math.floor(m / 50) * 50));
}

/** 추종 판정(순수): 명령 변화 대비 pot 변화 비율. pot이 불안정하면 null */
export function trackingRatio(dCmd_cdeg, dPot_cdeg, dir = 1) {
  if (!Number.isFinite(dPot_cdeg) || Math.abs(dCmd_cdeg) < 100) return null;
  return (dir * dPot_cdeg) / dCmd_cdeg;
}

export function mount(el, props, ctx) {
  checkProps(el, 'angle-limit-finder', props, accepts);
  const dev = ctx.device;
  const startLim = Math.round((props.start_lim_deg ?? SAFE_START_LIM_CDEG / 100) * 100);
  const stepC = Math.round((props.step_deg ?? 0.5) * 100);
  const margin = props.margin ?? 0.8;
  const jog = new Jogger(dev, ctx.runner);
  const rec = { pos: null, neg: null };
  let cal = null, pot0 = null, cmd0 = 0, potNow = NaN, potHist = [];
  const tag = h('span');
  el.appendChild(head('각도 한계 찾기', tag));
  const note = h('div');
  const ctl = h('div', { class: 'row' });
  const jogRow = h('div', { class: 'row' });
  const read = h('div', { class: 'readout' });
  const recBox = h('div');
  const msg = h('div');
  el.append(note, ctl, jogRow, read, recBox, msg);

  const paintNote = () => {
    const m = hwModeNote(dev);
    clear(tag).append(badge(m.text, m.cls));
    clear(note).appendChild(m.real
      ? warnBox(`실제 장치: 처음에는 한계 ±${startLim / 100}°로 시작합니다. 빔 주변에서 손을 치우고, 빔이 멈춤판·나사·전선에 닿거나 서보가 힘들어하는 소리가 나면 즉시 "비상 정지". 한 방향씩 ${stepC / 100}°씩 천천히 움직입니다.`)
      : infoBox('가상 장치: 기구 한계가 없으므로 조작 연습용입니다(기록 값은 실제 기구와 무관). 실제 장치에서 다시 하세요.'));
  };
  const readPot = (d) => {
    potHist.push(d.pot_raw); if (potHist.length > 30) potHist.shift();
    // θ = dir·(혼 각도 − trim): 장치가 보고한 trim·dir 로(조그 중 P,trim 은 없지만 연결 뒤 바뀐 값을 따른다)
    if (cal && dev.config) cal = withTrimDir(cal, dev.config.trim ?? cal.trim_cdeg, dev.config.dir ?? cal.dir);
    potNow = cal ? potToCdeg(d.pot_raw, cal) : NaN;
    if (jog.active && pot0 == null && Number.isFinite(potNow)) { pot0 = potNow; cmd0 = jog.cmd; }
  };
  const offS = dev && dev.onSample ? dev.onSample((d) => { readPot(d); paint(); }) : null;
  const potStable = () => { if (potHist.length < 10) return null; const m = potHist.reduce((a, b) => a + b, 0) / potHist.length; const s = Math.sqrt(potHist.reduce((a, b) => a + (b - m) ** 2, 0) / potHist.length); return s <= 15 && m > 5 && m < 1018; };

  const paint = () => {
    clear(read).append(kv('명령', jog.cmd / 100, '°'), kv('장치 한계(임시)', jog.lim != null ? `±${jog.lim / 100}` : '–', '°'), kv('상태', jog.active ? 'HOST 조그 중' : '정지(IDLE)'));
    const st = potStable();
    if (st === false) read.append(h('span', { class: 'kv', style: { color: 'var(--bad)' } }, 'pot 불안정/미연결 — 추종 확인 불가(눈으로 확인)'), h('a', { href: GUIDE.wiper.href }, GUIDE.wiper.label));
    else if (st && pot0 != null) {
      const r = trackingRatio(jog.cmd - cmd0, potNow - pot0, (dev.config && dev.config.dir) || 1);
      read.append(kv('pot 변화', fmt((potNow - pot0) / 100, 2), '°'), r == null ? h('span', { class: 'kv muted' }, '추종: 1° 이상 움직이면 판정') : h('span', { class: 'kv', style: { color: r > 0.7 && r < 1.3 ? 'var(--ok)' : 'var(--bad)' } }, `추종 비율 ${fmt(r, 2)} ${r > 0.7 && r < 1.3 ? '(정상)' : '(명령을 따라가지 못함 — 걸림·전원 부족 의심, 멈추세요)'}`));
    }
    const recLim = recommendLim(rec.pos, rec.neg, margin);
    clear(recBox).append(h('div', { class: 'row' }, kv('최대 +', rec.pos != null ? rec.pos / 100 : '미기록', rec.pos != null ? '°' : ''), kv('최대 −', rec.neg != null ? rec.neg / 100 : '미기록', rec.neg != null ? '°' : ''),
      kv(`권장 lim(작은 쪽 × ${margin})`, recLim != null ? `±${recLim / 100}` : '양쪽 기록 후', recLim != null ? '°' : ''), kv('현재 저장값', `±${ctx.settings.device.lim / 100}`, '°')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: recLim == null, onclick: () => confirmLim() }, recLim != null ? `±${recLim / 100}°로 확정(P,lim 전송·저장)` : '확정(양쪽 기록 필요)')));
  };
  jog.onChange(() => paint());

  const guard = async (fn) => { clear(msg); try { await fn(); } catch (e) { msg.appendChild(errorBox(e.message)); } paint(); };
  const begin = () => guard(async () => {
    cal = ctx.getCalibration ? await ctx.getCalibration() : null;
    pot0 = null; potHist = [];
    await jog.start(startLim);
    toast(`조그 시작: 장치 한계 ±${startLim / 100}°`, 'ok');
  });
  const raise = (deg) => guard(async () => {
    if (!jog.active) throw new Error('먼저 조그를 시작하세요');
    if (dev.mode === 'device' && typeof globalThis.confirm === 'function' && !globalThis.confirm(`장치 한계를 ±${deg}°로 넓힙니다. 빔 주변이 비어 있습니까?`)) return;
    await jog.setLim(deg * 100);
  });
  const recordSide = (side) => {
    if (side === '+' && jog.cmd > 0) rec.pos = jog.cmd;
    else if (side === '-' && jog.cmd < 0) rec.neg = jog.cmd;
    else { clear(msg).appendChild(infoBox(side === '+' ? '+ 쪽으로 움직인 뒤 기록하세요' : '− 쪽으로 움직인 뒤 기록하세요')); return; }
    jog.moveTo(0).catch(() => {});
    paint();
  };
  const confirmLim = () => guard(async () => {
    const lim = recommendLim(rec.pos, rec.neg, margin);
    if (lim == null) throw new Error('양쪽 최대 각도를 먼저 기록하세요');
    await jog.stop();
    const r = ctx.settings.save({ lim });
    if (!r.ok) throw new Error(r.errors.join(', '));
    if (dev.connected) await jog.setLim(lim);
    toast(`각도 한계 ±${lim / 100}° 저장. 이후 실습의 각도 한계는 이 값을 넘지 않습니다.`, 'ok');
    if (ctx.settings.hw) ctx.settings.hw.recordResult('angle-limit-finder', { verdict: 'pass', provenance: dev.provenance === 'real' ? 'measured' : 'simulated', summary: `lim ±${lim / 100}° (최대 +${rec.pos / 100}°, −${Math.abs(rec.neg) / 100}°)`, data: { lim_cdeg: lim, pos_cdeg: rec.pos, neg_cdeg: rec.neg } });
    msg.appendChild(infoBox(`저장됨: lim = ${lim} cdeg (±${lim / 100}°)${dev.mode === 'virtual' || dev.mode === 'twin' ? ` — ${dev.mode === 'twin' ? '디지털 트윈' : '가상 장치'}에서 정한 값입니다. 실제 장치에서 다시 확인하세요` : ''}`));
  });

  ctl.append(h('button', { class: 'btn primary', onclick: begin }, `조그 시작(한계 ±${startLim / 100}°)`),
    h('label', null, ' 임시 한계 넓히기 ', h('select', { onchange: (e) => raise(Number(e.target.value)) }, [5, 8, 10, 15, 20, 25, 30].map((v) => h('option', { value: v, selected: v * 100 === startLim }, `±${v}°`)))),
    h('button', { class: 'btn', onclick: () => guard(() => jog.stop()) }, '0으로 돌리고 멈춤'),
    h('button', { class: 'btn estop', onclick: () => guard(() => jog.estop()) }, '비상 정지(M,0)'));
  const jb = (label, d) => h('button', { class: 'btn', onclick: () => guard(() => jog.step(d)) }, label);
  jogRow.append(jb(`−${(stepC * 4) / 100}°`, -stepC * 4), jb(`−${stepC / 100}°`, -stepC), h('b', null, ' 조그 '), jb(`+${stepC / 100}°`, stepC), jb(`+${(stepC * 4) / 100}°`, stepC * 4),
    h('button', { class: 'btn', onclick: () => recordSide('+') }, '닿기 직전 → 최대 + 기록'), h('button', { class: 'btn', onclick: () => recordSide('-') }, '닿기 직전 → 최대 − 기록'));
  paintNote(); paint();
  const offSt = dev && dev.onStatus ? dev.onStatus(() => { paintNote(); paint(); }) : null;
  return { unmount() { offS && offS(); offSt && offSt(); jog.dispose(); }, jog, rec, begin, recordSide, confirm: confirmLim };
}
