// AI 위젯 공통 도우미(위젯 아님). 계산은 control/ai/* 를 부르고, 여기서는 불러오기·출처 정리·표시 변환만 한다.
//  - loadAI(): control/ai 모듈 동적 로드(없는 모듈은 null — 병행 작업 중에도 다른 위젯이 깨지지 않게)
//  - loadBundle(ctx, name): data/ai/*.json 번들 결과(없으면 control/ai/bundled.js 사본)
//  - aiState(ctx): 같은 챕터 위젯끼리 학습 결과·진행을 나누는 채널('__ai')
//  - policyCandidates / netCandidates: props.source → 보여 줄 후보(내 학습 / 번들)

import { PATHS } from '../../config/defaults.js';

const MODS = ['mlp', 'nn-id', 'qlearn', 'es', 'imitation', 'policy', 'train_env', 'obs', 'evaluate', 'bundled'];
let aiPromise = null;

/** → { mlp, nnId, qlearn, es, imitation, policy, trainEnv, obs, evaluate, bundled } (없는 모듈은 null) */
export function loadAI() {
  if (!aiPromise) {
    aiPromise = Promise.allSettled(MODS.map((m) => import(`../../control/ai/${m}.js`))).then((res) => {
      const out = {};
      MODS.forEach((m, i) => {
        const key = m.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
        out[key] = res[i].status === 'fulfilled' ? res[i].value : null;
        if (res[i].status !== 'fulfilled' && m !== 'evaluate') console.warn(`control/ai/${m}.js 를 불러오지 못했습니다:`, res[i].reason?.message);
      });
      return out;
    });
  }
  return aiPromise;
}

export const BUNDLE_FILES = Object.freeze({
  'nn-id': 'nn-id.json', 'nn-id-overfit': 'nn-id-overfit.json', q: 'q-table.json', es: 'es-policy.json', bc: 'bc-policy.json', dagger: 'dagger-policy.json', index: 'index.json',
});
const cache = new Map();

/** 번들 결과 JSON 또는 null. ctx.aiFetch(시험용)가 있으면 그것으로 읽는다 */
export async function loadBundle(ctx, name) {
  if (cache.has(name)) return cache.get(name);
  const file = BUNDLE_FILES[name];
  let json = null;
  const f = (ctx && ctx.aiFetch) || (typeof fetch === 'function' ? fetch : null);
  if (file && f) {
    try {
      const r = await f(`${PATHS.ai}${file}`);
      if (r && r.ok) json = await r.json();
    } catch { /* 파일 없음·오프라인: 아래 사본으로 */ }
  }
  if (!json) {
    const ai = await loadAI();
    const B = ai.bundled && ai.bundled.BUNDLED;
    if (B && B[name]) json = B[name];
  }
  if (json) cache.set(name, json);
  return json;
}

/** 같은 챕터의 AI 위젯 공유 상태. 키: nn_id, q, nn, bc, dagger(내가 학습한 결과), last_policy, last_policy_kind */
// Bus는 set(partial, src)의 src와 같은 src로 구독한 함수를 부르지 않는다(자기 변경 무시). 여기서는 구독마다 고유 토큰을 줘서
// 모든 위젯 변경이 다른 위젯에 전달되게 한다.
function wrapBus(ch) {
  return { get: () => ch.get(), set: (p) => ch.set(p), subscribe: (fn) => ch.subscribe((st, p) => fn(st, p), Symbol('ai-sub')) };
}

export function aiState(ctx) {
  if (ctx.bus) return wrapBus(ctx.bus.channel('__ai'));
  if (!ctx.__ai) {
    let st = {};
    const subs = new Set();
    ctx.__ai = { get: () => st, set: (p) => { st = { ...st, ...p }; for (const f of subs) f(st, p); }, subscribe: (f) => { subs.add(f); return () => subs.delete(f); } };
  }
  return ctx.__ai;
}

/** 학습 진행 채널('__ai_progress'): { kind, history, last, running, label } — reward-curve(live)가 구독 */
export function aiProgress(ctx) {
  if (ctx.bus) return wrapBus(ctx.bus.channel('__ai_progress'));
  if (!ctx.__aiP) {
    let st = {};
    const subs = new Set();
    ctx.__aiP = { get: () => st, set: (p) => { st = { ...st, ...p }; for (const f of subs) f(st, p); }, subscribe: (f) => { subs.add(f); return () => subs.delete(f); } };
  }
  return ctx.__aiP;
}

export const SOURCE_LABEL = { es: '진화 전략(ES)', bc: '행동복제(BC)', dagger: 'DAgger', q: 'Q-러닝 표', 'nn-id': '식별 신경망', user: '내가 학습한 정책' };

/**
 * 정책 후보 목록. 첫 원소가 기본 표시.
 * source: 'user' | 'es' | 'bc' | 'dagger' | 'q' | 'bundled'
 * → [{ key, label, json, origin: 'user'|'bundled' }]
 */
export async function policyCandidates(ctx, source) {
  const ai = await loadAI();
  const st = aiState(ctx).get();
  const out = [];
  const add = (key, label, json, origin) => { if (json && !out.some((c) => c.json === json)) out.push({ key, label, json, origin }); };
  const reg = (slot) => (ai.policy && ai.policy.getPolicyJSON ? ai.policy.getPolicyJSON(slot) : null);
  if (source === 'user') {
    add('user', `내가 학습: ${SOURCE_LABEL[st.last_policy_kind] || '정책'}`, st.last_policy, 'user');
    add('user-q', '내가 학습: Q 표', st.q || reg('user-q'), 'user');
    add('user-nn', '내가 학습: 신경망 정책', st.nn || reg('user-nn'), 'user');
    const pr = ctx.chapter && ctx.chapter.practice;
    const fb = pr && pr.controller === 'q-policy' ? 'q' : 'es';
    add(fb, `번들: ${SOURCE_LABEL[fb]}`, await loadBundle(ctx, fb), 'bundled');
    return out;
  }
  const key = source === 'bundled' ? 'q' : source;
  if (key === 'q') add('user-q', '내가 학습: Q 표', st.q || reg('user-q'), 'user');
  else if (key === 'es') add('user-nn', '내가 학습: ES 정책', st.nn, 'user');
  else if (key === 'bc' || key === 'dagger') add(`user-${key}`, `내가 학습: ${SOURCE_LABEL[key]}`, st[key], 'user');
  add(key, `번들: ${SOURCE_LABEL[key] || key}`, await loadBundle(ctx, key), 'bundled');
  return out;
}

/** 번들 json 의 학습 곡선(curve)을 Progress 배열 형태로. 배열/열 객체 둘 다 받는다 */
export function normCurve(curve) {
  if (!curve) return [];
  if (Array.isArray(curve)) return curve.map((c, i) => (typeof c === 'number' ? { iter: i + 1, return: c } : { iter: c.iter ?? c.episode ?? i + 1, ...c }));
  if (typeof curve === 'object') {
    const keys = Object.keys(curve).filter((k) => Array.isArray(curve[k]));
    const n = Math.max(0, ...keys.map((k) => curve[k].length));
    const it = curve.iter || curve.episode || null;
    return Array.from({ length: n }, (_, i) => {
      const o = { iter: it ? it[i] : i + 1 };
      for (const k of keys) if (k !== 'iter' && k !== 'episode') o[k] = curve[k][i];
      return o;
    });
  }
  return [];
}

/** 이동 평균(창 n, 앞쪽은 가능한 만큼) */
export function movingAvg(y, n) {
  const out = new Array(y.length);
  let s = 0, c = 0;
  const q = [];
  for (let i = 0; i < y.length; i++) {
    const v = y[i];
    q.push(v); if (Number.isFinite(v)) { s += v; c++; }
    if (q.length > n) { const o = q.shift(); if (Number.isFinite(o)) { s -= o; c--; } }
    out[i] = c ? s / c : NaN;
  }
  return out;
}

/** "32,32" → [32, 32] */
export function parseList(v, fallback = []) {
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  if (v == null || v === '') return fallback.slice();
  const a = String(v).split(/[ ,]+/).filter(Boolean).map(Number);
  return a.every(Number.isFinite) ? a : fallback.slice();
}

export const DEG = 180 / Math.PI;

/** JSON 내려받기·불러오기 공통 메타 */
export function describePolicy(json) {
  if (!json) return '';
  const m = json.meta || {};
  if (json.format === 'q-table') return `Q 표 ${json.e_edges.length + 1}×${json.v_edges.length + 1} 칸, 행동 ${json.actions_rad.length}개${m.episodes ? `, ${m.episodes} 에피소드` : ''}`;
  if (json.format === 'nn-policy') return `신경망 ${(json.net && json.net.sizes || []).join('-')}${m.algo ? `, ${m.algo}` : ''}${m.iters ? `, ${m.iters} 반복` : ''}${m.rounds ? `, ${m.rounds} 라운드` : ''}`;
  if (json.format === 'nn-id') return `식별 신경망 ${(json.net && json.net.sizes || []).join('-')}`;
  return json.format || '';
}
