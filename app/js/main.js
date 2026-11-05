// 앱 진입점: 공용 서비스(장치, 러너, 저장소, 샘플, 진도, 제어 모듈)를 만들고 교재 셸을 띄운다.

import { disconnectHint } from './serial/troubleshoot.js';
import { Shell } from './book/shell.js';
import { Settings } from './config/settings.js';
import { SERVO_PRESETS } from './config/servo-presets.js';
import { resolveCalibration } from './config/hw-records.js';
import { PATHS } from './config/defaults.js';
import { DeviceManager } from './serial/device.js';
import { Runner } from './loop/runner.js';
import { SessionStore } from './store/session.js';
import { SampleStore } from './store/samples.js';
import { Progress } from './store/progress.js';
import { openDB } from './store/idb.js';
import * as metrics from './store/metrics.js';
import * as best from './store/best.js';
import { h, toast, download, pickFile, badge, clear } from './ui/dom.js';
import { MODE_LABEL } from './serial/device.js';
import { loadTwinParams, TWIN_BADGE } from './ui/twin/lib.js';

class Events {
  constructor() { this.m = new Map(); }
  on(t, f) { if (!this.m.has(t)) this.m.set(t, new Set()); this.m.get(t).add(f); return () => this.m.get(t).delete(f); }
  emit(t, ev) { for (const f of this.m.get(t) || []) { try { f(ev); } catch (e) { console.error(e); } } }
}

/** 제어 모듈(control-engineer 소유)을 불러온다. 없는 모듈은 null로 두고 위젯이 '준비 중'을 표시한다 */
async function loadControl() {
  const names = ['registry', 'plant', 'simulate', 'analysis', 'identification', 'autotune'];
  const res = await Promise.allSettled(names.map((n) => import(`./control/${n}.js`)));
  const mods = {};
  names.forEach((n, i) => {
    if (res[i].status === 'fulfilled') mods[n] = res[i].value;
    else { mods[n] = null; console.warn(`control/${n}.js 를 불러오지 못했습니다:`, res[i].reason?.message); }
  });
  return mods;
}

async function loadKatex() {
  try { return (await import('../vendor/katex/katex.mjs')).default; } catch (e) { console.warn('KaTeX 로드 실패', e); return null; }
}

async function main() {
  const [katex, C] = await Promise.all([loadKatex(), loadControl()]);
  const events = new Events();
  const settings = new Settings();
  if (settings.ui.bigText) document.body.classList.add('big');
  const sessions = new SessionStore();
  const samples = new SampleStore({ sessions, base: PATHS.samples });
  const progress = new Progress();
  const db = await openDB();
  if (db.memory) toast('브라우저 저장소(IndexedDB)를 쓸 수 없어 이번 창을 닫으면 데이터가 사라집니다. 세션을 ZIP으로 내보내세요.', 'warn', 10000);

  // 식별 결과: IndexedDB 최신 > 번들 data/identification/result.json > 가정값
  let idResult = null;
  const refreshIdResult = async () => {
    const list = (await db.getAll('id_results')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    idResult = list[0] || null;
    if (!idResult) {
      try { const r = await fetch(PATHS.identification + 'result.json'); if (r.ok) idResult = { ...(await r.json()), bundled: true }; } catch { /* 없음 */ }
    }
  };
  await refreshIdResult();

  const control = {
    registry: C.registry,
    getController: (id) => (C.registry ? C.registry.getController(id) : null),
    plant: C.plant,
    simulate: C.simulate ? C.simulate.simulate : null,
    stepPlant: C.simulate ? C.simulate.stepPlant : null,
    autotune: C.autotune,
    makeModel: C.plant ? C.plant.makeModel : null,
    idResult: () => idResult,
    refreshIdResult,
    /** kind: 'ball' | 'ball+servo'. 현재 장치 설정(fs, alpha, lim)과 식별 결과를 반영 */
    currentModel(kind = 'ball') {
      if (!C.plant) return null;
      const d = settings.device;
      const sensor = { ...(C.plant.DEFAULT_SENSOR || {}), Ts_s: d.fs / 1000, alpha: d.alpha / 1000 };
      const u_lim_rad = (d.lim / 100) * Math.PI / 180;
      if (kind === 'ball+servo' || kind === 'ball_servo') {
        const servo = idResult && idResult.servo ? idResult.servo : C.plant.ASSUMED_SERVO;
        return C.plant.makeModel({ servo_tf: servo, sensor, u_lim_rad });
      }
      return C.plant.makeModel({ sensor, u_lim_rad });
    },
    available: !!(C.registry && C.plant && C.simulate),
  };

  // 포텐쇼미터 변환 결정(hw-records.resolveCalibration, data-schema §4.4): 트윈 모드 = 트윈 자체 식, 고른 보정 기록 > 07장 마법사 > 프리셋(사용자 실측)
  const getCalibration = async () => {
    const model = settings.device.servo_model;
    const pre = C.identification && C.identification.presetCalibration ? C.identification.presetCalibration(model) : (SERVO_PRESETS[model].pot_preset || null);
    const twinCal = device && device.mode === 'twin' ? (await import('./sim/twin/sensor.js')).PRESET_POT_CAL : null;
    // θ_cmd = dir·(혼 각도 − trim): 장치가 보고한 trim·dir(연결 중) → 저장된 설정 (data-schema §4.2)
    const cfg = device && device.connected && device.config ? device.config : {};
    const trim_cdeg = cfg.trim ?? settings.device.trim, dir = cfg.dir ?? settings.device.dir;
    return resolveCalibration({ mode: device ? device.mode : null, twinCal, records: settings.hw, servo_model: model, dbList: await db.getAll('calibrations'), preset: pre, trim_cdeg, dir });
  };

  const device = new DeviceManager({
    settings,
    loadSim: async () => {
      if (!C.simulate || !C.plant) throw new Error('가상 장치에 필요한 control/simulate.js·plant.js가 아직 없습니다');
      return { sim: C.simulate, model: control.currentModel('ball+servo') };
    },
    // 디지털 트윈 파라미터: data/twin/params.json (식별 결과가 실측이면 서보 K·τ·Td 반영)
    loadTwin: () => loadTwinParams((u) => fetch(u), idResult),
  });
  const runner = new Runner({
    device, store: sessions, control: async () => control, getCalibration,
    onEvent: (ev) => {
      if (ev.type === 'warn') toast(ev.message, 'warn', 7000);
      if (ev.type === 'error') toast(ev.message, 'error', 10000);
      if (ev.type === 'finished') { toast(`세션 저장됨: ${ev.meta?.title || ev.session_id}${ev.complete ? '' : ' (중단됨)'}`, ev.complete ? 'ok' : 'warn'); events.emit('finished', ev); }
    },
  });
  device.onStatus((s, info) => {
    if (s === 'connected') runner.refreshCalibration();
    if (s === 'disconnected' && info && info.unexpected) toast(`장치 연결이 끊겼습니다. ${disconnectHint()}`, 'error', 10000);
  });
  if (device.onNotice) device.onNotice((n) => { if (n.kind === 'reset') toast(n.message, 'warn', 12000); });
  settings.onChange(() => runner.refreshCalibration());
  settings.hw.onChange(() => runner.refreshCalibration());

  const ctx = {
    analysis: C.analysis,
    control,
    identification: C.identification,
    device,
    runner,
    store: { sessions, onChange: (f) => sessions.onChange(f) },
    metrics: { compute: metrics.compute, stepInfo: metrics.stepInfo, METRIC_INFO: metrics.METRIC_INFO, REASON_LABEL: metrics.REASON_LABEL },
    samples,
    best: { score: best.score, DEFAULT_WEIGHTS: best.DEFAULT_WEIGHTS },
    progress,
    settings,
    events,
    katex,
    db,
    getCalibration,
    ui: {
      toast,
      async openPromote(sessionId, opts = {}) {
        const mod = await import('./ui/widgets/promote-sample.js');
        return mod.openDialog(sessionId, opts, ctx);
      },
    },
  };
  window.__ballbeam = ctx; // 디버깅용(콘솔)

  // 상단 상태 표시줄
  const statusEl = document.getElementById('status');
  const renderStatus = () => {
    clear(statusEl);
    const modeLabel = MODE_LABEL[device.mode] || device.mode;
    const st = { disconnected: '연결 안 됨', connecting: '연결 중…', connected: '연결됨', error: '오류' }[device.status];
    statusEl.append(...[
      h('span', { class: `dot ${device.status}` }), ` ${modeLabel} · ${st} `,
      device.mode === 'device' ? badge('실측', 'b-real') : device.mode === 'twin' ? badge(TWIN_BADGE, 'b-sim b-twin') : badge('시뮬레이션', 'b-sim'),
      device.hello ? h('span', { class: 'muted' }, ` fw ${device.hello.fw_ver}`) : null,
      device.protoMismatch ? badge('프로토콜 불일치', 'b-bad') : null,
      device.parser.counts.bad ? h('span', { class: 'muted', title: device.parser.lastBad || '' }, ` 파싱 실패 ${device.parser.counts.bad}줄`) : null,
      runner.state === 'running' ? badge('실험 중', 'b-run') : null,
    ].filter(Boolean));
  };
  device.onStatus(renderStatus);
  runner.onState(renderStatus);
  setInterval(renderStatus, 2000);
  renderStatus();
  document.getElementById('estop').addEventListener('click', () => { runner.estop(); toast('비상 정지: M,0 전송', 'warn'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && runner.state === 'running') runner.estop(); });
  document.getElementById('toc-toggle').addEventListener('click', () => document.body.classList.toggle('toc-open'));
  document.getElementById('bigtext').addEventListener('click', () => { const on = !document.body.classList.contains('big'); document.body.classList.toggle('big', on); settings.saveUi({ bigText: on }); });
  // 화면 밝기: auto(시스템) → light → dark 순환, settings.ui.theme에 저장
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let theme = (settings.ui && settings.ui.theme) || 'auto';
  const applyTheme = () => {
    const dark = theme === 'dark' || (theme === 'auto' && mq && mq.matches);
    document.body.classList.toggle('theme-dark', !!dark);
    document.body.classList.toggle('theme-light', !dark);
    const b = document.getElementById('theme');
    if (b) b.title = `화면 밝기: ${{ auto: '자동(시스템)', light: '밝게', dark: '어둡게' }[theme]} — 눌러서 바꾸기`;
  };
  if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);
  applyTheme();
  const themeBtn = document.getElementById('theme');
  if (themeBtn) themeBtn.addEventListener('click', () => { theme = { auto: 'light', light: 'dark', dark: 'auto' }[theme]; settings.saveUi({ theme }); applyTheme(); });
  window.addEventListener('beforeunload', (e) => { if (runner.state === 'running') { e.preventDefault(); e.returnValue = ''; } });

  if (!device.supported) {
    const b = document.getElementById('banner');
    b.hidden = false;
    b.textContent = `Web Serial 사용 불가: ${device.unsupportedReason} 가상 장치·디지털 트윈·샘플 재생 모드는 그대로 쓸 수 있습니다.`;
  }
  if (!katex) toast('수식 렌더러(KaTeX)를 불러오지 못해 수식이 원문으로 보입니다.', 'warn');

  const services = {
    ctx, progress, events,
    exportProgress: async () => {
      const d = new Date();
      download(`progress-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`, await progress.exportJSON(), 'application/json');
    },
    importProgress: async () => {
      const [f] = await pickFile('.json');
      if (!f) return;
      try { const n = await progress.importJSON(await f.text()); toast(`진도 ${n}개 챕터를 병합했습니다`, 'ok'); } catch (e) { toast(`진도 불러오기 실패: ${e.message}`, 'error'); }
    },
  };
  const shell = new Shell({ tocEl: document.getElementById('toc'), mainEl: document.getElementById('content'), searchEl: document.getElementById('search'), services, katex });
  await shell.init();
}

main().catch((e) => {
  console.error(e);
  const c = document.getElementById('content');
  if (c) c.textContent = `앱 시작 오류: ${e.message}`;
});
