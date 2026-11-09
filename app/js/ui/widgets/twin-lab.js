// twin-lab: 디지털 트윈 가상 실험실 (chapter-format §6.9, docs/spec/digital-twin.md §3).
// - 실시간: ctx.device 를 'twin' 모드(TwinDevice)로 두고 기존 러너로 제어한다(세션 저장·안전 규칙이 실습 패널과 같다).
// - 즉시 계산: sim/twin/scenario.runScenario 로 같은 시나리오·제어기를 한 번에 계산(러너 없이, 결정론).
// - 화면: 빔·공·서보 애니메이션(참 상태), 참 위치 vs 센서 측정 그래프, 서보 각, 외란·센서 고장 버튼, 지표(참 위치 채점).
// 제어기에는 센서 출력(D 줄)만 간다. 참 상태는 TwinDevice.onMeasure/getTruth 로 화면에만 쓴다.
// 트윈 물리·시나리오·지표 계산은 sim/twin/*(digital-twin-engineer)를 호출만 한다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, badge, fmt, table } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, kv } from './_util.js';
import { paramEditor, initialParams, startPositionMm } from '../param-editor.js';
import { practiceParamsFor } from '../practice.js';
import {
  TWIN_BADGE, SENSOR_ONLY_NOTE, twinFetchOf, loadTwinParams, loadScenarioIndex, loadScenario,
  resolveControllers, scenarioEvents, paramsProvenanceText, describeEvent,
} from '../twin/lib.js';

export const accepts = ['scenario', 'controllers', 'controller', 'window_s', 'allow_batch'];

const DEFAULT_CONTROLLERS = 'pd-p1,pd-servo,pid-tl,lqr,lqi,smc-sat';
const R2D = 180 / Math.PI;
const FAULTS = [
  { key: 'outlier_burst', label: '이상값 3연속', fault: { type: 'outlier_burst', n: 3 } },
  { key: 'outlier_rate', label: '이상값 15 % (3 s)', fault: { type: 'outlier_rate', prob: 0.15, duration_s: 3 } },
  { key: 'dropout', label: '측정 유실 (0.5 s)', fault: { type: 'dropout', duration_s: 0.5 } },
  { key: 'stuck', label: '측정 멈춤 (0.5 s)', fault: { type: 'stuck', duration_s: 0.5 } },
  { key: 'bias', label: '치우침 +15 mm (3 s)', fault: { type: 'bias', offset_mm: 15, duration_s: 3 } },
];

/** 사건 종류 이름(지표 표: 값 없이 종류만) */
const EVENT_NAME = {
  ball_push: '공 밀기', ball_place: '공 옮김', beam_knock: '빔 충격', force: '외력', param_step: '파라미터 변화',
  outlier_burst: '센서 이상값 연속', outlier_rate: '센서 이상값 비율', dropout: '센서 유실', stuck: '센서 멈춤', bias: '센서 치우침',
};

/** 수동 사건(onEvent kind) → 지표 계산용 종류 */
const evKind = (k) => (k === 'manual' || k === 'dist' ? 'dist' : k === 'fault' || k === 'fault_manual' ? 'fault' : k);

/**
 * 실시간 기록(러너 행 + TwinDevice 측정·참값 짝) → scenarioMetrics 입력 R (docs/spec/digital-twin.md §6 record 형식의 부분집합)
 * recs: [{ t_s, ref_mm, u_cdeg, dist_mm, filt_mm, y_meas_m, lost, outlier, mode, debug, truth: { y_m, ... } }]
 */
export function recordFromLive(recs) {
  const R = {
    t_s: [], ref_mm: [], dist_mm: [], filt_mm: [], y_meas_m: [], lost: [], outlier: [], fault: [], u_rad: [], u_cdeg: [], mode: [], debug: [],
    truth: { y_m: [], ydot_m_s: [], theta_servo_rad: [], theta_link_rad: [], alpha_rad: [], stuck: [], at_stop: [] },
  };
  for (const r of recs) {
    R.t_s.push(r.t_s); R.ref_mm.push(r.ref_mm); R.dist_mm.push(r.dist_mm); R.filt_mm.push(r.filt_mm); R.y_meas_m.push(r.y_meas_m);
    R.lost.push(r.lost ? 1 : 0); R.outlier.push(r.outlier ? 1 : 0); R.fault.push(r.fault ?? null);
    R.u_cdeg.push(Number.isFinite(r.u_cdeg) ? r.u_cdeg : null); R.u_rad.push(Number.isFinite(r.u_cdeg) ? r.u_cdeg * Math.PI / 18000 : NaN);
    R.mode.push(r.mode); R.debug.push(r.debug || {});
    const t = r.truth;
    R.truth.y_m.push(t.y_m); R.truth.ydot_m_s.push(t.ydot_m_s); R.truth.theta_servo_rad.push(t.theta_servo_rad); R.truth.theta_link_rad.push(t.theta_link_rad);
    R.truth.alpha_rad.push(t.alpha_rad); R.truth.stuck.push(t.stuck ? 1 : 0); R.truth.at_stop.push(t.at_stop);
  }
  return R;
}

/** 빔·공·서보 그림(캔버스 2D). s: { y_m, alpha_rad, theta_servo_rad, theta_link_rad, target_rad, meas_mm, ref_mm, at_stop } */
export function drawRig(cv, s, opts = {}) {
  const g = cv.getContext && cv.getContext('2d');
  if (!g) return;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const W = cv.clientWidth || 560, H = opts.height || 190;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = typeof getComputedStyle === 'function' && cv.parentNode ? getComputedStyle(cv.parentNode) : null;
  const v = (k, d) => (css && css.getPropertyValue && css.getPropertyValue(k).trim()) || d;
  const ink = v('--ink', '#1d232a'), muted = v('--muted', '#5d6670'), grid = v('--grid', '#e7eaee');
  const L = 0.34, mag = opts.mag || 3;
  const m = { l: 56, r: 64 };
  const px = (W - m.l - m.r) / L;
  const pivot = { x: m.l, y: H * 0.52 };
  const a = (Number.isFinite(s.alpha_rad) ? s.alpha_rad : 0) * mag;
  const ca = Math.cos(a), sa = Math.sin(a);
  const at = (y, off = 0) => ({ x: pivot.x + y * px * ca + off * sa, y: pivot.y - y * px * sa - off * ca });
  // 바닥·받침
  g.strokeStyle = grid; g.lineWidth = 1; g.beginPath(); g.moveTo(10, H - 18); g.lineTo(W - 10, H - 18); g.stroke();
  g.fillStyle = muted; g.beginPath(); g.moveTo(pivot.x, pivot.y); g.lineTo(pivot.x - 10, H - 18); g.lineTo(pivot.x + 10, H - 18); g.closePath(); g.fill();
  // 센서(왼쪽 끝)
  g.fillStyle = muted; const sp = at(0, 8); g.fillRect(sp.x - 22, sp.y - 9, 14, 18);
  g.font = '11px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText('초음파', 4, pivot.y - 18);
  // 빔
  const e1 = at(L);
  g.strokeStyle = ink; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(pivot.x, pivot.y); g.lineTo(e1.x, e1.y); g.stroke();
  // 멈춤판
  g.lineWidth = 3; for (const yy of [0.02, 0.33]) { const p0 = at(yy, 3), p1 = at(yy, 16); g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke(); }
  // 서보와 연결봉(오른쪽 끝 아래)
  const sv = { x: e1.x, y: H - 40 };
  const armR = 22;
  const th = Number.isFinite(s.theta_servo_rad) ? s.theta_servo_rad : 0;
  const tl = Number.isFinite(s.theta_link_rad) ? s.theta_link_rad : th;
  g.fillStyle = muted; g.fillRect(sv.x - 16, sv.y - 8, 32, 24);
  if (Number.isFinite(s.target_rad)) {
    g.strokeStyle = muted; g.setLineDash([3, 3]); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(sv.x, sv.y); g.lineTo(sv.x - armR * Math.cos(s.target_rad * mag), sv.y - armR * Math.sin(s.target_rad * mag)); g.stroke(); g.setLineDash([]);
  }
  const armEnd = { x: sv.x - armR * Math.cos(tl * mag), y: sv.y - armR * Math.sin(tl * mag) };
  g.strokeStyle = '#D55E00'; g.lineWidth = 4; g.beginPath(); g.moveTo(sv.x, sv.y); g.lineTo(armEnd.x, armEnd.y); g.stroke();
  g.strokeStyle = grid; g.lineWidth = 2; g.beginPath(); g.moveTo(armEnd.x, armEnd.y); g.lineTo(e1.x - 4, e1.y + 4); g.stroke();
  g.fillStyle = ink; g.textAlign = 'center'; g.fillText(`서보 ${fmt(th * R2D, 2)}°`, sv.x, H - 4);
  // 설정값 표시
  if (Number.isFinite(s.ref_mm)) { const r = at(s.ref_mm / 1000, -10); g.fillStyle = '#009E73'; g.beginPath(); g.moveTo(r.x, r.y); g.lineTo(r.x - 5, r.y + 8); g.lineTo(r.x + 5, r.y + 8); g.closePath(); g.fill(); }
  // 센서 측정(빈 원)
  if (Number.isFinite(s.meas_mm) && s.meas_mm >= 0) {
    const q = at(Math.max(0, Math.min(L, s.meas_mm / 1000)), 14);
    g.strokeStyle = '#0072B2'; g.lineWidth = 2; g.setLineDash([2, 2]); g.beginPath(); g.arc(q.x, q.y, 11, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]);
  }
  // 공(참 위치)
  if (Number.isFinite(s.y_m)) {
    const b = at(s.y_m, 14);
    g.fillStyle = s.at_stop ? '#CC79A7' : '#E69F00'; g.beginPath(); g.arc(b.x, b.y, 11, 0, 2 * Math.PI); g.fill();
  }
  g.fillStyle = muted; g.textAlign = 'right'; g.font = '11px system-ui, sans-serif';
  g.fillText(`빔 각 ${fmt((s.alpha_rad || 0) * R2D, 2)}° (그림 ${mag}배 과장)`, W - 6, 14);
  g.textAlign = 'left';
  g.fillStyle = '#E69F00'; g.fillText('● 참 위치', m.l, 14);
  g.fillStyle = '#0072B2'; g.fillText('○ 센서 측정', m.l + 70, 14);
  g.fillStyle = '#009E73'; g.fillText('▲ 설정값', m.l + 152, 14);
}

export async function mount(el, props, ctx) {
  checkProps(el, 'twin-lab', props, accepts);
  const dev = ctx.device, runner = ctx.runner;
  const f = twinFetchOf(ctx);
  const prov = h('span', { class: 'muted' });
  el.appendChild(head('디지털 트윈 실험실', badge(TWIN_BADGE, 'b-sim b-twin'), prov));
  el.appendChild(h('div', { class: 'box box-info twin-note' }, h('strong', null, '제어기에 들어가는 것: '), SENSOR_ONLY_NOTE));
  if (!ctx.control || !ctx.control.getController) { el.appendChild(infoBox('제어 모듈(control/registry.js)을 불러오지 못했습니다.')); return {}; }
  let tp = null, scList = [];
  try {
    [tp, scList] = await Promise.all([
      dev && dev.twinInfo ? dev.twinInfo : loadTwinParams(f, ctx.control.idResult ? ctx.control.idResult() : null),
      loadScenarioIndex(f),
    ]);
  } catch (e) { el.appendChild(errorBox(`디지털 트윈 파일을 읽지 못했습니다: ${e.message}`)); return {}; }
  prov.textContent = ` ${paramsProvenanceText(tp)} · ${tp.ref}`;
  const practice = ctx.chapter && ctx.chapter.practice;
  const { list: ctrls, missing } = resolveControllers(props.controllers || DEFAULT_CONTROLLERS, {
    getController: ctx.control.getController, practiceSafe: (id) => practiceParamsFor(practice, id).safe,
  });
  if (missing.length) el.appendChild(infoBox(`등록되지 않은 제어기는 건너뜁니다: ${missing.join(', ')}`));
  if (!ctrls.length) { el.appendChild(errorBox('쓸 수 있는 제어기가 없습니다.')); return {}; }
  const winS = props.window_s ?? 20;
  const allowBatch = props.allow_batch !== false;

  // ---------------------------------------------------------------- 상태
  let scId = props.scenario === undefined ? 'step-nominal' : (props.scenario === 'free' ? '' : props.scenario);
  if (scId && !scList.some((s) => s.id === scId)) { el.appendChild(warnBox(`시나리오 ${scId} 가 목록에 없어 자유 실험으로 시작합니다.`)); scId = ''; }
  let sc = null;
  let cIdx = Math.max(0, ctrls.findIndex((c) => c.key === props.controller || c.id === props.controller));
  let editor = null;
  let alive = true, raf = null;
  let tw = null, offTw = [];
  let buf = [];            // 실시간 측정 [{ t_ms, dist_mm, filt_mm, cmd_cdeg, truth }]
  let lastMeas = null;
  let live = null;         // 진행 중인 실시간 실험 { sid, recs[], events[], t0_ms, endHits0, sc, ctrl }
  let lastTick = null;
  let batch = null;        // 즉시 계산 결과 { r, t0 (애니메이션 시작 시각) }
  let view = 'live';
  let evLog = [];
  let dirty = true;

  // ---------------------------------------------------------------- 화면 뼈대
  const scSel = h('select', { 'aria-label': '시나리오' }, h('option', { value: '' }, '자유 실험(외란은 버튼으로)'), scList.map((s) => h('option', { value: s.id, selected: s.id === scId }, s.title)));
  const cSel = h('select', { 'aria-label': '제어기' }, ctrls.map((c, i) => h('option', { value: i, selected: i === cIdx }, c.label)));
  const scDesc = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  const edBox = h('details', { class: 'twin-gains' }, h('summary', null, '게인 조정'));
  const btnStart = h('button', { class: 'btn primary', onclick: () => startLive() }, '실시간 시작');
  const btnStop = h('button', { class: 'btn', onclick: () => runner.stop('user') }, '정지(저장)');
  const btnEstop = h('button', { class: 'btn estop', onclick: () => runner.estop() }, '비상 정지');
  const btnBatch = allowBatch ? h('button', { class: 'btn', onclick: () => runBatch() }, '즉시 계산(일괄)') : null;
  const btnOn = h('button', { class: 'btn small', onclick: () => turnOn().catch((e) => showErr(e)) }, '트윈 켜기');
  const status = h('span', { class: 'muted' });
  const msg = h('div');
  const faultSel = h('select', { 'aria-label': '센서 고장 종류' }, FAULTS.map((x) => h('option', { value: x.key }, x.label)));
  const dist = {
    pushP: h('button', { class: 'btn small', onclick: () => tw && tw.pushBall(80) }, '공 밀기 +80 mm/s'),
    pushN: h('button', { class: 'btn small', onclick: () => tw && tw.pushBall(-80) }, '공 밀기 −80 mm/s'),
    knock: h('button', { class: 'btn small', onclick: () => tw && tw.knockBeam(2) }, '빔 충격 +2°'),
    fault: h('button', { class: 'btn small', onclick: () => { const x = FAULTS.find((q) => q.key === faultSel.value); if (tw && x) tw.injectFault({ ...x.fault }); } }, '센서 고장 넣기'),
    clear: h('button', { class: 'btn small', onclick: () => tw && tw.clearFaults() }, '고장 해제'),
  };
  const rigWrap = h('div', { class: 'plot twin-rig' });
  const rig = h('canvas', { role: 'img', 'aria-label': '빔·공·서보 애니메이션(참 상태)' });
  rig.style.height = '190px';
  rigWrap.appendChild(rig);
  const metricsBox = h('div', { class: 'tbl-wrap' });
  const evBox = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  el.append(
    h('div', { class: 'row' }, h('label', null, '시나리오 ', scSel), h('label', null, '제어기 ', cSel)),
    scDesc, edBox,
    h('div', { class: 'row' }, btnStart, btnStop, btnEstop, btnBatch, btnOn, status),
    h('div', { class: 'row twin-dist' }, h('span', { class: 'muted' }, '외란: '), dist.pushP, dist.pushN, dist.knock, h('span', { class: 'muted' }, ' 센서: '), faultSel, dist.fault, dist.clear),
    msg, rigWrap);
  const pY = new Plot(el, { height: props.height_px || 220, xLabel: '시간 (s)', yLabel: '측정 거리(표면) (mm)', minYSpan: 20, title: '참 위치 vs 센서 측정' });
  const pA = new Plot(el, { height: 150, xLabel: '시간 (s)', yLabel: '각도 (°)', minYSpan: 2, title: '서보 명령·출력축·링크' });
  el.append(h('h4', null, '지표 (참 위치로 채점 [시뮬레이션])'), metricsBox, evBox);

  const showErr = (e) => { clear(msg).appendChild(errorBox(e.message || String(e))); };

  // ---------------------------------------------------------------- 제어기·시나리오 선택
  const renderEditor = () => {
    const c = ctrls[cIdx];
    const C = ctx.control.getController(c.id);
    for (const n of [...edBox.childNodes]) if (n.tagName !== 'SUMMARY') edBox.removeChild(n);
    editor = paramEditor({ meta: C.meta, values: initialParams(C.meta, { given: c.params }), onChange: (vals, key) => {
      c.params = vals;
      if (live && runner.state === 'running') runner.setParams({ [key]: vals[key] });
    } });
    edBox.appendChild(editor);
  };
  const loadSc = async () => {
    sc = scId ? await loadScenario(f, scId) : null;
    clear(scDesc).append(sc ? `${sc.description || sc.title} 사건: ${scenarioEvents(sc).join(' · ') || '없음'} · 시드 ${sc.seed}` : '자유 실험: 설정값 150 → 200 mm 스텝(10 s). 외란·센서 고장은 아래 버튼으로 직접 넣습니다.');
    if (dev && dev.setTwinScenario && dev.mode === 'twin' && runner.state !== 'running') dev.setTwinScenario(sc);
  };
  scSel.addEventListener('change', (e) => { scId = e.target.value; loadSc().catch(showErr); });
  cSel.addEventListener('change', (e) => { cIdx = Number(e.target.value); renderEditor(); });
  renderEditor();
  try { await loadSc(); } catch (e) { showErr(e); }

  const FREE_PROFILE = { type: 'step', from_mm: 150, to_mm: 200, pre_s: 2, hold_s: 8 };
  const scenarioOrFree = async () => {
    if (sc) return sc;
    const { normalizeScenario } = await import('../../sim/twin/scenario.js');
    return normalizeScenario({ id: 'free', title: '자유 실험', seed: 1, setpoint_profile: FREE_PROFILE });
  };

  // ---------------------------------------------------------------- 트윈 장치 연결
  const detach = () => { offTw.forEach((o) => o()); offTw = []; tw = null; };
  const attach = () => {
    const t = dev && dev.twin;
    if (t === tw) return;
    detach();
    if (!t) return;
    tw = t; buf = []; lastMeas = null;
    offTw.push(t.onMeasure((m) => {
      lastMeas = m;
      const b = { t_ms: m.t_ms, dist_mm: m.dist_mm, filt_mm: m.filt_mm, cmd_cdeg: m.cmd_cdeg, mode: m.mode, truth: m.truth, ref_mm: NaN };
      buf.push(b);
      const cut = m.t_ms - (winS + 2) * 1000;
      while (buf.length && buf[0].t_ms < cut) buf.shift();
      if (live && lastTick && lastTick.sid === live.sid) {
        const r = lastTick.row;
        b.ref_mm = r.ref_mm;
        if (live.t0_ms == null) { live.t0_ms = m.t_ms - r.t_s * 1000; live.endHits0 = t.twin.end_hits; }
        live.recs.push({
          t_s: r.t_s, ref_mm: r.ref_mm, u_cdeg: r.u_cdeg, dist_mm: m.dist_mm, filt_mm: m.filt_mm, mode: m.mode, lost: m.lost, outlier: m.outlier, fault: m.fault,
          y_meas_m: Number.isFinite(live.y_source === 'raw' ? r.y_mm : r.y_filt_mm) && !r.lost ? (live.y_source === 'raw' ? r.y_mm : r.y_filt_mm) / 1000 : NaN,
          debug: lastTick.dbg ? { fallback: !!lastTick.dbg.fallback } : {}, truth: m.truth,
        });
      }
      lastTick = null;
      if (view === 'live') dirty = true;
    }));
    offTw.push(t.onEvent((e) => {
      evLog.push(e); if (evLog.length > 30) evLog.shift();
      if (live) live.events.push(e);
      paintEvents();
    }));
  };
  const turnOn = async () => {
    clear(msg);
    if (!dev) throw new Error('장치 서비스가 없습니다');
    if (runner.state === 'running') throw new Error('다른 실험이 진행 중입니다. 끝난 뒤 다시 하세요.');
    if (dev.mode !== 'twin') {
      if (dev.mode === 'device' && dev.connected) throw new Error('실제 장치가 연결되어 있습니다. 실습 패널에서 연결을 끊은 뒤 디지털 트윈으로 바꾸세요.');
      await dev.setMode('twin');
      msg.appendChild(infoBox('연결 모드를 디지털 트윈으로 바꿨습니다(실습 패널·상단 표시도 같이 바뀝니다).'));
    }
    dev.setTwinScenario(sc);
    if (!dev.connected) await dev.connect();
    attach();
    paintButtons();
  };
  const offs = [];
  if (dev && dev.onStatus) offs.push(dev.onStatus(() => { attach(); paintButtons(); }));
  offs.push(runner.onTick((row, dbg) => { if (live) lastTick = { sid: live.sid, row, dbg }; }));
  offs.push(runner.onState(() => paintButtons()));
  offs.push(runner.onFinish((ev) => { if (live && ev.session_id === live.sid) finishLive(ev); }));
  attach();

  const paintButtons = () => {
    const running = runner.state === 'running';
    const on = !!(dev && dev.twin && dev.connected);
    btnStart.disabled = running || runner.state === 'starting';
    btnStop.disabled = !running;
    if (btnBatch) btnBatch.disabled = false;
    btnOn.style.display = on ? 'none' : '';
    scSel.disabled = running; cSel.disabled = running;
    for (const b of Object.values(dist)) b.disabled = !on;
    status.textContent = running && live ? ` 실험 중(세션 ${live.sid})` : on ? ` 트윈 연결됨${dev.twinOpts && dev.twinOpts.scenario ? ` · 시나리오 ${dev.twinOpts.scenario.id}` : ''}` : ' 트윈 꺼짐 — 외란 버튼은 트윈을 켠 뒤에 씁니다';
  };
  const paintEvents = () => {
    clear(evBox);
    const list = (view === 'batch' && batch ? batch.r.events.map((e) => describeEvent({ ...e, t: +e.t_s.toFixed(2) })) : evLog.map((e) => `${(e.t_ms / 1000).toFixed(1)} s ${e.kind === 'manual' || e.kind === 'fault_manual' ? '(버튼) ' : ''}${describeEvent({ ...e, t: undefined })}`)).slice(-12);
    if (list.length) evBox.append('사건: ', list.join(' · '));
  };

  // ---------------------------------------------------------------- 실시간 실험
  const startLive = async () => {
    clear(msg);
    try {
      await turnOn();
      const s = await scenarioOrFree();
      const { scenarioToProfile } = await import('../../sim/twin/scenario.js');
      const profile = scenarioToProfile(s);
      if (!profile) throw new Error('이 시나리오는 설정값 프로파일로 바꿀 수 없어 실시간 실행이 안 됩니다. "즉시 계산"을 쓰세요.');
      const c = ctrls[cIdx];
      const controller = { id: c.id, params: editor ? editor.values() : c.params };
      live = { sid: null, recs: [], events: [], t0_ms: null, endHits0: 0, sc: s, ctrl: c, y_source: s.loop.y_source };
      view = 'live'; evLog = [];
      const y0 = s.y0_mm ?? startPositionMm(profile);
      live.sid = await runner.start({
        controller, profile, chapter_id: ctx.chapter && ctx.chapter.id, title: `디지털 트윈 · ${c.label} · ${s.title}`,
        y_source: s.loop.y_source, fs_ms: s.loop.fs_ms, alpha: s.loop.alpha_milli / 1000, lim_cdeg: s.loop.lim_cdeg,
        model_kind: s.design_model === 'ball_only' ? 'ball' : 'ball+servo', place_ball_mm: Number.isFinite(y0) ? y0 : undefined,
      });
      clear(metricsBox).appendChild(h('span', { class: 'muted' }, '실험 중… 끝나면 참 위치로 채점합니다.'));
      paintButtons();
    } catch (e) { live = null; showErr(e); paintButtons(); }
  };

  const finishLive = async (ev) => {
    const L = live; live = null;
    try {
      const { scenarioMetrics } = await import('../../sim/twin/scenario.js');
      if (L.recs.length < 3) { clear(metricsBox).appendChild(infoBox('기록이 너무 짧아 지표를 계산하지 않았습니다.')); return; }
      const R = recordFromLive(L.recs);
      const events = L.events.filter((e) => ['dist', 'fault', 'manual', 'fault_manual'].includes(e.kind)).map((e) => ({ ...e, kind: evKind(e.kind), t_s: (e.t_ms - L.t0_ms) / 1000 }));
      const status2 = ev.complete ? 'ok' : (ev.reason === 'estop' ? 'estop' : ev.reason === 'heartbeat' ? 'heartbeat' : 'aborted');
      const met = scenarioMetrics(L.sc, R, { lim_cdeg: L.sc.loop.lim_cdeg, end_hits: (tw ? tw.twin.end_hits : 0) - L.endHits0, status: status2, events });
      paintMetrics(met, { label: L.ctrl.label, source: `실시간 세션 ${ev.session_id}${ev.complete ? '' : ' (중단됨)'}` });
    } catch (e) { showErr(e); }
  };

  // ---------------------------------------------------------------- 즉시 계산
  const runBatch = async () => {
    clear(msg);
    try {
      const s = await scenarioOrFree();
      const { runScenario } = await import('../../sim/twin/scenario.js');
      const c = ctrls[cIdx];
      const r = runScenario({ scenario: s, params: tp.params, controller: { id: c.id, params: editor ? editor.values() : c.params }, seed: s.seed, truth_dt_s: 0.02 });
      batch = { r, sc: s, label: c.label, t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()) };
      view = 'batch';
      dirty = true;
      paintMetrics(r.metrics, { label: c.label, source: `즉시 계산 · 시드 ${r.seed}${r.status !== 'ok' ? ` · 상태 ${r.status}` : ''}`, kb: [r.kb_design, r.kb_twin] });
      paintEvents();
    } catch (e) { showErr(e); }
  };

  const paintMetrics = (m, { label, source, kb } = {}) => {
    clear(metricsBox);
    const si = m.stepinfo || {};
    const verdict = m.success ? badge('성공', 'b-real') : badge('실패', 'b-bad');
    metricsBox.append(
      h('div', { class: 'readout' }, h('b', null, label), ' ', verdict, ' ', h('span', { class: 'muted' }, source),
        kb ? h('span', { class: 'muted' }, ` · K_b 설계 ${fmt(kb[0], 4)} / 트윈 ${fmt(kb[1], 4)}`) : null),
      table(['ITAE (m·s²)', '오버슈트 (%)', '정착시간 (s)', 'e_ss (mm)', '마지막 오차 최대 (mm)', '측정−참값 RMS (mm)', '포화 비율', '멈춤판 충돌', '유실 비율'], [[
        fmt(m.itae, 4), fmt(si.po, 1), si.ts == null ? '미정착' : fmt(si.ts, 2), si.ess == null ? '–' : fmt(si.ess * 1000, 1), fmt(m.final_err_mm, 1), fmt(m.meas_err_rms_mm, 2),
        fmt(m.u_sat_ratio, 3), m.end_hit ? `${m.end_hits}회` : '없음', fmt(m.lost_ratio, 3)]]));
    if (m.disturbances && m.disturbances.length) {
      metricsBox.appendChild(table(['사건', '시각 (s)', '최대 오차 (mm)', '회복 시간 (s)'], m.disturbances.map((d) => [EVENT_NAME[d.type] || d.type, fmt(d.t_s, 2), fmt(d.peak_err_mm, 1), d.recovery_s == null ? '회복 못 함' : fmt(d.recovery_s, 2)])));
    }
    metricsBox.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `성공 = 끝까지 실행 · 멈춤판 충돌 없음 · 마지막 2 s 동안 참 위치 오차 ≤ 10 mm. 지표는 트윈 내부 참 위치로 계산합니다(센서 잡음이 점수를 흐리지 않게). 오버슈트·정착시간·e_ss는 첫 스텝부터 다음 사건(외란·고장·설정값 변경) 전까지 구간에서, e_ss = |설정값 − 최종값|(최종값 = 구간 마지막 20%의 참 위치 평균). 정착 = 최종값 둘레 ±5% 띠(스텝 크기 기준) 안에 마지막 이탈 뒤 1 s 이상(구간이 짧으면 구간 길이의 1/4) 머묾. 트윈 파라미터가 [가정]이므로 실측 우열의 근거가 아닙니다.`));
  };

  // ---------------------------------------------------------------- 그리기(rAF — 제어 루프와 분리)
  const render = () => {
    let st = null, x = [], yT = [], yD = [], yF = [], ref = [], aU = [], aS = [], aL = [];
    if (view === 'batch' && batch) {
      const R = batch.r.record, D = R.dense;
      const tNow = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - batch.t0) / 1000 * 2;
      const tEnd = R.t_s.length ? R.t_s[R.t_s.length - 1] : 0;
      const tc = Math.min(tNow, tEnd);
      let k = 0; while (k + 1 < R.t_s.length && R.t_s[k + 1] <= tc) k++;
      let kd = 0; if (D) while (kd + 1 < D.t_s.length && D.t_s[kd + 1] <= tc) kd++;
      st = D ? { y_m: D.y_m[kd], alpha_rad: D.alpha_rad[kd], theta_servo_rad: D.theta_servo_rad[kd], theta_link_rad: D.theta_link_rad[kd] }
        : { y_m: R.truth.y_m[k], alpha_rad: R.truth.alpha_rad[k], theta_servo_rad: R.truth.theta_servo_rad[k], theta_link_rad: R.truth.theta_link_rad[k] };
      st.meas_mm = R.dist_mm[k]; st.ref_mm = R.ref_mm[k]; st.target_rad = Number.isFinite(R.u_rad[k]) ? R.u_rad[k] : NaN;
      if (dirty || tNow <= tEnd + 0.2) {
        for (let i = 0; i <= k; i++) {
          x.push(R.t_s[i]); yT.push(R.truth.y_m[i] * 1000); yD.push(R.dist_mm[i] >= 0 ? R.dist_mm[i] : NaN); yF.push(R.filt_mm[i] >= 0 ? R.filt_mm[i] : NaN); ref.push(R.ref_mm[i]);
          aU.push(R.cmd_cdeg[i] / 100); aS.push(R.truth.theta_servo_rad[i] * R2D); aL.push(R.truth.theta_link_rad[i] * R2D);
        }
        setPlots(x, yT, yD, yF, ref, aU, aS, aL, [0, Math.max(5, batch.sc.duration_s)], `즉시 계산: ${batch.label}`);
        dirty = tNow <= tEnd + 0.2;
      }
    } else {
      const t = tw ? tw.getTruth() : null;
      if (t) {
        st = { ...t, meas_mm: lastMeas ? lastMeas.dist_mm : NaN, target_rad: t.target_rad };
        const lt = live && runner.state === 'running' ? runner.ring.last() : null;
        st.ref_mm = lt ? lt.ref_mm : NaN;
      }
      if (dirty && buf.length) {
        const t0 = buf[buf.length - 1].t_ms / 1000 - winS;
        for (const b of buf) {
          if (b.t_ms / 1000 < t0) continue;
          x.push(b.t_ms / 1000); yT.push(b.truth.y_m * 1000); yD.push(b.dist_mm >= 0 ? b.dist_mm : NaN); yF.push(b.filt_mm >= 0 ? b.filt_mm : NaN); ref.push(b.ref_mm);
          aU.push(b.cmd_cdeg / 100); aS.push(b.truth.theta_servo_rad * R2D); aL.push(b.truth.theta_link_rad * R2D);
        }
        setPlots(x, yT, yD, yF, ref, aU, aS, aL, [Math.max(0, x[x.length - 1] - winS), Math.max(winS, x[x.length - 1])], '실시간 (장치 시각)');
        dirty = false;
      }
    }
    if (st) drawRig(rig, st);
  };
  const setPlots = (x, yT, yD, yF, ref, aU, aS, aL, xr, cap) => {
    pY.setOpts({ xRange: xr, title: cap });
    pY.setSeries([
      { label: '참 위치(트윈)', x, y: yT, color: '#E69F00', width: 2.2 },
      { label: '센서 원측정', x, y: yD, ...styleOf(0), width: 1, alpha: 0.6 },
      { label: '필터값(제어기 입력)', x, y: yF, ...styleOf(5), width: 1.6 },
      { label: '설정값', x, y: ref, ...styleOf(2), width: 1.2, step: true },
    ]);
    pA.setOpts({ xRange: xr });
    pA.setSeries([
      { label: '명령 u', x, y: aU, ...styleOf(1), width: 1.4, step: true },
      { label: '서보 출력축(참)', x, y: aS, ...styleOf(3), width: 1.6 },
      { label: '링크(참)', x, y: aL, ...styleOf(6), width: 1.2 },
    ]);
  };
  const loop = () => { if (!alive) return; try { render(); } catch (e) { console.error(e); } raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(loop) : null; };
  paintButtons();
  paintEvents();
  loop();
  return {
    unmount() { alive = false; if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf); detach(); offs.forEach((o) => o()); pY.destroy(); pA.destroy(); },
    runBatch, startLive, turnOn,
    get state() { return { view, scenario: sc && sc.id, controller: ctrls[cIdx], batch, live, attached: !!tw }; },
  };
}
