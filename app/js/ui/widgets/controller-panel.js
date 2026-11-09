// controller-panel: 실습 모드(장치/가상/디지털 트윈/샘플), 연결, 제어기·파라미터·프로파일, 시작/정지/비상 정지 (chapter-format §6.5).
// 디지털 트윈 탭은 챕터가 가상 장치(virtual)나 twin 을 허용하면 보인다(둘 다 시뮬레이션). 트윈 모드에서는 시나리오를 고른다.
// 같은 챕터의 live-plot·validation-run은 ctx.bus 채널 '__practice'로 현재 선택({controller, profile, plant})을 받는다.

import { h, checkProps, clear, errorBox, infoBox, warnBox, toast, badge } from '../dom.js';
import { head, sourceBadges, practiceParamsFor } from './_util.js';
import { paramEditor, profileEditor, initialParams, startPositionMm } from '../param-editor.js';
import { resolveSources } from '../sources.js';
import { paramDiff } from './attempt-log.js';
import { MODE_LABEL, isSimMode } from '../../serial/device.js';
import { TWIN_BADGE, SENSOR_ONLY_NOTE, twinFetchOf, loadScenarioIndex, loadScenario, scenarioEvents, paramsProvenanceText } from '../twin/lib.js';
import { radiusOf } from '../coord.js';

export const accepts = ['controllers', 'show_profile_editor'];

export const PRACTICE_CHANNEL = '__practice';

/** 챕터 practice.modes → 화면에 보일 모드. 가상 장치를 허용하면 디지털 트윈도 허용(둘 다 시뮬레이션) */
export function allowedModes(modes) {
  const m = (modes || ['virtual', 'sample']).slice();
  if (m.includes('virtual') && !m.includes('twin')) m.splice(m.indexOf('virtual') + 1, 0, 'twin');
  return m;
}

/** 연결 모드 배지(실습 패널·셸 공통 문구) */
export function modeBadges(mode) {
  if (mode === 'device') return [badge('실측', 'b-real')];
  if (mode === 'twin') return [badge(TWIN_BADGE, 'b-sim b-twin')];
  return [badge('시뮬레이션', 'b-sim')];
}

/** 챕터 practice → 러너 start 옵션(시험용 순수 함수) */
export function runOptions(practice, { controller, profile, chapter_id, attempt, mode }) {
  const p = practice || {};
  return {
    controller, profile, chapter_id, attempt,
    lim_cdeg: p.angle_limit_deg != null ? Math.round(p.angle_limit_deg * 100) : undefined,
    fs_ms: p.fs_ms ?? 60, alpha: p.alpha ?? undefined, y_source: p.y_source || 'filt',
    model_kind: p.model || 'ball',
    place_ball_mm: isSimMode(mode) ? startPositionMm(profile) : undefined,
  };
}

export function mount(el, props, ctx) {
  checkProps(el, 'controller-panel', props, accepts);
  const practice = (ctx.chapter && ctx.chapter.practice) || null;
  const dev = ctx.device, runner = ctx.runner;
  if (!dev || !runner) { el.appendChild(errorBox('장치·러너 서비스가 없습니다.')); return {}; }
  const modes = allowedModes(practice && practice.modes);
  const reg = ctx.control && ctx.control.registry;
  const ids = props.controllers || (practice && (practice.controllers_allowed || [practice.controller])) || ['pid'];
  const shared = ctx.bus ? ctx.bus.channel(PRACTICE_CHANNEL) : { get: () => ({}), set() {}, subscribe: () => () => {} };
  const offs = [];
  const tok = Symbol('controller-panel');
  const getC = (id) => { try { return ctx.control.getController(id); } catch { return null; } };
  el.appendChild(head('실습 패널', badge(ctx.chapter ? ctx.chapter.title || ctx.chapter.id : '', 'b-unknown')));

  // 모드
  const tabs = h('div', { class: 'mode-tabs', role: 'tablist' });
  const connRow = h('div', { class: 'row' });
  const body = h('div');
  const msg = h('div');
  el.append(tabs, connRow, msg, body);
  // 챕터가 허용하지 않는 모드면 바꾼다. 단 연결된 장치는 말없이 끊지 않는다(안내만)
  if (!modes.includes(dev.mode)) {
    if (!dev.connected && runner.state !== 'running') dev.setMode(modes.includes('virtual') ? 'virtual' : modes[0]).catch(() => {});
    else msg.appendChild(infoBox(`이 챕터 실습 모드는 ${modes.map((m) => MODE_LABEL[m]).join('/')}입니다. 현재 ${MODE_LABEL[dev.mode]}가 연결되어 있어 그대로 둡니다. 위 탭에서 바꾸면 연결이 끊깁니다.`));
  }

  const renderTabs = () => {
    clear(tabs);
    for (const m of ['device', 'virtual', 'twin', 'sample']) {
      if (!modes.includes(m)) continue;
      const dis = (m === 'device' && !dev.supported) || runner.state === 'running';
      tabs.appendChild(h('button', { class: dev.mode === m ? 'on' : '', disabled: dis, role: 'tab', 'aria-selected': dev.mode === m, title: m === 'device' && !dev.supported ? dev.unsupportedReason : '',
        onclick: async () => { try { await dev.setMode(m); } catch (e) { toast(e.message, 'error'); } renderAll(); } }, MODE_LABEL[m]));
    }
  };

  const renderConn = () => {
    clear(connRow);
    if (dev.mode === 'sample') { connRow.append(h('span', { class: 'muted' }, '샘플 재생: 저장된 데이터를 다시 그립니다(장치 불필요).')); return; }
    const st = { disconnected: '연결 안 됨', connecting: '연결 중…', connected: '연결됨', error: '오류' }[dev.status];
    connRow.append(h('span', { class: `dot ${dev.status}` }), ` ${MODE_LABEL[dev.mode]} ${st} `, ...modeBadges(dev.mode));
    if (dev.connected) connRow.append(h('button', { class: 'btn small', onclick: () => dev.disconnect() }, '연결 끊기'));
    else connRow.append(h('button', { class: 'btn small primary', disabled: dev.status === 'connecting', onclick: () => connect() }, { device: '장치 연결(포트 선택)', virtual: '가상 장치 켜기', twin: '디지털 트윈 켜기' }[dev.mode] || '연결'));
    if (dev.lastError && dev.status === 'error') connRow.append(h('span', { class: 'muted' }, ` ${dev.lastError}`));
  };

  const connect = async () => {
    try { await dev.connect(); } catch (e) { clear(msg).appendChild(errorBox(e.message)); }
  };

  // 제어기·파라미터·프로파일
  let ctrlId = ids[0];
  let editor = null, profEd = null;
  let attempt = 0;
  let lastCtrl = null;
  const publish = () => shared.set({ controller: { id: ctrlId, params: editor ? editor.values() : {} }, profile: profEd ? profEd.value() : (practice && practice.setpoint_profile), plant: (practice && practice.model) || 'ball', lim_cdeg: practice && practice.angle_limit_deg != null ? practice.angle_limit_deg * 100 : null }, tok);

  const renderControl = (box) => {
    if (!reg) { box.appendChild(infoBox('제어기 모듈(control/registry.js)이 아직 준비되지 않았습니다.')); return; }
    const sel = h('select', { disabled: ids.length < 2, onchange: (e) => { ctrlId = e.target.value; renderAll(); } },
      ids.map((id) => { const C = getC(id); return h('option', { value: id, selected: id === ctrlId }, C ? C.meta.label : `${id} (없음)`); }));
    const C = getC(ctrlId);
    box.appendChild(h('div', { class: 'row' }, h('label', null, '제어기 ', sel), C && C.meta.needs_model ? badge('모델 필요', 'b-unknown') : null));
    if (!C) { box.appendChild(errorBox(`제어기 ${ctrlId} 가 아직 구현되지 않았습니다.`)); return; }
    if (dev.mode === 'twin') box.appendChild(twinSection());
    const prev = shared.get().controller;
    const given = prev && prev.id === ctrlId ? prev.params : {};
    const pp = practiceParamsFor(practice, ctrlId);
    const values = initialParams(C.meta, { safe: pp.safe, given, limits: pp.limits });
    editor = paramEditor({ meta: C.meta, values, limits: pp.limits, device: dev.mode === 'device',
      onChange: (v, key) => { publish(); if (runner.state === 'running') runner.setParams({ [key]: v[key] }); } });
    box.appendChild(editor);
    if (props.show_profile_editor !== false) {
      profEd = profileEditor(shared.get().profile || (practice && practice.setpoint_profile), { standard: practice && practice.setpoint_profile, radius_mm: radiusOf(ctx), onChange: () => publish() });
      box.appendChild(h('div', { class: 'panel-sec' }, profEd));
    } else {
      profEd = null;
    }
    const lim = practice && practice.angle_limit_deg;
    box.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } },
      `각도 한계 ±${lim ?? '설정값'}° · 데이터 주기 ${(practice && practice.fs_ms) || 60} ms · 필터 α ${(practice && practice.alpha) ?? '설정값'} · 측정 ${(practice && practice.y_source) === 'raw' ? '원측정' : '필터값'}(측정 거리(표면) = 센서 → 공 표면, 공 중심 = 측정 + ${radiusOf(ctx)} mm) · 예측 모델 ${(practice && practice.model) === 'ball+servo' ? '서보 포함' : '서보 무시'}`));
    // 실행 버튼
    const startBtn = h('button', { class: 'btn primary', disabled: runner.state === 'running', onclick: () => start() }, runner.state === 'running' ? '실행 중…' : '실험 시작');
    const stopBtn = h('button', { class: 'btn', disabled: runner.state !== 'running', onclick: () => runner.stop('user') }, '정지(저장)');
    const estop = h('button', { class: 'btn estop', onclick: () => runner.estop() }, '비상 정지');
    box.appendChild(h('div', { class: 'row panel-sec' }, startBtn, stopBtn, estop, h('span', { class: 'muted' }, `시도 ${attempt}회`)));
    if (dev.mode === 'device') box.appendChild(warnBox(`실기: 시작 전에 공을 시작 위치(측정 거리 = 센서 → 공 표면, 공 중심은 ${radiusOf(ctx)} mm 더 멂)에 손으로 놓고, 빔 주변에서 손을 치우세요. 이상하면 비상 정지(Esc).`));
    publish();
  };

  // 디지털 트윈: 시나리오 선택(자유 실험 = 시나리오 없음). 시나리오 설정값을 프로파일 편집기에 넣는다
  let twinScId = dev.twinOpts && dev.twinOpts.scenario ? dev.twinOpts.scenario.id : '';
  const twinSection = () => {
    const box = h('div', { class: 'panel-sec twin-sec' });
    const sel = h('select', { disabled: runner.state === 'running' }, h('option', { value: '' }, '자유 실험(외란 없음 — 버튼으로 직접)'));
    const evs = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
    const prov = h('span', { class: 'muted', style: { fontSize: '.85rem' } }, paramsProvenanceText(dev.twinInfo));
    const f = twinFetchOf(ctx);
    loadScenarioIndex(f).then((list) => {
      for (const s of list) sel.appendChild(h('option', { value: s.id, selected: s.id === twinScId }, `${s.title}${s.topic ? ` — ${s.topic}` : ''}`));
    }).catch((e) => { evs.textContent = `시나리오 목록을 읽지 못했습니다: ${e.message}`; });
    sel.addEventListener('change', async (e) => {
      twinScId = e.target.value;
      try {
        const sc = twinScId ? await loadScenario(f, twinScId) : null;
        dev.setTwinScenario(sc);
        evs.textContent = sc ? `${sc.description || ''} 사건: ${scenarioEvents(sc).join(' · ') || '없음'}` : '';
        if (sc && profEd && sc.setpoint_profile) { profEd.setValue(sc.setpoint_profile); publish(); }
      } catch (er) { evs.textContent = er.message; }
    });
    if (dev.twinOpts && dev.twinOpts.scenario) evs.textContent = `사건: ${scenarioEvents(dev.twinOpts.scenario).join(' · ') || '없음'}`;
    box.append(h('div', { class: 'row' }, h('label', null, '트윈 시나리오 ', sel), prov), evs,
      h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `디지털 트윈은 설계 모델과 일부러 다른 비선형 물리(마찰·데드밴드·백래시·센서 잡음·이상값)를 씁니다. ${SENSOR_ONLY_NOTE}`));
    return box;
  };

  const start = async () => {
    clear(msg);
    try {
      if (!dev.connected) {
        if (isSimMode(dev.mode)) await dev.connect();
        else throw new Error('먼저 장치를 연결하세요.');
      }
      if (dev.mode === 'device') { const v = editor.violations(); if (v.length) throw new Error('실기 제한: ' + v.join('; ')); }
      attempt += 1;
      const profile = profEd ? profEd.value() : practice.setpoint_profile;
      const controller = { id: ctrlId, params: editor.values() };
      const opts = runOptions(practice, { controller, profile, chapter_id: ctx.chapter && ctx.chapter.id, attempt: { no: attempt, changed: paramDiff(lastCtrl, controller), reason: '', judgement: '' }, mode: dev.mode });
      lastCtrl = controller;
      publish();
      await runner.start(opts);
    } catch (e) {
      msg.appendChild(errorBox(e.message));
    }
  };

  // 샘플 재생
  const renderSample = async (box) => {
    const refs = [...((ctx.chapter && ctx.chapter.sample_sessions) || []).map((s) => (typeof s === 'string' ? `sample:${s}` : s)), 'chapter'];
    box.appendChild(h('div', { class: 'muted' }, '샘플을 불러오는 중…'));
    let list = [];
    try { list = await resolveSources(ctx, refs, { chapterLimit: 10 }); } catch (e) { box.appendChild(errorBox(e.message)); return; }
    clear(box);
    const ok = list.filter((s) => s.rows && s.rows.length);
    for (const s of list.filter((x) => x.empty || x.error)) box.appendChild(infoBox(`${s.label || s.ref}: ${s.message || s.error}`));
    if (!ok.length) { box.appendChild(infoBox('재생할 샘플이 없습니다. 가상 장치로 실습한 뒤 다시 오세요.')); return; }
    let pick = 0, speed = 2;
    const sel = h('select', { onchange: (e) => { pick = +e.target.value; badges(); } }, ok.map((s, i) => h('option', { value: i }, `${s.label}${s.slot ? ` (슬롯 ${s.slot})` : ''}`)));
    const bspan = h('span');
    const badges = () => { clear(bspan).append(...sourceBadges(ok[pick])); publishSample(); };
    const publishSample = () => {
      const m = ok[pick].meta || {};
      shared.set({ controller: m.controller ? { id: m.controller.id, params: m.controller.params } : null, profile: m.setpoint_profile || null, plant: (practice && practice.model) || 'ball', replay: ok[pick].id }, tok);
    };
    box.append(
      h('div', { class: 'row' }, h('label', null, '샘플 ', sel), bspan),
      h('div', { class: 'row' },
        h('label', null, '배속 ', h('select', { onchange: (e) => { speed = +e.target.value; } }, [1, 2, 4, 8].map((v) => h('option', { value: v, selected: v === speed }, `${v}×`)))),
        h('button', { class: 'btn primary', onclick: () => { try { runner.replay({ meta: ok[pick].meta, rows: ok[pick].rows }, { speed }); } catch (e) { toast(e.message, 'error'); } } }, '재생'),
        h('button', { class: 'btn', onclick: () => runner.stopReplay() }, '멈춤')),
      h('div', { class: 'muted', style: { fontSize: '.85rem' } }, '샘플 재생은 읽기 전용입니다. 새 세션을 만들지 않습니다.'));
    badges();
  };

  const renderAll = () => {
    renderTabs(); renderConn();
    clear(body);
    if (dev.mode === 'sample') renderSample(body); else renderControl(body);
  };
  offs.push(dev.onStatus((st, info) => {
    // 다른 위젯(live-plot·설정 화면)에서 모드를 바꾸면 탭·본문을 다시 그린다
    if (info && info.modeChanged) { renderAll(); return; }
    renderConn(); if (editor) editor.setDevice(dev.mode === 'device');
  }));
  offs.push(runner.onState((s) => { if (s === 'running' || s === 'idle') { renderTabs(); if (dev.mode !== 'sample') { const keep = editor && editor.values(); clear(body); renderControl(body); if (keep) editor.setValues(keep); } } }));
  // 다른 위젯이 '실습 패널에 보내기'로 제어기를 보내면(이 챕터가 허용하는 제어기일 때) 그 값으로 다시 그린다
  offs.push(shared.subscribe((st, partial) => {
    const c = partial && partial.controller;
    if (!c || !ids.includes(c.id) || runner.state === 'running' || dev.mode === 'sample') return;
    ctrlId = c.id;
    clear(body); renderControl(body);
  }, tok));
  renderAll();
  return { unmount() { offs.forEach((f) => f()); } };
}
