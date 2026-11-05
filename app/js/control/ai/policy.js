// policy.js — 정책 표현(신경망·Q 표), 번들/사용자 정책 저장소, 정책 지도 (ai-extension §2.4)
import { forward, fromJSON } from './mlp.js';
import { normObs, OBS_SPEC } from './obs.js';
import { BUNDLED } from './bundled.js';

/** nn-policy JSON 만들기. 출력 u = u_lim·tanh(net(normObs(o))) */
export function nnPolicyJSON(netJson, { u_lim_rad = 0.5236, meta = {} } = {}) {
  return { format: 'nn-policy', version: 1, net: netJson, obs: { ...OBS_SPEC }, u_lim_rad, out: 'tanh_scaled', meta: { provenance: 'simulated', ...meta } };
}

/** Q 표에서 칸 찾기 (경계 밖은 끝 칸) */
export function binOf(x, edges) {
  // edges: 오름차순 내부 경계 n−1 개 → 칸 n 개
  let i = 0;
  while (i < edges.length && x >= edges[i]) i++;
  return i;
}

/** Q 표 탐욕 행동 인덱스 */
export function qGreedy(q, obs) {
  const ie = binOf(obs[0], q.e_edges), iv = binOf(obs[1], q.v_edges);
  const nv = q.v_edges.length + 1, na = q.actions_rad.length;
  const base = (ie * nv + iv) * na;
  let best = 0, bv = -Infinity;
  for (let a = 0; a < na; a++) { const v = q.Q[base + a]; if (v > bv) { bv = v; best = a; } }
  return best;
}

/**
 * Q 표 칸 중심 (끝 칸은 이웃 칸 폭만큼 바깥으로 연장해 중심을 잡는다; qlearn.qTableView 와 같은 정의)
 * → { e_centers, v_centers }
 */
export function qCenters(q) {
  const centers = (edges) => {
    const n = edges.length;
    const lo = n > 1 ? edges[0] - (edges[1] - edges[0]) : edges[0] - 1;
    const hi = n > 1 ? edges[n - 1] + (edges[n - 1] - edges[n - 2]) : edges[0] + 1;
    const b = [lo, ...edges, hi];
    return b.slice(1).map((x, i) => 0.5 * (x + b[i]));
  };
  return { e_centers: centers(q.e_edges), v_centers: centers(q.v_edges) };
}

/** 정렬된 중심 배열에서 x 의 왼쪽 칸 i 와 보간 비율 w (중심 바깥은 끝 값 고정) */
function bracket(c, x) {
  if (!(x > c[0])) return { i: 0, w: 0 };
  if (x >= c[c.length - 1]) return { i: c.length - 2 < 0 ? 0 : c.length - 2, w: c.length > 1 ? 1 : 0 };
  let i = 0;
  while (i < c.length - 2 && x >= c[i + 1]) i++;
  return { i, w: (x - c[i]) / (c[i + 1] - c[i]) };
}

/**
 * 부드러운 Q 탐욕 행동: 이웃 4칸 중심의 Q 를 (e, v) 쌍선형 보간한 뒤 argmax (q-policy smooth 옵션).
 * 행동 후보는 여전히 actions_rad 중 하나다(출력은 계단 모양이지만 경계가 칸 경계에 묶이지 않는다).
 */
export function qGreedySmooth(q, obs, cen = qCenters(q)) {
  const nv = q.v_edges.length + 1, na = q.actions_rad.length;
  const be = bracket(cen.e_centers, obs[0]), bv = bracket(cen.v_centers, obs[1]);
  const ie1 = Math.min(be.i + 1, cen.e_centers.length - 1), iv1 = Math.min(bv.i + 1, nv - 1);
  const cells = [
    [be.i, bv.i, (1 - be.w) * (1 - bv.w)], [ie1, bv.i, be.w * (1 - bv.w)],
    [be.i, iv1, (1 - be.w) * bv.w], [ie1, iv1, be.w * bv.w],
  ];
  let best = 0, bvq = -Infinity;
  for (let a = 0; a < na; a++) {
    let s = 0;
    for (const [ie, iv, w] of cells) if (w > 0) s += w * q.Q[(ie * nv + iv) * na + a];
    if (s > bvq) { bvq = s; best = a; }
  }
  return best;
}

/** JSON → Policy { kind, act(obs) → u_rad, json }.  opts.smooth (q-table 만): 쌍선형 보간 탐욕 */
export function policyFromJSON(json, { smooth = false } = {}) {
  if (!json || typeof json !== 'object') throw new Error('policyFromJSON: 객체가 아님');
  if (json.format === 'nn-policy') {
    const net = fromJSON(json.net);
    const spec = json.obs || OBS_SPEC;
    const lim = json.u_lim_rad ?? 0.5236;
    if (net.sizes[0] !== spec.names.length || net.sizes[net.sizes.length - 1] !== 1) throw new Error('policyFromJSON: 입력/출력 크기가 관측 정의와 다름');
    return { kind: 'nn', json, net, act: (obs) => lim * Math.tanh(forward(net, normObs(obs, spec))[0]) };
  }
  if (json.format === 'q-table') {
    const nCells = (json.e_edges.length + 1) * (json.v_edges.length + 1) * json.actions_rad.length;
    if (!Array.isArray(json.Q) || json.Q.length !== nCells) throw new Error('policyFromJSON: Q 표 크기 불일치');
    if (smooth) {
      const cen = qCenters(json);
      return { kind: 'q', json, smooth: true, act: (obs) => json.actions_rad[qGreedySmooth(json, obs, cen)] };
    }
    return { kind: 'q', json, smooth: false, act: (obs) => json.actions_rad[qGreedy(json, obs)] };
  }
  throw new Error(`policyFromJSON: 알 수 없는 format ${json.format}`);
}

const USER = new Map();
/** 브라우저에서 학습한 정책을 제어기에 넘기는 통로. slot: 'user-nn' | 'user-q' */
export function registerPolicy(slot, json) {
  if (slot !== 'user-nn' && slot !== 'user-q') throw new Error('registerPolicy: slot 은 user-nn|user-q');
  if (json == null) { USER.delete(slot); return; }
  policyFromJSON(json); // 형식 검사
  USER.set(slot, json);
}
/** name: 'es' | 'bc' | 'dagger' | 'q' | 'user-nn' | 'user-q' → json | null */
export function getPolicyJSON(name) {
  if (name === 'user-nn' || name === 'user-q') return USER.get(name) ?? null;
  return BUNDLED[name] ?? null;
}

/** 번들 정책 이름 목록(학습 결과가 bundled.js 에 실제로 있는 것만) */
export function bundledPolicyNames() { return Object.keys(BUNDLED).filter((k) => BUNDLED[k] && typeof BUNDLED[k] === 'object'); }

const PCACHE = new WeakMap();
/** JSON → Policy (같은 JSON 객체면 다시 파싱하지 않는다). 제어기 생성자가 쓴다 */
export function policyFor(json, opts = {}) {
  const key = opts.smooth ? 'smooth' : 'plain';
  let m = PCACHE.get(json);
  if (!m) { m = {}; PCACHE.set(json, m); }
  if (!m[key]) m[key] = policyFromJSON(json, opts);
  return m[key];
}

/** (e, v) 평면 정책 지도 → { e, v, u[i_v][i_e] } */
export function policyMap(policy, { e_range_m = [-0.15, 0.15], v_range_m_s = [-0.4, 0.4], n_e = 41, n_v = 41, u_prev = 0 } = {}) {
  const lin = (a, b, n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
  const e = lin(e_range_m[0], e_range_m[1], n_e), v = lin(v_range_m_s[0], v_range_m_s[1], n_v);
  const u = v.map((vv) => e.map((ee) => policy.act([ee, vv, u_prev])));
  return { e, v, u };
}
