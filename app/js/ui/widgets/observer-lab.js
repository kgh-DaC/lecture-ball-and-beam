// observer-lab: LQR 상태 추정 — 관측기 추정값 vs 실제 상태, 관측기 유무(차분) 비교 (chapter-format §6.7, 13장).
// 같은 잡음 씨앗으로 두 번 시뮬레이션한다: (1) 고른 관측기, (2) observer = 'none'(필터 차분). 계산은 control.simulate와 lqr 제어기 debug.
// 실제 속도 ẏ는 시뮬레이션 실제 위치의 중앙 차분(잡음 없는 참값 근사, 그래프 비교용).

import { h, checkProps, clear, errorBox, infoBox, fmt, slider } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, head, kv, modelFor, debounceRaf, practiceParamsFor, P1 } from './_util.js';
import { initialParams } from '../param-editor.js';

export const accepts = ['observer', 'speed_mult', 'noise_mm', 'theta_meas'];

/** 중앙 차분(순수) */
export function centralDiff(t, y) {
  const n = y.length, d = new Array(n).fill(NaN);
  for (let k = 1; k < n - 1; k++) d[k] = (y[k + 1] - y[k - 1]) / (t[k + 1] - t[k - 1]);
  if (n > 1) { d[0] = d[1]; d[n - 1] = d[n - 2]; }
  return d;
}
/** RMS 오차(유한한 값만, 순수) */
export function rmsErr(a, b, from = 0) {
  let s = 0, n = 0;
  for (let k = from; k < a.length; k++) if (Number.isFinite(a[k]) && Number.isFinite(b[k])) { s += (a[k] - b[k]) ** 2; n++; }
  return n ? Math.sqrt(s / n) : null;
}

export function mount(el, props, ctx) {
  checkProps(el, 'observer-lab', props, accepts);
  if (!need(el, ctx, ['registry', 'simulate', 'plant'])) return {};
  const C = ctx.control.getController('lqr');
  const practice = (ctx.chapter && ctx.chapter.practice) || null;
  const o = { observer: props.observer || 'luenberger', speed: props.speed_mult ?? 4, noise_mm: props.noise_mm ?? 1, theta_meas: props.theta_meas ?? true };
  const base = initialParams(C.meta, { safe: practiceParamsFor(practice, 'lqr').safe });
  el.appendChild(head('관측기 실험실', h('span', { class: 'muted' }, '초음파는 위치만 잰다 — 속도·서보각은 추정')));
  const ctl = h('div');
  const read = h('div', { class: 'readout' });
  const msg = h('div');
  el.append(ctl, read, msg);
  const pY = new Plot(el, { height: 170, xLabel: '시간 (s)', yLabel: '측정 거리(표면) (mm)' });
  const pV = new Plot(el, { height: 170, xLabel: '시간 (s)', yLabel: '속도 ẏ (mm/s)' });
  const pT = new Plot(el, { height: 140, xLabel: '시간 (s)', yLabel: '서보각 θ (°)' });

  const obsSel = h('select', { onchange: (e) => { o.observer = e.target.value; redraw(); } },
    [['luenberger', 'Luenberger'], ['kalman', '칼만 필터'], ['none', '없음(필터 차분)']].map(([v, l]) => h('option', { value: v, selected: v === o.observer }, l)));
  const thChk = h('input', { type: 'checkbox', checked: !!o.theta_meas, onchange: (e) => { o.theta_meas = e.target.checked; redraw(); } });
  ctl.append(h('div', { class: 'row' }, h('label', null, '관측기 ', obsSel), h('label', null, thChk, ' θ 측정(포텐쇼미터) 사용')),
    slider({ label: '관측기 속도 배수', min: 1, max: 10, step: 0.5, value: o.speed, onInput: (v) => { o.speed = v; redraw(); } }),
    slider({ label: '센서 잡음 σ', min: 0, max: 5, step: 0.1, value: o.noise_mm, unit: 'mm', onInput: (v) => { o.noise_mm = v; redraw(); } }));

  const run = (model, observer) => ctx.control.simulate(model, { id: 'lqr', params: { ...base, observer, obs_speed: o.speed, theta_meas: o.theta_meas } }, P1,
    { noise: true, seed: 7, theta_meas: o.theta_meas });

  const draw = () => {
    clear(msg); clear(read);
    try {
      const m0 = modelFor(ctx, 'ball+servo');
      const model = { ...m0, sensor: { ...m0.sensor, noise_m: o.noise_mm / 1000 } };
      const a = run(model, o.observer);
      const b = o.observer === 'none' ? null : run(model, 'none');
      const t = a.t_s;
      const vTrue = centralDiff(t, a.y_m).map((v) => v * 1000);
      const col = (s, k, sc = 1) => s.debug.map((d) => (Number.isFinite(d[k]) ? d[k] * sc : NaN));
      const k0 = Math.round(0.5 / (t[1] - t[0])); // 첫 0.5 s(초기 수렴) 제외
      pY.setSeries([
        { label: '측정(잡음·필터)', x: t, y: a.y_meas_m.map((v) => v * 1000), ...styleOf(6), width: 1, alpha: 0.6 },
        { label: '실제 y', x: t, y: a.y_m.map((v) => v * 1000), ...styleOf(0), width: 2.2 },
        { label: '추정 ŷ', x: t, y: col(a, 'x_hat_y', 1000), ...styleOf(1) }]);
      const vs = [{ label: '실제 ẏ', x: t, y: vTrue, ...styleOf(0), width: 2.2 }, { label: `추정 ẏ (${o.observer})`, x: t, y: col(a, 'x_hat_ydot', 1000), ...styleOf(1) }];
      if (b) vs.push({ label: '관측기 없음(차분)', x: t, y: col(b, 'x_hat_ydot', 1000), ...styleOf(2), alpha: 0.7, width: 1.2 });
      pV.setSeries(vs);
      const thHat = col(a, 'x_hat_theta', 180 / Math.PI);
      pT.setSeries([{ label: '실제 θ', x: t, y: a.theta_rad.map((v) => v * 180 / Math.PI), ...styleOf(0), width: 2.2 }, { label: 'θ̂ (제어기가 쓴 값)', x: t, y: thHat, ...styleOf(1) },
        { label: '명령 u', x: t, y: a.u_rad.map((v) => v * 180 / Math.PI), ...styleOf(4), width: 1, step: true }]);
      const eV = rmsErr(vTrue, col(a, 'x_hat_ydot', 1000), k0);
      const eVb = b ? rmsErr(vTrue, col(b, 'x_hat_ydot', 1000), k0) : null;
      const tv = (s) => s.u_rad.reduce((acc, u, i) => acc + (i ? Math.abs(u - s.u_rad[i - 1]) : 0), 0) * 180 / Math.PI;
      read.append(...[kv('ẏ 추정 RMS 오차', eV, 'mm/s'), b ? kv('차분 RMS 오차', eVb, 'mm/s') : null, kv('ŷ RMS 오차', rmsErr(a.y_m.map((v) => v * 1000), col(a, 'x_hat_y', 1000), k0), 'mm'),
        kv('u_tv', tv(a), '°'), b ? kv('u_tv(차분)', tv(b), '°') : null, kv('θ 출처', (a.debug[a.debug.length - 1] || {}).theta_source || '–')].filter(Boolean));
      if (a.end_hit) msg.appendChild(infoBox('이 설정에서 공이 빔 끝에 닿았습니다(추정이 나빠 제어가 무너짐).'));
      read.appendChild(h('span', { class: 'kv muted' }, `서보 포함 모델, 잡음 σ ${fmt(o.noise_mm, 1)} mm, 양자화 3 mm, 같은 잡음 씨앗 [시뮬레이션]`));
    } catch (e) { msg.appendChild(errorBox(`시뮬레이션 실패: ${e.message}`)); }
  };
  const redraw = debounceRaf(draw);
  draw();
  return { unmount() { pY.destroy(); pV.destroy(); pT.destroy(); } };
}
