// calibration-wizard: 서보 방향(dir) 확인 → 포텐쇼미터 보정(명령각별 pot 평균) → 저장 (chapter-format §6.4, data-schema §4.2).
// 맞춤 계산은 identification.calibrate(control-engineer). 이 위젯은 장치 조작·평균·저장만 한다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, table, fmt, toast, download, provenanceBadge } from '../dom.js';
import { head } from './_util.js';
import { cmd } from '../../serial/writer.js';
import { meanSd } from '../../store/compare.js';
import { isoLocal } from '../../store/session.js';

export const accepts = ['points_deg', 'settle_s', 'avg_n', 'order', 'check_dir'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** HOST 모드에서 cmd_cdeg를 유지하며 settle 후 n개 pot_raw 평균(S가 하트비트 역할) */
export async function holdAndAverage(dev, cmd_cdeg, { settle_ms = 2000, n = 20, period_ms = 100, timeout_ms = 15000 } = {}) {
  const got = [];
  let collecting = false;
  const off = dev.onSample((d) => { if (collecting && d.mode === 1) got.push(d.pot_raw); });
  const t0 = Date.now();
  try {
    while (got.length < n) {
      await dev.send(cmd.servo(cmd_cdeg));
      if (!collecting && Date.now() - t0 >= settle_ms) collecting = true;
      if (Date.now() - t0 > timeout_ms) throw new Error('포텐쇼미터 값을 충분히 받지 못했습니다');
      await sleep(period_ms);
    }
  } finally { off(); }
  const st = meanSd(got);
  return { cmd_cdeg, pot_raw_mean: st.mean, pot_raw_std: st.sd, n: got.length };
}

export function mount(el, props, ctx) {
  checkProps(el, 'calibration-wizard', props, accepts);
  const dev = ctx.device;
  const pts = props.points_deg || [-30, 0, 30];
  const settle = (props.settle_s ?? 2) * 1000, avgN = props.avg_n ?? 20, order = props.order ?? 1;
  el.appendChild(head('포텐쇼미터 캘리브레이션', h('span', { class: 'muted' }, `명령각 ${pts.join(', ')}°에서 pot 원값 평균 → 1차 맞춤`)));
  if (!ctx.identification) el.appendChild(infoBox('맞춤 계산(control/identification.js)이 아직 준비되지 않아 측정까지만 됩니다. 결과 저장은 모듈이 준비되면 가능합니다.'));
  el.appendChild(warnBox('빔에서 공을 치우고 시작하세요. 서보가 각 명령각으로 움직입니다. 각도 한계(장치 설정 lim)를 넘는 점은 잘립니다.'));
  const out = h('div');
  const btns = h('div', { class: 'row' });
  el.append(btns, out);
  let dirChecked = false, points = [], calTD = null; // calTD = 측정할 때 장치 trim·dir(명령 좌표 직선을 혼 각도로 되돌릴 때 쓴다)

  const ensure = async () => {
    if (dev.mode === 'sample') throw new Error('캘리브레이션은 실제 장치(또는 가상 장치 연습)에서 합니다.');
    if (!dev.connected) await dev.connect();
    if (ctx.runner && ctx.runner.state === 'running') throw new Error('실험 중입니다');
    if (dev.devMode !== 1) { if (dev.devMode !== 0) await dev.setDeviceMode(0); await dev.setDeviceMode(1); }
  };
  const idle = async () => { try { await dev.setDeviceMode(0); } catch { await dev.estop(); } };

  const checkDir = async () => {
    clear(out);
    try {
      await ensure();
      const hold = async (c, ms) => { const t = Date.now(); while (Date.now() - t < ms) { await dev.send(cmd.servo(c)); await sleep(100); } };
      await hold(500, 1500);
      await idle();
      out.append(h('p', null, '서보가 +5°로 움직였을 때 빔의 먼 쪽(센서 반대쪽)이 내려갔나요? (공이 센서에서 멀어지는 방향)'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => { dirChecked = true; clear(out).appendChild(infoBox('dir 확인 완료(현재 설정 유지).')); } }, '예'),
          h('button', { class: 'btn', onclick: () => { const d = -(ctx.settings.device.dir || 1); const r = ctx.settings.save({ dir: d }); dirChecked = r.ok; clear(out).appendChild(r.ok ? infoBox(`dir을 ${d}로 바꿨습니다. 다시 확인하세요(연결 중이면 장치 설정에서 보내기).`) : errorBox(r.errors.join('; '))); } }, '아니오(dir 반전)')));
    } catch (e) { await idle(); out.appendChild(errorBox(e.message)); }
  };

  const measure = async () => {
    clear(out);
    points = [];
    const prog = h('div', { class: 'muted' });
    out.appendChild(prog);
    try {
      await ensure();
      const lim = dev.config.lim ?? 3000;
      calTD = { cal_trim_cdeg: dev.config.trim ?? ctx.settings.device.trim ?? 0, cal_dir: (dev.config.dir ?? ctx.settings.device.dir) === -1 ? -1 : 1 };
      for (const d of pts) {
        const c = Math.max(-lim, Math.min(lim, Math.round(d * 100)));
        prog.textContent = `${d}° 측정 중…`;
        points.push(await holdAndAverage(dev, c, { settle_ms: settle, n: avgN }));
      }
      await idle();
      showResult();
    } catch (e) { await idle(); out.appendChild(errorBox(e.message)); }
  };

  const showResult = () => {
    clear(out);
    out.append(h('div', { class: 'row' }, provenanceBadge(dev.provenance)), table(['명령각(°)', 'pot 평균', 'σ', 'n'], points.map((p) => [p.cmd_cdeg / 100, fmt(p.pot_raw_mean, 1), fmt(p.pot_raw_std, 2), p.n])));
    if (!ctx.identification) return;
    const fit = ctx.identification.calibrate(points, { order });
    out.append(h('p', null, `맞춤: cdeg = ${fmt(fit.fit.c || 0, 4)}·raw² + ${fmt(fit.fit.a_cdeg_per_lsb, 4)}·raw + ${fmt(fit.fit.b_cdeg, 1)} · 최대 잔차 ${fmt(fit.residual_max_cdeg, 1)} cdeg`));
    if (fit.warn) out.appendChild(warnBox(fit.warn === 'nonlinear' ? '잔차가 큽니다(비선형). 점을 늘리거나 order 2를 쓰세요.' : '포텐쇼미터 값이 거의 변하지 않습니다(배선 확인).'));
    const rec = { schema_ver: 1, created_at: isoLocal(), servo_model: ctx.settings.device.servo_model, servo_pin: ctx.settings.device.servo_pin, provenance: dev.provenance, points, fit: fit.fit, residual_max_cdeg: fit.residual_max_cdeg, warn: fit.warn, dir_checked: dirChecked,
      basis: 'cmd', ...(calTD || {}) }; // 명령 좌표 직선 + 그때의 trim·dir (data-schema §4.2: 나중에 trim 이 바뀌어도 θ_cmd 를 다시 계산)
    out.appendChild(h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: async () => { await ctx.db.put('calibrations', rec); if (ctx.runner) ctx.runner.refreshCalibration(); toast('캘리브레이션을 저장했습니다(이 브라우저)', 'ok'); } }, '저장'),
      h('button', { class: 'btn', onclick: () => download('calibration.json', JSON.stringify(rec, null, 2), 'application/json') }, 'calibration.json 내려받기')));
  };

  if (props.check_dir !== false) btns.appendChild(h('button', { class: 'btn', onclick: () => checkDir() }, '1. 방향(dir) 확인'));
  btns.appendChild(h('button', { class: 'btn primary', onclick: () => measure() }, `${props.check_dir !== false ? '2. ' : ''}보정 측정`));
  return { unmount() {} };
}
