// 디지털 트윈 화면 공용 도우미(web-app-engineer). 트윈 물리·시나리오·몬테카를로 계산은 app/js/sim/twin/*
// (digital-twin-engineer 소유)를 읽기·호출만 한다. 여기서는 파일 읽기(params.json·시나리오), 제어기 프리셋,
// 출처 배지 문구만 맞춘다.

import { PATHS } from '../../config/defaults.js';

/** 상태 표시줄·실습 패널·세션 목록에 쓰는 배지 문구 */
export const TWIN_LABEL = '디지털 트윈';
export const TWIN_BADGE = '디지털 트윈 [시뮬레이션]';

/** 제어기에 들어가는 신호 설명(twin-lab·실습 패널 공통) */
export const SENSOR_ONLY_NOTE = '제어기에는 센서 출력(초음파 거리 D 줄의 필터값·원측정, 포텐쇼미터 각)만 들어갑니다. 참 위치·속도·빔 각(트윈 내부 상태)은 화면 그림과 채점에만 쓰고 제어기에는 주지 않습니다 — 실제 장치와 같은 조건입니다.';

/**
 * 비교용 제어기 프리셋. 게인은 번들 샘플(data/samples/index.json)·tests/twin/report_robustness.mjs 와 같다
 * (docs/theory/digital-twin.md §6 표와 같은 조건으로 다시 돌려 볼 수 있게).
 */
export const CONTROLLER_PRESETS = Object.freeze([
  { key: 'pd-p1', label: 'PD p1', id: 'pid', params: { kp: 1, ki: 0, kd: 1.5, n_filt: 8, d_on: 'measurement' } },
  { key: 'pd-servo', label: 'PD 서보 재설계', id: 'pid', params: { kp: 0.5, ki: 0, kd: 1.25, n_filt: 8, d_on: 'measurement' } },
  { key: 'pd-s47', label: 'PD 슬라이드47', id: 'pid', params: { kp: 0.574, ki: 0, kd: 0.994, n_filt: 10, d_on: 'error' } },
  { key: 'pd-s48', label: 'PD 슬라이드48', id: 'pid', params: { kp: 2.3884, ki: 0, kd: 2.0684, n_filt: 10, d_on: 'error' } },
  // PID TL·SMC sat: 값 복사(출처 tests/twin/controllers.mjs — 앱은 tests 를 import 하지 않는다). R=26 mm 실측 → 설계 K_b 0.8709 → 0.89931 갱신(2026-11-05):
  //   PID TL v1 (1.46, 0.1637, 2.439) → (1.435, 0.1627, 2.413), SMC kb_nominal v1 0.8709 → 0.8993. 번들 샘플·data/twin/results/design-vs-twin-v3.json 과 같다.
  { key: 'pid-tl', label: 'PID TL', id: 'pid', params: { kp: 1.435, ki: 0.1627, kd: 2.413, n_filt: 8, d_on: 'measurement' } },
  { key: 'lqr', label: 'LQR', id: 'lqr', params: { q_e: 400, q_edot: 25, q_theta: 33, r: 3.65, integral: false, q_i: 50, observer: 'luenberger', obs_speed: 3, theta_meas: true } },
  { key: 'lqi', label: 'LQI', id: 'lqr', params: { q_e: 400, q_edot: 25, q_theta: 33, r: 3.65, integral: true, q_i: 50, observer: 'luenberger', obs_speed: 3, theta_meas: true } },
  { key: 'smc-sat', label: 'SMC sat', id: 'smc', params: { lambda: 1, eta: 0.1, phi: 0.05, switch: 'sat', kb_nominal: 0.8993, observer: 'luenberger' } },
]);

/** 실기 전용 파라미터(트윈 비교에서는 빼서 설계 그대로 비교) */
const DEVICE_ONLY = ['angle_limit', 'rate_limit'];

/**
 * 제어기 지정 해석. spec: "pd-p1,lqr" 문자열 | 배열(프리셋 키 / 제어기 id / { id, params, label })
 * 프리셋 키 → 프리셋, 제어기 id → 챕터 practice.safe_defaults(있으면) 위에 meta 기본값.
 * 반환 [{ key, id, label, params }] (registry 에 없는 id 는 missing 에 모음)
 */
export function resolveControllers(spec, { getController, practiceSafe } = {}) {
  const list = Array.isArray(spec) ? spec : String(spec || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [], missing = [];
  const seen = new Map();
  for (const item of list) {
    let c = null;
    if (item && typeof item === 'object') c = { key: item.key || item.id, id: item.id, label: item.label || null, params: { ...(item.params || {}) } };
    else {
      const p = CONTROLLER_PRESETS.find((x) => x.key === item);
      c = p ? { key: p.key, id: p.id, label: p.label, params: { ...p.params } } : { key: item, id: item, label: null, params: practiceSafe ? { ...(practiceSafe(item) || {}) } : {} };
    }
    let C = null;
    try { C = getController ? getController(c.id) : null; } catch { C = null; }
    if (!C) { missing.push(c.key); continue; }
    const def = {};
    for (const sp of C.meta.params || []) if (sp.default !== undefined) def[sp.key] = sp.default;
    c.params = { ...def, ...c.params };
    for (const k of DEVICE_ONLY) delete c.params[k];
    c.label = c.label || C.meta.label || c.id;
    // 같은 이름이 두 번 나오면 구분
    const n = (seen.get(c.label) || 0) + 1; seen.set(c.label, n);
    if (n > 1) c.label = `${c.label} (${n})`;
    out.push(c);
  }
  return { list: out, missing };
}

// ------------------------------------------------------------------ 파일 읽기(브라우저 안에서만, 외부 전송 없음)
const cache = new WeakMap();
function cacheFor(fetchFn) {
  if (!cache.has(fetchFn)) cache.set(fetchFn, new Map());
  return cache.get(fetchFn);
}
async function getJson(fetchFn, url) {
  const c = cacheFor(fetchFn);
  if (!c.has(url)) {
    c.set(url, (async () => {
      const r = await fetchFn(url);
      if (!r || !r.ok) throw new Error(`${url} 를 읽지 못했습니다 (${r ? r.status : '응답 없음'})`);
      return r.json();
    })());
  }
  try { return await c.get(url); } catch (e) { c.delete(url); throw e; }
}

/** 전역 fetch(브라우저) 또는 시험이 넣은 함수 */
export function twinFetchOf(ctx) {
  if (ctx && typeof ctx.twinFetch === 'function') return ctx.twinFetch;
  if (typeof fetch === 'function') return (u) => fetch(u);
  return async () => ({ ok: false, status: 0 });
}

/**
 * data/twin/params.json → paramsFromJson. identification(식별 결과)이 실측이면 서보 값이 measured 로 바뀐다.
 * 반환 { params, provenance, basis, ref, measuredCount }
 */
export async function loadTwinParams(fetchFn, identification = null) {
  const [{ paramsFromJson }, json] = await Promise.all([import('../../sim/twin/twin.js'), getJson(fetchFn, PATHS.twin + 'params.json')]);
  const r = paramsFromJson(json, identification ? { identification } : {});
  return { ...r, measuredCount: Object.values(r.provenance).filter((p) => p === 'measured').length };
}

/** 시나리오 목록 [{ id, file, title, topic }] */
export async function loadScenarioIndex(fetchFn) {
  const idx = await getJson(fetchFn, PATHS.twin + 'scenarios/index.json');
  return Array.isArray(idx.scenarios) ? idx.scenarios : [];
}

/** 시나리오 하나(normalizeScenario 를 거친 객체) */
export async function loadScenario(fetchFn, id) {
  const list = await loadScenarioIndex(fetchFn);
  const ent = list.find((s) => s.id === id);
  if (!ent) throw new Error(`시나리오 ${id} 가 목록(data/twin/scenarios/index.json)에 없습니다`);
  const [{ normalizeScenario }, sc] = await Promise.all([import('../../sim/twin/scenario.js'), getJson(fetchFn, PATHS.twin + 'scenarios/' + (ent.file || `${id}.json`))]);
  return normalizeScenario(sc);
}

/** 파라미터 출처 요약 배지 문구: measured 가 하나라도 있으면 [실측 n개], 나머지 [가정] */
export function paramsProvenanceText(tp) {
  if (!tp) return '';
  return tp.measuredCount ? `파라미터: [실측] ${tp.measuredCount}개 + 나머지 [가정]` : '파라미터: [가정] (실측 식별 결과 없음)';
}

/** 시나리오 사건을 사람이 읽는 문장으로(값이 없는 필드는 생략 — TwinDevice onEvent 는 종류만 줄 때가 있다) */
export function describeEvent(e) {
  const t = e.t != null ? `${e.t} s ` : '';
  const has = (v) => v != null && v !== '';
  const sgn = (v) => (v > 0 ? `+${v}` : `${v}`);
  switch (e.type) {
    case 'ball_push': return `${t}공 밀기${has(e.dv_mm_s) ? ` ${sgn(e.dv_mm_s)} mm/s` : ''}`;
    case 'ball_place': return `${t}공 옮김${has(e.y_mm) ? ` ${e.y_mm} mm` : ''}`;
    case 'beam_knock': return `${t}빔 충격${has(e.dtheta_deg) ? ` ${sgn(e.dtheta_deg)}°` : ''}`;
    case 'force': return `${t}외력${has(e.a_mm_s2) ? ` ${e.a_mm_s2} mm/s²` : ''}${has(e.duration_s) ? ` ${e.duration_s} s` : ''}`;
    case 'param_step': return `${t}파라미터 변화${has(e.key) ? ` ${e.key} × ${e.scale}` : ''}`;
    case 'outlier_burst': return `${t}센서 이상값${has(e.n) ? ` ${e.n}연속` : ' 연속'}`;
    case 'outlier_rate': return `${t}이상값 비율${has(e.prob) ? ` ${Math.round(e.prob * 100)}%` : ''}${has(e.duration_s) ? ` (${e.duration_s} s)` : ''}`;
    case 'dropout': return `${t}센서 유실${has(e.duration_s) ? ` ${e.duration_s} s` : ''}`;
    case 'stuck': return `${t}센서 멈춤${has(e.duration_s) ? ` ${e.duration_s} s` : ''}`;
    case 'bias': return `${t}센서 치우침${has(e.offset_mm) ? ` ${e.offset_mm} mm` : ''}${has(e.duration_s) ? ` (${e.duration_s} s)` : ''}`;
    case 'estop': return `${t}비상 정지`;
    case 'scenario_start': return `${t}시나리오 시작${has(e.scenario) ? ` (${e.scenario})` : ''}`;
    case 'diverged': return `${t}발산${has(e.reason) ? ` (${e.reason})` : ''}`;
    default: return `${t}${e.type}`;
  }
}

/** 시나리오의 모든 사건(외란·고장·안전) 문장 목록 */
export function scenarioEvents(sc) {
  if (!sc) return [];
  return [...(sc.disturbance || []), ...(sc.sensor_fault || []), ...(sc.safety_events || [])].sort((a, b) => a.t - b.t).map(describeEvent);
}

/** 세션 메타 → 시뮬레이션 출처 배지 문구('디지털 트윈' | '가상 장치' | null). device.mode 'twin' 이 우선 */
export function simSourceLabel(meta) {
  if (!meta) return null;
  if (meta.device && meta.device.mode === 'twin') return TWIN_LABEL;
  return meta.source === 'virtual' ? '가상 장치' : null;
}
