// level-finder: 방향(dir) 확인과 수평각(trim) 결정.
// (1) dir: +3° 명령을 주고 "어느 쪽 끝이 올라갔는지" 고르면 dir 결정(규약: + 명령 ⇒ 센서 쪽 끝이 올라가 공이 센서에서 멀어짐, plant.js).
//     공을 올려 두면 dist 변화로 자동 판정도 돕는다. → P,dir(IDLE) + 설정 저장
// (2) 수평: 조그·숫자 입력·디지털 수평계 값으로 빔을 수평에 맞추고 그때 명령각으로 trim = trim + dir·cmd 계산 → P,trim(IDLE, ±1500 cdeg) + 저장
//     수평계 값 α(센서 쪽 높으면 +)는 레버 비 θ ≈ α·L/d 로 서보 보정각으로 바꾼다. 공 굴림 속도로 기울기 방향을 알려 준다.
// (3) 확인: trim 적용 후 S,0에서 수평인지 체크.

import { h, checkProps, clear, errorBox, infoBox, warnBox, badge, fmt, toast } from '../dom.js';
import { head, kv } from './_util.js';
import { Jogger, hwModeNote, GUIDE } from '../jog.js';

export const accepts = ['step_deg', 'probe_deg', 'ball_assist'];

/** 새 trim(순수): 수평이 되는 명령 cmd에서 trim' = trim + dir·cmd, ±1500으로 자름 */
export function newTrim(trim, dir, cmd_cdeg) { return Math.max(-1500, Math.min(1500, Math.round(trim + dir * cmd_cdeg))); }
/** 수평계 값 → 서보 보정(cdeg, 순수). alpha_deg: 빔 기울기(센서 쪽 높으면 +). L, d: 빔 길이·레버 팔(m) */
export function levelCorrection(alpha_deg, L_m = 0.34, d_m = 0.052) { return Math.round(-alpha_deg * (L_m / d_m) * 100); }
/** dir 판정(순수): + 명령에서 올라간 쪽 'sensor' | 'far' → 새 dir */
export function dirFromObservation(curDir, raisedSide) { return raisedSide === 'sensor' ? curDir : -curDir; }
const medianOf = (a) => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };

/**
 * 공 굴림 속도와 이상값(순수). 최근 window_ms 의 원측정 dist_mm 으로 Theil–Sen 기울기(모든 점 쌍 기울기의 중앙값)를 구한다.
 * 최소제곱과 달리 튄 값(실기 정지 공 약 15 %가 ~304 mm, protocol §3.1)이 29 % 미만이면 기울기가 거의 흔들리지 않는다.
 * filt_mm 은 쓰지 않는다: 구 펌웨어(1.0.0)에서는 튐이 그대로 섞이고, 재귀 필터 지연(약 240 ms)도 있다.
 * 반환 { slope_mm_s(양수 = 센서에서 멀어짐), n, n_outlier, outlier_ratio } 또는 null(점 부족)
 * 이상값 = 직선에서 max(15 mm, 4·1.4826·MAD) 넘게 떨어진 점.
 */
export function ballSlopeStats(samples, window_ms = 1500) {
  const ok = samples.filter((d) => d.dist_mm >= 0);
  if (ok.length < 6) return null;
  const tEnd = ok[ok.length - 1].t_ms;
  const w = ok.filter((d) => d.t_ms >= tEnd - window_ms);
  if (w.length < 6) return null;
  const sl = [];
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) {
    const dt = w[j].t_ms - w[i].t_ms;
    if (dt > 0) sl.push((w[j].dist_mm - w[i].dist_mm) / dt);
  }
  if (!sl.length) return null;
  const b = medianOf(sl);
  const a = medianOf(w.map((d) => d.dist_mm - b * d.t_ms));
  const res = w.map((d) => Math.abs(d.dist_mm - (a + b * d.t_ms)));
  const thr = Math.max(15, 4 * 1.4826 * medianOf(res));
  const nOut = res.filter((r) => r > thr).length;
  return { slope_mm_s: b * 1000, n: w.length, n_outlier: nOut, outlier_ratio: nOut / w.length };
}
/** 공 굴림 속도(mm/s, 순수, 이상값에 강한 Theil–Sen). 양수 = 센서에서 멀어짐 */
export function ballSlope(samples, window_ms = 1500) {
  const r = ballSlopeStats(samples, window_ms);
  return r ? r.slope_mm_s : null;
}

export function mount(el, props, ctx) {
  checkProps(el, 'level-finder', props, accepts);
  const dev = ctx.device;
  const stepC = Math.round((props.step_deg ?? 0.5) * 100);
  const probe = Math.round((props.probe_deg ?? 3) * 100);
  const jog = new Jogger(dev, ctx.runner);
  const pp = (ctx.control && ctx.control.plant && ctx.control.plant.DEFAULT_PLANT_PARAMS) || { L_m: 0.34, d_m: 0.052 };
  let samples = [];
  const tag = h('span');
  el.appendChild(head('방향·수평 맞추기', tag));
  const note = h('div');
  const dirBox = h('div', { class: 'panel-sec' });
  const lvBox = h('div', { class: 'panel-sec' });
  const read = h('div', { class: 'readout' });
  const assist = h('div');
  const msg = h('div');
  el.append(note, dirBox, lvBox, read, assist, msg);
  const offS = dev && dev.onSample ? dev.onSample((d) => { samples.push(d); if (samples.length > 200) samples.shift(); }) : null;

  const cur = () => ({ trim: ctx.settings.device.trim, dir: ctx.settings.device.dir });
  const guard = async (fn) => { clear(msg); try { await fn(); } catch (e) { msg.appendChild(errorBox(e.message)); } paint(); };
  const ensureJog = async () => { if (!jog.active) await jog.start(Math.max(probe + 200, 500)); };
  /** IDLE에서 설정 키 전송 + 저장 */
  const applyIdle = async (partial) => {
    await jog.stop();
    const r = ctx.settings.save(partial);
    if (!r.ok) throw new Error(r.errors.join(', '));
    if (dev.connected) {
      const res = await dev.configure(ctx.settings.device, Object.keys(partial));
      const bad = res.filter((x) => !x.ok);
      if (bad.length) throw new Error(`장치 설정 실패: ${bad.map((b) => `${b.key}(${b.err})`).join(', ')}`);
    }
  };

  // (1) 방향
  let dirProbeDist = null;
  dirBox.append(h('h4', null, '1. 방향(dir) 확인'),
    h('p', { class: 'muted' }, `규약: + 명령이면 센서 쪽 끝이 올라가 공이 센서에서 멀어져야 합니다(거리 증가). "+${probe / 100}° 기울여 보기"를 누르고 어느 쪽이 올라갔는지 고르세요.`),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => guard(async () => { await ensureJog(); const s = samples.filter((d) => d.dist_mm >= 0); dirProbeDist = s.length ? s[s.length - 1].dist_mm : null; await jog.moveTo(probe); }) }, `+${probe / 100}° 기울여 보기`),
      h('button', { class: 'btn', onclick: () => guard(async () => { const d = cur().dir; await applyIdle({ dir: dirFromObservation(d, 'sensor') }); toast('dir 유지(센서 쪽이 올라감 = 정상)', 'ok'); }) }, '센서 쪽 끝이 올라감'),
      h('button', { class: 'btn', onclick: () => guard(async () => { const d = cur().dir; const nd = dirFromObservation(d, 'far'); await applyIdle({ dir: nd }); toast(`dir을 ${nd}로 바꿨습니다(P,dir 전송·저장)`, 'ok'); }) }, '반대쪽(센서에서 먼 끝)이 올라감'),
      h('button', { class: 'btn', onclick: () => guard(() => jog.moveTo(0)) }, '0으로')));

  // (2) 수평
  const alphaIn = h('input', { type: 'number', step: 0.1, class: 'num', placeholder: '예: 0.8' });
  const cmdIn = h('input', { type: 'number', step: 0.1, class: 'num', placeholder: '°' });
  const jb = (label, d) => h('button', { class: 'btn', onclick: () => guard(async () => { await ensureJog(); await jog.step(d); }) }, label);
  let verified = false;
  const verifyChk = h('input', { type: 'checkbox', onchange: (e) => { verified = e.target.checked; if (verified) ctx.settings.saveUi({ level_verified_at: new Date().toISOString(), level_trim: cur().trim }); paint(); } });
  lvBox.append(h('h4', null, '2. 수평(trim) 맞추기'),
    h('p', { class: 'muted' }, '빔이 수평이 될 때까지 조그하세요. 판단 방법: 디지털 수평계(가장 정확), 눈(빔과 책상 모서리 비교), 공을 가운데 두고 굴러가지 않는 지점 찾기(아래 공 굴림 보조).'),
    h('div', { class: 'row' }, jb(`−${(stepC * 4) / 100}°`, -stepC * 4), jb(`−${stepC / 100}°`, -stepC), h('b', null, ' 조그 '), jb(`+${stepC / 100}°`, stepC), jb(`+${(stepC * 4) / 100}°`, stepC * 4),
      h('label', null, ' 명령각 직접 ', cmdIn, '°'), h('button', { class: 'btn', onclick: () => guard(async () => { await ensureJog(); await jog.moveTo(Number(cmdIn.value) * 100); }) }, '이동')),
    h('div', { class: 'row' }, h('label', null, '수평계 값(센서 쪽 높으면 +) ', alphaIn, '°'),
      h('button', { class: 'btn', onclick: () => guard(async () => { const a = Number(alphaIn.value); if (!Number.isFinite(a)) throw new Error('수평계 값을 넣으세요'); await ensureJog(); await jog.moveTo(jog.cmd + levelCorrection(a, pp.L_m, pp.d_m)); }) }, '보정각만큼 이동(θ ≈ α·L/d)')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => guard(async () => {
      const { trim, dir } = cur();
      const nt = newTrim(trim, dir, jog.cmd);
      if (Math.abs(trim + dir * jog.cmd) > 1500) msg.appendChild(warnBox('trim이 ±15°를 넘어 잘렸습니다. 서보 혼(horn) 장착 각도를 다시 맞추세요.'));
      await applyIdle({ trim: nt });
      verified = false; verifyChk.checked = false;
      toast(`trim = ${nt} cdeg 저장(P,trim 전송). 이제 S,0이 수평입니다.`, 'ok');
    }) }, '지금 각도를 수평으로(trim 계산·적용)'),
    h('button', { class: 'btn', onclick: () => guard(async () => { await ensureJog(); await jog.moveTo(0); }) }, '확인: S,0으로 이동'),
    h('label', null, verifyChk, ' trim 적용 후 S,0에서 수평임을 확인했습니다')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => guard(() => jog.stop()) }, '0으로 돌리고 멈춤'), h('button', { class: 'btn estop', onclick: () => guard(() => jog.estop()) }, '비상 정지(M,0)')));

  const paint = () => {
    const m = hwModeNote(dev);
    clear(tag).append(badge(m.text, m.cls));
    clear(note).appendChild(m.real ? warnBox('실제 장치: 먼저 "각도 한계 찾기"로 lim을 정하세요. 조그는 그 한계 안에서만 움직입니다. 이상하면 비상 정지.') : infoBox('가상 장치: 가상 기구는 trim 0, dir 1이 바른 장착입니다(연습용).'));
    const { trim, dir } = cur();
    clear(read).append(kv('명령', jog.cmd / 100, '°'), kv('저장된 trim', trim / 100, '°'), kv('dir', dir), kv('수평 확인', verified ? '완료' : '미확인'), kv('상태', jog.active ? 'HOST 조그 중' : '정지(IDLE)'));
    clear(assist);
    if (props.ball_assist !== false) {
      const st = ballSlopeStats(samples);
      const v = st ? st.slope_mm_s : null;
      if (v == null) assist.appendChild(h('div', { class: 'muted' }, '공 굴림 보조: 공을 빔 가운데에 올려 두면 굴러가는 방향으로 기울기를 알려 줍니다.'));
      else {
        const flat = Math.abs(v) < 3;
        assist.appendChild(h('div', { class: 'row' }, h('b', null, '공 굴림 보조 '), kv('속도(원측정, 이상값에 강한 중앙값 기울기)', v, 'mm/s'),
          kv('튄 값', `${st.n_outlier}/${st.n} (${fmt(st.outlier_ratio * 100, 0)}%)`),
          flat ? badge('● 거의 수평', 'b-ok') : badge(v > 0 ? '▲ 센서에서 멀어짐 → 센서 쪽이 높음: 명령을 − 쪽으로' : '▼ 센서 쪽으로 옴 → 먼 쪽이 높음: 명령을 + 쪽으로', 'b-assumed')));
        if (dirProbeDist != null && jog.cmd === probe) assist.appendChild(h('div', { class: 'muted' }, v > 3 ? '+ 명령에서 공이 센서에서 멀어집니다 → dir 정상으로 보입니다' : v < -3 ? '+ 명령에서 공이 센서 쪽으로 옵니다 → dir 반전 필요로 보입니다' : '공이 거의 안 움직입니다(멈춤판에 붙었거나 각이 작음)'));
      }
    }
    assist.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, '안내: ', h('a', { href: GUIDE.pwm.href }, GUIDE.pwm.label), ' · ', h('a', { href: GUIDE.sonar.href }, GUIDE.sonar.label)));
  };
  jog.onChange(() => paint());
  let t = setInterval(() => paint(), 500);
  paint();
  return { unmount() { clearInterval(t); t = null; offS && offS(); jog.dispose(); }, jog, applyIdle, paint };
}
