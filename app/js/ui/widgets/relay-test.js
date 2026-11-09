// relay-test: 릴레이 피드백 실험 → 극한 사이클 진폭·주기 → Ku, Tu (chapter-format §6.7, 11장).
// 실행 경로 세 가지: 모델 시뮬레이션(즉시), 실습 장치(실제/가상, runner + relay 제어기), 샘플(relay-cycle 슬롯).
// 분석은 control/autotune.relayAnalyze, 릴레이 동작은 controllers/relay.js. 결과는 bus 채널 '__relay'(와 props.bind)로
// 같은 챕터의 tuning-rules에 넘긴다: { relay: { ku, tu_s, kd_stab, source } }.

import { h, checkProps, clear, errorBox, infoBox, warnBox, slider, fmt, badge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { need, head, kv, modelFor, sourceBadges, practiceParamsFor } from './_util.js';
import { simToRows, resolveSources } from '../sources.js';
import { simSourceLabel } from '../twin/lib.js';
import { isSimMode } from '../../serial/device.js';

export const accepts = ['h_deg', 'eps_mm', 'max_time_s', 'discard', 'min_cycles', 'kd_stab'];
export const RELAY_CHANNEL = '__relay';
const D2R = Math.PI / 180;

export const REASON = {
  too_short: '데이터가 너무 짧습니다',
  too_few_cycles: '분석에 쓸 사이클이 부족합니다(버림 사이클 + 최소 사이클). 최대 시간을 늘리세요 — 주기가 약 4 s이면 40 s 정도 필요',
  amplitude_below_eps: '진동 진폭이 히스테리시스 ε보다 작습니다. h를 키우거나 ε를 줄이세요',
  irregular: '주기가 불규칙합니다(변동계수 > 0.2). 공·빔 상태, 잡음, bias를 확인하세요',
};

/** 세션 행 → relayAnalyze 입력(필터 측정값 우선: 릴레이가 실제로 본 신호) */
export function relayRecord(rows) {
  const yk = rows.some((r) => Number.isFinite(r.y_filt_mm)) ? 'y_filt_mm' : 'y_mm';
  return { t_s: rows.map((r) => r.t_s), y_m: rows.map((r) => (Number.isFinite(r[yk]) ? r[yk] / 1000 : NaN)) };
}

/** 릴레이 파라미터(SI) */
export function relayParams(o) {
  return { h: o.h_deg * D2R, eps: o.eps_mm / 1000, bias: 0, max_time: o.max_time_s, kd_stab: o.kd_stab };
}

/** 모델 시뮬레이션으로 릴레이 실험 + 분석. 반환 { rows, res, params } */
export function simulateRelay(ctx, o, plant = 'ball+servo') {
  const model = modelFor(ctx, plant);
  const params = relayParams(o);
  const profile = { type: 'const', ref_mm: o.ref_mm ?? 170, duration_s: o.max_time_s };
  const sim = ctx.control.simulate(model, { id: 'relay', params }, profile, { noise: false, y0_m: (o.ref_mm ?? 170) / 1000 });
  const rows = simToRows(sim);
  const res = ctx.control.autotune.relayAnalyze(relayRecord(rows), { h: params.h, eps: params.eps, discard: o.discard, min_cycles: o.min_cycles });
  return { rows, res, params, end_hit: sim.end_hit };
}

export function mount(el, props, ctx) {
  checkProps(el, 'relay-test', props, accepts);
  if (!need(el, ctx, ['simulate', 'plant', 'autotune'])) return {};
  const practice = (ctx.chapter && ctx.chapter.practice) || null;
  const safe = practiceParamsFor(practice, 'relay').safe;
  const RelayC = ctx.control.getController ? ctx.control.getController('relay') : null;
  const defKd = RelayC ? RelayC.meta.params.find((p) => p.key === 'kd_stab').default : 1.5;
  const o = {
    h_deg: props.h_deg ?? (safe.h != null ? safe.h / D2R : 2.9),
    eps_mm: props.eps_mm ?? (safe.eps != null ? safe.eps * 1000 : 6),
    max_time_s: props.max_time_s ?? safe.max_time ?? 40,
    kd_stab: props.kd_stab ?? safe.kd_stab ?? defKd,
    discard: props.discard ?? 2, min_cycles: props.min_cycles ?? 5,
  };
  const plant = (practice && practice.model) || 'ball+servo';
  el.appendChild(head('릴레이 실험', h('span', { class: 'muted' }, 'u = ±h − kd_stab·ẏ, 극한 사이클에서 Ku = 4h/(π√(a²−ε²))')));
  const ctl = h('div');
  const btns = h('div', { class: 'row' });
  const msg = h('div');
  const read = h('div', { class: 'readout' });
  el.append(ctl, btns, msg, read);
  const pY = new Plot(el, { height: props.height_px || 220, xLabel: '시간 (s)', yLabel: '측정 거리(표면) (mm)' });
  const pU = new Plot(el, { height: 140, xLabel: '시간 (s)', yLabel: '명령각 (°)' });
  const offs = [];

  ctl.append(
    slider({ label: '릴레이 진폭 h', min: 0.3, max: 5.7, step: 0.1, value: o.h_deg, unit: '°', onInput: (v) => { o.h_deg = v; } }),
    slider({ label: '히스테리시스 ε', min: 0, max: 20, step: 0.5, value: o.eps_mm, unit: 'mm', onInput: (v) => { o.eps_mm = v; } }),
    slider({ label: '안정화 미분 kd_stab', min: 0, max: 3, step: 0.05, value: o.kd_stab, unit: 'rad·s/m', onInput: (v) => { o.kd_stab = v; } }),
    slider({ label: '최대 시간', min: 5, max: 60, step: 1, value: o.max_time_s, unit: 's', onInput: (v) => { o.max_time_s = v; } }));

  const publish = (res, source) => {
    const val = res && res.ok ? { ku: res.Ku, tu_s: res.Tu_s, kd_stab: o.kd_stab, source } : null;
    if (!ctx.bus) return;
    ctx.bus.channel(RELAY_CHANNEL).set({ relay: val });
    if (props.bind) ctx.bus.channel(props.bind).set({ relay: val });
  };

  const show = (rows, res, src, extra = {}) => {
    clear(read);
    const t = rows.map((r) => r.t_s);
    const yk = rows.some((r) => Number.isFinite(r.y_filt_mm)) ? 'y_filt_mm' : 'y_mm';
    const ser = [{ label: '위치(필터)', x: t, y: rows.map((r) => r[yk]), ...styleOf(0) }, { label: '설정값', x: t, y: rows.map((r) => r.ref_mm), ...styleOf(6), width: 1, step: true }];
    const ann = [];
    if (res && Number.isFinite(res.center_m)) ann.push({ type: 'hline', y: res.center_m * 1000, label: '진동 중심', noScale: true });
    for (const c of (res && res.crossings_s) || []) ann.push({ type: 'vline', x: c, dash: [2, 4], color: '#999' });
    pY.setAnnotations(ann.slice(0, 60));
    pY.setSeries(ser);
    pU.setSeries([{ label: '명령각 u', x: t, y: rows.map((r) => r.u_cdeg / 100), ...styleOf(1), step: true }]);
    read.append(h('span', null, ...(src ? sourceBadges(src) : [])));
    if (!res) return;
    read.append(kv('사이클', res.cycles), kv('반진폭 a', res.a_m != null ? res.a_m * 1000 : null, 'mm'), kv('주기 Tu', res.Tu_s, 's'), kv('Ku', res.Ku, 'rad/m'),
      ...(res.period_cv != null ? [kv('주기 변동계수', res.period_cv)] : []), kv('kd_stab', o.kd_stab));
    if (res.ok) read.appendChild(h('span', { class: 'kv', style: { color: 'var(--ok)' } }, '분석 성공 → 튜닝 규칙 표로 전달'));
    else msg.appendChild(warnBox(`분석 실패: ${REASON[res.reason] || res.reason}`));
    if (extra.end_hit) msg.appendChild(warnBox('공이 빔 끝에 닿았습니다. h를 줄이거나 kd_stab을 키우세요.'));
    if (o.kd_stab === 0) msg.appendChild(infoBox('kd_stab = 0: 고전 릴레이. 이중 적분기는 극한 사이클이 생기지 않고 발산합니다(실기에서는 0.3 이상으로 강제).'));
  };

  const runSim = () => {
    clear(msg);
    try {
      const r = simulateRelay(ctx, o, plant);
      show(r.rows, r.res, { provenance: 'simulated', kind: 'prediction' }, { end_hit: r.end_hit });
      publish(r.res, 'simulation');
    } catch (e) { msg.appendChild(errorBox(`시뮬레이션 실패: ${e.message}`)); }
  };

  const runDevice = async () => {
    clear(msg);
    const dev = ctx.device, runner = ctx.runner;
    try {
      if (!dev || !runner) throw new Error('장치·러너 서비스가 없습니다');
      if (dev.mode === 'sample') throw new Error('샘플 재생 모드입니다. 실습 패널에서 실제 장치·가상 장치·디지털 트윈을 고르세요');
      if (!dev.connected) { if (isSimMode(dev.mode)) await dev.connect(); else throw new Error('먼저 장치를 연결하세요(실습 패널)'); }
      if (runner.state === 'running') throw new Error('다른 실험이 진행 중입니다');
      const params = relayParams(o);
      if (dev.mode === 'device' && params.h > 0.1) throw new Error('실기 h 상한 5.7°(0.1 rad)를 넘습니다');
      msg.appendChild(infoBox(`릴레이 실험 중… 약 ${o.max_time_s} s`));
      const ev = await runner.runOnce({
        controller: { id: 'relay', params }, profile: { type: 'const', ref_mm: 170, duration_s: o.max_time_s }, chapter_id: ctx.chapter && ctx.chapter.id, title: '릴레이 실험',
        lim_cdeg: practice && practice.angle_limit_deg != null ? practice.angle_limit_deg * 100 : undefined, fs_ms: (practice && practice.fs_ms) || 60, alpha: practice ? practice.alpha : undefined,
        y_source: 'filt', model_kind: plant, place_ball_mm: isSimMode(dev.mode) ? 170 : undefined,
      });
      const s = await ctx.store.sessions.get(ev.session_id);
      clear(msg);
      const res = ctx.control.autotune.relayAnalyze(relayRecord(s.rows), { h: params.h, eps: params.eps, discard: o.discard, min_cycles: o.min_cycles });
      show(s.rows, res, { provenance: s.meta.provenance, kind: 'session', badges: simSourceLabel(s.meta) ? [simSourceLabel(s.meta)] : [] });
      publish(res, dev.mode);
      if (!ev.complete) msg.appendChild(warnBox(`실험이 중단되었습니다(${ev.reason || ''}).`));
    } catch (e) { clear(msg).appendChild(errorBox(e.message)); }
  };

  const loadSample = async () => {
    clear(msg);
    try {
      const [s] = await resolveSources(ctx, ['slot:relay-cycle']);
      if (!s || !s.rows) { msg.appendChild(infoBox(s && s.message ? s.message : 'relay-cycle 슬롯 샘플이 없습니다.')); return; }
      const p = (s.meta && s.meta.controller && s.meta.controller.params) || {};
      const h0 = p.h ?? o.h_deg * D2R, e0 = p.eps ?? o.eps_mm / 1000;
      if (p.kd_stab != null) o.kd_stab = p.kd_stab;
      const res = ctx.control.autotune.relayAnalyze(relayRecord(s.rows), { h: h0, eps: e0, discard: o.discard, min_cycles: o.min_cycles });
      show(s.rows, res, s);
      msg.appendChild(infoBox(`샘플 ${s.label}: h = ${fmt(h0 / D2R, 2)}°, ε = ${fmt(e0 * 1000, 1)} mm, kd_stab = ${fmt(o.kd_stab)}`));
      publish(res, 'sample');
    } catch (e) { msg.appendChild(errorBox(e.message)); }
  };

  btns.append(
    h('button', { class: 'btn primary', onclick: runSim }, '모델로 시뮬레이션'),
    practice && (practice.modes || []).some((m) => m !== 'sample') ? h('button', { class: 'btn', onclick: () => runDevice() }, '장치로 실험(실습 패널 모드)') : null,
    h('button', { class: 'btn', onclick: () => loadSample() }, '샘플(relay-cycle)'),
    badge(plant === 'ball+servo' ? '서보 포함 모델' : '서보 무시 모델', 'b-sim'));
  runSim();
  return { unmount() { offs.forEach((f) => f()); pY.destroy(); pU.destroy(); } };
}
