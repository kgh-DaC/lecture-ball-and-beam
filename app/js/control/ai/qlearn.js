// qlearn.js — 표 기반 Q-러닝 (ai-extension §2.6, 17장)
//
// 상태 s = (e 칸, v 칸)  — 관측 [e, v, u_prev] 중 앞의 둘을 이산화(0 근처를 촘촘하게)
// 행동 a = 서보 각도 후보 actions_rad 중 하나(절대각)
// 갱신  Q(s,a) ← Q(s,a) + α [ r + γ·max_a' Q(s',a')·(1 − 종료) − Q(s,a) ]
//   종료 = terminate_on_end 일 때 빔 끝 충돌. 시간 제한으로 끝난 경우는 부트스트랩한다(잘림이지 종료가 아님).
// 탐험 ε-greedy, ε 는 eps_start → eps_end 선형 감소(eps_decay_episodes 동안).
// u_prev 를 상태에 넣지 않으므로 서보 지연 정보는 표에 없다(부분 관측) — 교재 토론 거리.
import { rng } from '../linalg.js';
import { BallBeamEnv, trajRmse } from './train_env.js';
import { binOf, qGreedy } from './policy.js';

export const DEFAULT_Q = Object.freeze({
  e_edges: [-0.10, -0.06, -0.035, -0.02, -0.01, -0.004, 0.004, 0.01, 0.02, 0.035, 0.06, 0.10],
  v_edges: [-0.25, -0.12, -0.06, -0.025, -0.008, 0.008, 0.025, 0.06, 0.12, 0.25],
  actions_rad: [-0.15, -0.08, -0.03, 0, 0.03, 0.08, 0.15],
  alpha: 0.05, gamma: 0.98, eps_start: 1.0, eps_end: 0.05, eps_decay_frac: 0.7, episodes: 10000, q_init: 0,
  eval_every: 500, eval_episodes: 10, keep_best: true,
});

export function discretize(obs, q) {
  const i_e = binOf(obs[0], q.e_edges), i_v = binOf(obs[1], q.v_edges);
  return { i_e, i_v, index: i_e * (q.v_edges.length + 1) + i_v };
}

/** 빈 Q 표 JSON */
export function emptyQTable(qo = {}) {
  const q = { ...DEFAULT_Q, ...qo };
  const nS = (q.e_edges.length + 1) * (q.v_edges.length + 1);
  return { format: 'q-table', version: 1, e_edges: q.e_edges.slice(), v_edges: q.v_edges.slice(), actions_rad: q.actions_rad.slice(),
    Q: new Array(nS * q.actions_rad.length).fill(q.q_init), visits: new Array(nS * q.actions_rad.length).fill(0), meta: { provenance: 'simulated' } };
}

/**
 * Q-러닝 job. budget = 에피소드 수(기본 20)
 * Progress { kind:'qlearn', iter, total, return, length, epsilon, mean_return_50, success_rate_50, visited_frac, end_hit, rmse_m,
 *            greedy_return (eval_every 마다 탐욕 정책 평가(고정 seed), 그 외 null), best_greedy_return, done }
 * 표 Q-러닝의 최종 표는 마지막 몇백 에피소드에 따라 성능이 크게 흔들린다. keep_best 이면 탐욕 평가 최고 시점의 표를 결과로 낸다.
 */
export function createQLearner({ env: envOpts = {}, q: qOpts = {}, seed = 1, init_table = null } = {}) {
  const q = { ...DEFAULT_Q, ...qOpts };
  const env = new BallBeamEnv({ ...envOpts, seed: seed * 7 + 1 });
  const T = init_table ? JSON.parse(JSON.stringify(init_table)) : emptyQTable(q);
  const R = rng(seed);
  const na = T.actions_rad.length;
  let ep = 0;
  const history = [];
  const decayN = Math.max(1, Math.round(q.eps_decay_frac * q.episodes));
  let best = { ret: -Infinity, ep: 0, Q: null };
  const evalEnv = { ...envOpts };
  const job = {
    done: false, history, table: T,
    step(budget = 20) {
      for (let b = 0; b < budget && !job.done; b++) {
        const eps = Math.max(q.eps_end, q.eps_start + (q.eps_end - q.eps_start) * Math.min(1, ep / decayN));
        let obs = env.reset(seed * 1000003 + ep);
        let s = discretize(obs, T).index;
        let ret = 0, len = 0, end = false, se = 0;
        for (;;) {
          let a;
          if (R.uniform() < eps) a = Math.floor(R.uniform() * na);
          else a = qGreedy(T, obs);
          const r = env.step(T.actions_rad[a]);
          const s2 = discretize(r.obs, T).index;
          const terminal = r.info.end_hit && env.opts.terminate_on_end;
          let maxQ = -Infinity;
          for (let k = 0; k < na; k++) maxQ = Math.max(maxQ, T.Q[s2 * na + k]);
          const target = r.reward + (terminal ? 0 : q.gamma * maxQ);
          const ix = s * na + a;
          T.Q[ix] += q.alpha * (target - T.Q[ix]);
          T.visits[ix] += 1;
          ret += r.reward; len += 1; se += (r.info.ref_m - r.info.y_m) ** 2;
          if (r.info.end_hit) end = true;
          obs = r.obs; s = s2;
          if (r.done) break;
        }
        ep += 1;
        const last = history.slice(-49);
        const m50 = (last.reduce((acc, h) => acc + h.return, 0) + ret) / (last.length + 1);
        const sr = (last.filter((h) => !h.end_hit).length + (end ? 0 : 1)) / (last.length + 1);
        history.push({ kind: 'qlearn', iter: ep, total: q.episodes, return: ret, length: len, epsilon: eps, mean_return_50: m50, success_rate_50: sr,
          visited_frac: 0, end_hit: end, rmse_m: Math.sqrt(se / len), greedy_return: null, best_greedy_return: best.ret, done: ep >= q.episodes });
        if (q.eval_every > 0 && (ep % q.eval_every === 0 || ep >= q.episodes)) {
          const g = evaluateQ(T, { env: evalEnv, episodes: q.eval_episodes, seed: 777000 + seed });
          const h = history[history.length - 1];
          h.greedy_return = g.mean_return;
          if (g.mean_return > best.ret) best = { ret: g.mean_return, ep, Q: T.Q.slice() };
          h.best_greedy_return = best.ret;
        }
        if (ep >= q.episodes) job.done = true;
      }
      const p = history[history.length - 1];
      if (p) p.visited_frac = visitedFrac(T);
      return p || { kind: 'qlearn', iter: 0, total: q.episodes, done: job.done };
    },
    cancel() { job.done = true; },
    result() {
      const out = JSON.parse(JSON.stringify(T));
      if (q.keep_best && best.Q) out.Q = best.Q.slice();
      out.meta = { ...out.meta, provenance: 'simulated', algo: 'q-learning', seed, episodes: ep, alpha: q.alpha, gamma: q.gamma,
        eps_start: q.eps_start, eps_end: q.eps_end, best_episode: q.keep_best && best.Q ? best.ep : ep, best_greedy_return: best.ret,
        env: summarizeEnv(env.opts) };
      return out;
    },
  };
  return job;
}

function visitedFrac(T) {
  const na = T.actions_rad.length, nS = T.Q.length / na;
  let c = 0;
  for (let s = 0; s < nS; s++) { let v = 0; for (let a = 0; a < na; a++) v += T.visits[s * na + a]; if (v > 0) c++; }
  return c / nS;
}

export function summarizeEnv(o) {
  const { Ts_s, t_end_s, substeps, model, y0_range_m, ref_range_m, ref_switch_prob, noise_m, quant_m, lost_prob, alpha, domain } = o;
  return { Ts_s, t_end_s, substeps, model, y0_range_m, ref_range_m, ref_switch_prob, noise_m, quant_m, lost_prob, alpha, domain };
}

/** q-table-view 위젯용 → { e_centers, v_centers, actions_rad, maxQ[i_v][i_e], greedy_u[i_v][i_e], visits[i_v][i_e] } */
export function qTableView(T) {
  const centers = (edges, lo, hi) => {
    const b = [lo, ...edges, hi];
    return b.slice(1).map((x, i) => 0.5 * (x + b[i]));
  };
  const ne = T.e_edges.length + 1, nv = T.v_edges.length + 1, na = T.actions_rad.length;
  const e0 = T.e_edges[0], e1 = T.e_edges[T.e_edges.length - 1];
  const v0 = T.v_edges[0], v1 = T.v_edges[T.v_edges.length - 1];
  const e_centers = centers(T.e_edges, e0 - (T.e_edges[1] - e0), e1 + (e1 - T.e_edges[T.e_edges.length - 2]));
  const v_centers = centers(T.v_edges, v0 - (T.v_edges[1] - v0), v1 + (v1 - T.v_edges[T.v_edges.length - 2]));
  const maxQ = [], greedy_u = [], visits = [];
  for (let iv = 0; iv < nv; iv++) {
    const rq = [], ru = [], rv = [];
    for (let ie = 0; ie < ne; ie++) {
      const base = (ie * nv + iv) * na;
      let best = 0, bv = -Infinity, vis = 0;
      for (let a = 0; a < na; a++) { if (T.Q[base + a] > bv) { bv = T.Q[base + a]; best = a; } vis += T.visits ? T.visits[base + a] : 0; }
      rq.push(bv); ru.push(vis > 0 ? T.actions_rad[best] : null); rv.push(vis);
    }
    maxQ.push(rq); greedy_u.push(ru); visits.push(rv);
  }
  return { e_centers, v_centers, e_edges: T.e_edges.slice(), v_edges: T.v_edges.slice(), actions_rad: T.actions_rad.slice(), maxQ, greedy_u, visits };
}

/** 탐욕 정책으로 평가 */
export function evaluateQ(T, { env: envOpts = {}, episodes = 20, seed = 1000 } = {}) {
  const env = new BallBeamEnv(envOpts);
  let R = 0, F = 0, rm = 0;
  for (let i = 0; i < episodes; i++) {
    let obs = env.reset(seed + i);
    let ret = 0, done = false, end = false;
    const ys = [], rs = [];
    while (!done) {
      const r = env.step(T.actions_rad[qGreedy(T, obs)]);
      ret += r.reward; obs = r.obs; done = r.done; if (r.info.end_hit) end = true;
      ys.push(r.info.y_m); rs.push(r.info.ref_m);
    }
    R += ret; F += end ? 1 : 0; rm += trajRmse({ y_m: ys, ref_m: rs });
  }
  return { mean_return: R / episodes, fail_rate: F / episodes, rmse_m: rm / episodes };
}
