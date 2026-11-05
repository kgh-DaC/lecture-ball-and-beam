// 위젯 공통 도우미(위젯 아님: 파일 이름이 _로 시작해 카탈로그와 겹치지 않는다).
// 계산은 하지 않는다. 모델·채널·출처 표시만 맞춘다.

import { h, subNodes, infoBox, badge, provenanceBadge, tierBadge, fmt } from '../dom.js';
import { simToRows } from '../sources.js';
import { practiceParamsFor } from '../practice.js';

/** props.plant('ball' | 'ball+servo') → 모델 객체. 제어 모듈이 없으면 null */
export function modelFor(ctx, plant = 'ball') {
  const c = ctx.control;
  if (!c || !c.currentModel) return null;
  try { return c.currentModel(plant === 'ball+servo' || plant === 'ball_servo' ? 'ball+servo' : 'ball'); } catch (e) { console.warn(e); return null; }
}

/** 필요한 ctx 모듈이 없으면 안내 상자를 그리고 false */
export function need(el, ctx, what) {
  const miss = [];
  for (const w of what) {
    if (w === 'analysis' && !ctx.analysis) miss.push('control/analysis.js');
    if (w === 'simulate' && !(ctx.control && ctx.control.simulate)) miss.push('control/simulate.js');
    if (w === 'plant' && !(ctx.control && ctx.control.makeModel)) miss.push('control/plant.js');
    if (w === 'registry' && !(ctx.control && ctx.control.registry)) miss.push('control/registry.js');
    if (w === 'identification' && !ctx.identification) miss.push('control/identification.js');
    if (w === 'autotune' && !(ctx.control && ctx.control.autotune)) miss.push('control/autotune.js');
  }
  if (miss.length) { el.appendChild(infoBox(`이 위젯에 필요한 모듈(${miss.join(', ')})이 아직 준비되지 않았습니다.`)); return false; }
  return true;
}

/**
 * bind 채널. props.bind가 없으면 지역 채널(이 위젯 혼자 쓰는 상태)을 돌려준다.
 * init: 채널에 아직 값이 없을 때 넣을 기본 상태(처음 마운트된 위젯이 정한다).
 * 반환 { get, set(partial), subscribe(fn) → off, token, bound }
 */
export function channel(ctx, props, init = {}) {
  const token = Symbol('w');
  if (props.bind && ctx.bus) {
    const ch = ctx.bus.channel(props.bind);
    const cur = ch.get();
    const missing = {};
    for (const [k, v] of Object.entries(init)) if (cur[k] === undefined && v !== undefined) missing[k] = v;
    if (Object.keys(missing).length) ch.set(missing, token);
    return {
      bound: true, token,
      get: () => ch.get(),
      set: (p) => ch.set(p, token),
      subscribe: (fn) => ch.subscribe(fn, token),
    };
  }
  let state = { ...init };
  const subs = new Set();
  return {
    bound: false, token,
    get: () => state,
    set: (p) => { state = { ...state, ...p }; },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

/** 위젯 머리줄 */
export function head(title, ...extra) {
  return h('div', { class: 'widget-head' }, h('span', { class: 'title' }, title), ...extra);
}

export function kv(label, value, unit = '') {
  return h('span', { class: 'kv' }, subNodes(label), ' ', h('b', null, typeof value === 'number' || value == null ? fmt(value) : String(value)), unit ? ` ${unit}` : '');
}

export function kpi(label, value, unit = '') {
  return h('div', { class: 'kpi' }, h('div', { class: 'v' }, typeof value === 'number' || value == null ? fmt(value) : String(value), unit ? h('small', null, ` ${unit}`) : null), h('div', { class: 'k' }, subNodes(label)));
}

/** 출처 배지 모음(시뮬레이션 데이터는 언제나 시뮬레이션 배지) */
export function sourceBadges(src) {
  const out = [];
  if (src.tier) out.push(tierBadge(src.tier));
  else out.push(provenanceBadge(src.provenance));
  if (src.tier && src.provenance === 'simulated' && !src.tier.endsWith('sim')) out.push(badge('시뮬레이션', 'b-sim'));
  if (src.conditionsUnknown) out.push(badge('조건 불명', 'b-unknown'));
  for (const b of src.badges || []) if (b !== '조건 불명' && b !== '시뮬레이션') out.push(badge(b, b === '가정값' ? 'b-assumed' : 'b-unknown'));
  if (src.kind === 'prediction') out.push(badge('모델 예측', 'b-sim'));
  return out;
}

/** 복소수 배열 → Plot 계열 x(re), y(im) */
export function cxSeries(list) { return { x: list.map((c) => c.re), y: list.map((c) => c.im) }; }

/** 컨트롤러 파라미터 사본(숫자만 스케일) */
export function scaleGains(params, k, keys = ['kp', 'ki', 'kd']) {
  const p = { ...params };
  for (const key of keys) if (typeof p[key] === 'number') p[key] *= k;
  return p;
}

/** 지표 사양 → 2차 근사 경계: ζ_min(P.O.), σ_min = 3/ts (±5% 정착, 04장 본문 정의) */
export function specBounds(spec) {
  if (!spec) return null;
  const po = (spec.po_pct ?? 5) / 100;
  const L = Math.log(Math.max(po, 1e-6));
  const zeta = po > 0 ? -L / Math.sqrt(Math.PI ** 2 + L * L) : 1;
  const sigma = 3 / (spec.ts_s ?? 3);
  return { zeta, sigma, phi: Math.acos(Math.min(1, zeta)) };
}

/** 극점이 사양 영역 안인가 */
export function inSpec(p, b) {
  if (!b) return null;
  if (p.re > -b.sigma + 1e-9) return false;
  return Math.abs(p.im) <= Math.abs(p.re) * Math.tan(b.phi) + 1e-9;
}

/** 사양 영역 주석(Plot ann): 허용 영역 음영 + 경계선 */
export function specAnnotations(b, X = 50) {
  if (!b) return [];
  const t = Math.tan(b.phi);
  return [
    { type: 'poly', pts: [[-b.sigma, -b.sigma * t], [-b.sigma, b.sigma * t], [-X, X * t], [-X, -X * t]], fill: 'rgba(0,158,115,0.10)' },
    { type: 'vline', x: -b.sigma, color: '#009E73', label: `σ = ${b.sigma.toFixed(2)}` },
  ];
}

export function debounceRaf(fn) {
  let pending = false;
  return (...a) => {
    if (pending) return;
    pending = true;
    const run = () => { pending = false; fn(...a); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 16);
  };
}

export { practiceParamsFor, isPerController } from '../practice.js';

/** 챕터 practice에서 기본 제어기 { id, params } */
export function practiceController(ctx, id) {
  const p = ctx.chapter && ctx.chapter.practice;
  if (!p) return null;
  const cid = id || p.controller;
  return { id: cid, params: practiceParamsFor(p, cid).safe };
}

/** 실습 패널 채널('__practice')에 제어기를 보낸다(controller-panel이 그 제어기를 고르면 이 값으로 시작) */
export function sendToPractice(ctx, controller) {
  if (!ctx.bus) return false;
  ctx.bus.channel('__practice').set({ controller });
  return true;
}

/** 표준 스텝 프로파일 P1 (data-schema §2.2) */
export const P1 = Object.freeze({ type: 'step', from_mm: 150, to_mm: 200, pre_s: 2, hold_s: 8 });

/**
 * 모델 시뮬레이션 + 세션 행 + 지표. 계산은 control.simulate / metrics.compute.
 * o: { controller, plant='ball+servo', profile=P1, model?, sim_opts? }
 * 반환 { sim, rows, summary, model } 또는 null(모듈 없음)
 */
export function simRun(ctx, o, toRows = simToRows) {
  const c = ctx.control;
  if (!c || !c.simulate) return null;
  const model = o.model || modelFor(ctx, o.plant || 'ball+servo');
  if (!model) return null;
  const profile = o.profile || P1;
  const sim = c.simulate(model, o.controller, profile, { noise: false, ...(o.sim_opts || {}) });
  const rows = toRows(sim);
  const meta = { setpoint_profile: profile, device: { lim_cdeg: Math.round(model.u_lim_rad * 18000 / Math.PI) } };
  const m = ctx.metrics && ctx.metrics.compute ? ctx.metrics.compute(rows, meta) : null;
  return { sim, rows, summary: (m && m.summary) || {}, model, meta };
}
