// live-plot: 실시간 그래프(러너 링 버퍼를 rAF에서 읽음 — 제어 루프와 분리) + 모델 예측 + 세션 저장·승격 버튼.
// 디지털 트윈 모드: '디지털 트윈 [시뮬레이션]' 배지와 참 위치(트윈 내부 상태, 제어기에는 가지 않음)를 겹쳐 그린다.
// 참 위치는 세션 CSV 에 넣지 않는다(docs/spec/digital-twin.md §6) — 화면 전용.
// 좌표 보기(ui/coord.js): '측정 거리(표면)'(기본, 저장·제어 좌표) / '공 중심 = 측정 + R'. 화면에서만 바꾸고 저장 값은 그대로.

import { h, checkProps, clear, badge, modal, toast, provenanceBadge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, kv } from './_util.js';
import { predict, SIGNAL_INFO } from '../sources.js';
import { PRACTICE_CHANNEL, modeBadges, allowedModes } from './controller-panel.js';
import { MODE_LABEL } from '../../serial/device.js';
import { coordToggle, getView, radiusOf, axisLabel, viewMm, centerMm } from '../coord.js';

export const accepts = ['signals', 'window_s', 'show_debug', 'show_prediction', 'actions'];

const MM = ['y_mm', 'y_filt_mm', 'ref_mm'];
const DEG = ['u_cdeg', 'servo_pot_cdeg', 'cmd_echo_cdeg'];

export function mount(el, props, ctx) {
  checkProps(el, 'live-plot', props, accepts);
  const runner = ctx.runner;
  const signals = props.signals || ['y_mm', 'y_filt_mm', 'ref_mm', 'u_cdeg', 'servo_pot_cdeg'];
  const win = props.window_s ?? 20;
  const actions = props.actions || ['save', 'promote'];
  const shared = ctx.bus ? ctx.bus.channel(PRACTICE_CHANNEL) : null;
  const tag = h('span');
  el.appendChild(head('실시간 그래프', tag));
  const mmSig = signals.filter((s) => MM.includes(s));
  const degSig = signals.filter((s) => DEG.includes(s));
  let view = getView();
  const pPos = mmSig.length || props.show_prediction !== false ? new Plot(el, { height: props.height_px || 220, xLabel: '시간 (s)', yLabel: axisLabel(view, radiusOf(ctx)), minYSpan: 20 }) : null;
  const pAng = degSig.length ? new Plot(el, { height: 160, xLabel: '시간 (s)', yLabel: '각도 (°)', minYSpan: 2 }) : null;
  const pDbg = props.show_debug !== false ? new Plot(el, { height: 140, xLabel: '시간 (s)', yLabel: '제어기 내부(SI)' }) : null;
  const read = h('div', { class: 'readout' });
  const act = h('div', { class: 'row' });
  el.append(read, act);

  // 디지털 트윈 참 위치: D 줄 → 러너 tick(row) → TwinDevice onMeasure 순서로 같은 줄에서 짝을 맞춘다
  const dev = ctx.device;
  const truth = { x: [], y: [], meta: null };
  let lastTick = null, offTruth = null, offTickT = null;
  const subTwin = () => {
    if (offTruth) { offTruth(); offTruth = null; }
    const tw = dev && dev.twin;
    if (!tw || !tw.onMeasure) return;
    offTruth = tw.onMeasure((m) => {
      if (!lastTick || !m.truth) return;
      if (runner.ring.meta !== truth.meta) { truth.meta = runner.ring.meta; truth.x = []; truth.y = []; }
      truth.x.push(lastTick.t_s); truth.y.push(m.truth.y_m * 1000);
      if (truth.x.length > 8000) { truth.x.splice(0, 2000); truth.y.splice(0, 2000); }
      lastTick = null;
    });
  };
  offTickT = runner.onTick((row) => { lastTick = row; });
  subTwin();

  let pred = null, predKey = '';
  let lastVer = -1, raf = null, alive = true, lastSid = null, paused = false;
  const updatePrediction = () => {
    if (props.show_prediction === false || !shared) { pred = null; return; }
    const s = shared.get();
    const key = JSON.stringify([s.controller, s.profile, s.plant, s.lim_cdeg]);
    if (key === predKey) return;
    predKey = key;
    pred = null;
    if (!s.controller || !s.profile) return;
    try {
      const r = predict(ctx, { controller: s.controller, plant: s.plant, profile: s.profile, lim_cdeg: s.lim_cdeg });
      if (r) pred = { x: r.rows.map((q) => q.t_s), y: r.rows.map((q) => q.y_mm), u: r.rows.map((q) => q.u_cdeg / 100), label: `예측(${s.plant === 'ball+servo' ? '서보 포함' : '서보 무시'} 모델)` };
    } catch (e) { console.warn('예측 실패', e); }
  };

  const render = () => {
    const ring = runner.ring;
    if (ring.version === lastVer || paused) return;
    lastVer = ring.version;
    const rows = ring.meta.monitor ? ring.window(win) : ring.toArray();
    const meta = ring.meta || {};
    clear(tag).append(meta.monitor ? badge('모니터(IDLE)', 'b-unknown') : meta.replay ? badge('재생', 'b-unknown') : runner.state === 'running' ? badge('실험 중', 'b-run') : badge('마지막 실험', 'b-unknown'),
      ...(meta.twin ? modeBadges('twin') : [provenanceBadge(meta.provenance)]));
    const x = rows.map((r) => r.t_s);
    const tEnd = x.length ? x[x.length - 1] : 0;
    const range = meta.monitor || !x.length ? null : [Math.max(0, tEnd - win), Math.max(win, tEnd)];
    const col = (k, sc = 1) => rows.map((r) => (typeof r[k] === 'number' ? r[k] * sc : NaN));
    const R = radiusOf(ctx);
    const vm = (a) => (view === 'center' ? a.map((v) => viewMm(v, view, R)) : a);
    const vLab = (l) => (view === 'center' ? `${l} → 공 중심` : l);
    if (pPos) {
      const ser = mmSig.map((k, i) => ({ label: vLab((SIGNAL_INFO[k] || {}).label || k), x, y: vm(col(k)), ...styleOf(i), width: k === 'y_mm' ? 1.2 : 2, step: k === 'ref_mm', alpha: k === 'y_mm' ? 0.6 : 1 }));
      if (pred && !meta.monitor) ser.push({ label: vLab(pred.label), x: pred.x, y: vm(pred.y), ...styleOf(4), width: 1.5 });
      if (meta.twin && truth.meta === meta && truth.x.length) {
        const x0 = x.length ? x[0] : -Infinity;
        let k0 = 0; while (k0 < truth.x.length && truth.x[k0] < x0) k0++;
        ser.push({ label: vLab('참 위치(트윈 내부·측정 거리 좌표, 제어기에 안 감)'), x: truth.x.slice(k0), y: vm(truth.y.slice(k0)), color: '#000000', dash: [2, 2], width: 1.6 });
      }
      pPos.setOpts({ xRange: range, yLabel: axisLabel(view, R) }); pPos.setSeries(ser);
    }
    if (pAng) { pAng.setOpts({ xRange: range }); pAng.setSeries(degSig.map((k, i) => ({ label: (SIGNAL_INFO[k] || {}).label || k, x, y: col(k, 0.01), ...styleOf(i + 1), step: k === 'u_cdeg' }))); }
    if (pDbg) {
      const keys = rows.length ? Object.keys(rows[rows.length - 1]).filter((k) => k.startsWith('dbg_') && !['dbg_saturated', 'dbg_lost'].includes(k)) : [];
      pDbg.setOpts({ xRange: range });
      pDbg.setSeries(keys.map((k, i) => ({ label: k.slice(4), x, y: col(k), ...styleOf(i + 2), width: 1.5 })));
    }
    const last = rows[rows.length - 1];
    clear(read);
    if (last) {
      const nLost = rows.filter((r) => r.lost === 1).length;
      const yv = last.y_filt_mm ?? last.y_mm;
      read.append(kv('t', last.t_s, 's'), kv('측정 거리(표면) y', yv, 'mm'), h('span', { class: 'kv', 'data-role': 'center-readout' }, h('b', null, `공 중심(+${R}) `), Number.isFinite(centerMm(yv, R)) ? `${centerMm(yv, R).toFixed(1)} mm` : '–'),
        kv('설정값(측정 거리)', last.ref_mm, 'mm'), kv('u', Number.isFinite(last.u_cdeg) ? last.u_cdeg / 100 : null, '°'), kv('유실', `${nLost}/${rows.length}`));
      if (runner.state === 'running') { const st = runner.stats; read.append(kv('Δt 평균', st.dt_mean_ms, 'ms'), kv('Δt 최대', st.dt_max_ms, 'ms')); }
      if (last.dbg_saturated === 1) read.append(badge('포화', 'b-bad'));
    } else read.append(h('span', { class: 'muted' }, `데이터 없음 — 실습 패널에서 연결하거나 실험을 시작하세요${dev ? ` (현재 모드: ${MODE_LABEL[dev.mode] || dev.mode})` : ''}.`));
  };
  const loop = () => { if (!alive) return; render(); raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(loop) : null; };

  // 버튼
  const btns = {};
  if (actions.includes('save')) btns.save = h('button', { class: 'btn', disabled: true, onclick: () => editSession() }, '세션 제목·메모 저장');
  if (actions.includes('promote')) btns.promote = h('button', { class: 'btn', disabled: true, onclick: () => lastSid && ctx.ui && ctx.ui.openPromote(lastSid, { slots: ctx.chapter && ctx.chapter.promote_slots }) }, '샘플로 승격');
  const pauseBtn = h('button', { class: 'btn small', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? '그래프 재개' : '그래프 일시정지'; lastVer = -1; } }, '그래프 일시정지');
  const info = h('span', { class: 'muted' });
  // 연결 모드 선택(실습 패널 탭과 같은 목록: 챕터가 가상 장치를 허용하면 디지털 트윈도). 실험 중에는 바꿀 수 없다
  const modeSel = dev && dev.setMode ? h('select', { 'aria-label': '연결 모드', onchange: async (e) => {
    try { await dev.setMode(e.target.value); } catch (er) { toast(er.message, 'error'); }
    paintMode();
  } }) : null;
  const paintMode = () => {
    if (!modeSel) return;
    clear(modeSel);
    const pr = ctx.chapter && ctx.chapter.practice;
    for (const m of allowedModes(pr && pr.modes)) {
      modeSel.appendChild(h('option', { value: m, selected: dev.mode === m, disabled: m === 'device' && dev.supported === false }, MODE_LABEL[m]));
    }
    modeSel.disabled = runner.state === 'running';
  };
  paintMode();
  const ct = coordToggle(ctx, (v) => { view = v; lastVer = -1; });
  act.append(...Object.values(btns), pauseBtn, modeSel ? h('label', { class: 'muted' }, '모드 ', modeSel) : '', ct.el, info);
  const setLast = (sid, complete) => {
    lastSid = sid;
    for (const b of Object.values(btns)) b.disabled = !sid;
    info.textContent = sid ? `마지막 세션 ${sid}${complete === false ? ' (중단됨 — 데이터는 저장됨)' : ''}` : '';
  };
  const editSession = async () => {
    if (!lastSid) return;
    const s = await ctx.store.sessions.get(lastSid);
    if (!s) return;
    const t = h('input', { type: 'text', value: s.meta.title || '', style: { width: '100%' } });
    const n = h('textarea', { rows: 3, style: { width: '100%' }, value: s.meta.notes || '' });
    const m = modal('세션 저장', h('div', null,
      h('p', { class: 'muted' }, '실험이 끝나면 세션은 자동 저장됩니다. 여기서는 제목과 메모를 붙입니다.'),
      h('label', null, '제목', t), h('label', null, '메모(무엇을 바꿨고 왜)', n),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { await ctx.store.sessions.update(lastSid, { title: t.value, notes: n.value }); m.close(); toast('저장했습니다', 'ok'); } }, '저장'))));
  };
  const offs = [ct.off];
  if (offTickT) offs.push(offTickT);
  if (dev && dev.onStatus) offs.push(dev.onStatus(() => { subTwin(); paintMode(); lastVer = -1; }));
  offs.push(() => { if (offTruth) offTruth(); });
  offs.push(runner.onFinish((ev) => setLast(ev.session_id, ev.complete)));
  offs.push(runner.onState((s) => { paintMode(); if (s === 'running') { updatePrediction(); lastVer = -1; } }));
  if (shared) offs.push(shared.subscribe(() => { updatePrediction(); lastVer = -1; }));
  if (ctx.chapter && ctx.store) ctx.store.sessions.list({ chapter_id: ctx.chapter.id }).then((l) => { if (l[0] && !lastSid) setLast(l[0].session_id, l[0].complete); }).catch(() => {});
  updatePrediction();
  loop();
  if (!raf) render();
  return { unmount() { alive = false; if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf); offs.forEach((f) => f()); pPos && pPos.destroy(); pAng && pAng.destroy(); pDbg && pDbg.destroy(); } };
}
