// es.js — 신경망 정책을 진화 전략으로 학습 (ai-extension §2.7, 18장)
//
// 정책: u = u_lim·tanh( MLP( normObs([e, v, u_prev]) ) )
// 목적: J(θ) = 에피소드 보상 합의 평균 (같은 반복 안에서는 모든 후보가 같은 에피소드 seed — 공통 난수로 분산 감소)
//
// OpenAI-ES (Salimans 2017):  ε_i ~ N(0, I), 대칭 쌍 θ ± σε_i
//   ∇J ≈ 1/(nσ) Σ F_i ε_i,  F_i = 중심 순위 변환(centered rank)한 적합도  → Adam 으로 θ 갱신(경사 상승)
// CEM: θ_i ~ N(μ, diag σ²), 상위 elite_frac 의 평균·표준편차로 μ, σ 갱신 (σ 하한 sigma_min)
// 결과는 매 반복 "중심" 정책을 고정 seed 에피소드로 평가해 가장 좋았던 것.
import { rng } from '../linalg.js';
import { createMLP, getParams, setParams, toJSON, fromJSON, forward, paramCount } from './mlp.js';
import { normObs, OBS_SPEC } from './obs.js';
import { BallBeamEnv } from './train_env.js';
import { nnPolicyJSON } from './policy.js';
import { summarizeEnv } from './qlearn.js';

function episodeReturn(env, net, lim, seed) {
  let obs = env.reset(seed);
  let ret = 0, done = false;
  while (!done) {
    const u = lim * Math.tanh(forward(net, normObs(obs))[0]);
    const r = env.step(u);
    ret += r.reward; obs = r.obs; done = r.done;
  }
  return ret;
}

function centeredRanks(f) {
  const n = f.length;
  const idx = f.map((_, i) => i).sort((a, b) => f[a] - f[b]);
  const r = new Array(n);
  idx.forEach((i, k) => { r[i] = n > 1 ? k / (n - 1) - 0.5 : 0; });
  return r;
}

/**
 * ES job. budget = 반복 수(기본 1)
 * Progress { kind:'es', iter, total, mean_return, best_return, center_return, best_center_return, sigma, grad_norm, done }
 */
export function createES({ env: envOpts = {}, hidden = [8], activation = 'tanh', method = 'openai-es', pop = 24, sigma = 0.1, lr = 0.05,
  iters = 120, episodes_per_eval = 3, eval_episodes = 6, elite_frac = 0.2, sigma_min = 0.02, seed = 1, init = null, init_scale = 0.5 } = {}) {
  if (method !== 'openai-es' && method !== 'cem') throw new Error('createES: method 는 openai-es|cem');
  const env = new BallBeamEnv({ ...envOpts, seed: seed * 13 + 5 });
  const evalEnv = new BallBeamEnv({ ...envOpts, seed: 99 });
  const lim = env.u_lim_rad;
  const net = init ? fromJSON(init.net) : createMLP({ sizes: [OBS_SPEC.names.length, ...hidden, 1], activation, out_activation: 'linear', seed, init_scale });
  const probe = fromJSON(toJSON(net));
  const R = rng(seed + 17);
  const nP = paramCount(net);
  let theta = Array.from(getParams(net));
  let sig = method === 'cem' ? new Array(nP).fill(sigma) : sigma;
  // Adam 상태
  const m = new Array(nP).fill(0), v = new Array(nP).fill(0);
  let it = 0;
  const half = Math.max(1, Math.floor(pop / 2));
  const history = [];
  let best = { ret: -Infinity, iter: 0, theta: theta.slice() };
  const evalTheta = (th, e, seeds) => { setParams(probe, th); let s = 0; for (const sd of seeds) s += episodeReturn(e, probe, lim, sd); return s / seeds.length; };
  const evalSeeds = Array.from({ length: eval_episodes }, (_, i) => 500000 + i);
  const job = {
    done: false, history,
    step(budget = 1) {
      for (let b = 0; b < budget && !job.done; b++) {
        const seeds = Array.from({ length: episodes_per_eval }, (_, j) => seed * 100003 + it * 31 + j);
        let fits = [], meanF = 0, bestF = -Infinity, gnorm = 0;
        if (method === 'openai-es') {
          const eps = [];
          for (let i = 0; i < half; i++) {
            const e = Array.from({ length: nP }, () => R.normal());
            eps.push(e);
            fits.push(evalTheta(theta.map((t, k) => t + sig * e[k]), env, seeds));
            fits.push(evalTheta(theta.map((t, k) => t - sig * e[k]), env, seeds));
          }
          const rk = centeredRanks(fits);
          const g = new Array(nP).fill(0);
          for (let i = 0; i < half; i++) {
            const w = rk[2 * i] - rk[2 * i + 1];
            for (let k = 0; k < nP; k++) g[k] += w * eps[i][k];
          }
          for (let k = 0; k < nP; k++) g[k] /= 2 * half * sig;
          gnorm = Math.sqrt(g.reduce((s, x) => s + x * x, 0));
          const t = it + 1, b1 = 0.9, b2 = 0.999;
          for (let k = 0; k < nP; k++) {
            m[k] = b1 * m[k] + (1 - b1) * g[k];
            v[k] = b2 * v[k] + (1 - b2) * g[k] * g[k];
            theta[k] += (lr * (m[k] / (1 - b1 ** t))) / (Math.sqrt(v[k] / (1 - b2 ** t)) + 1e-8); // 경사 상승
          }
        } else {
          const cands = [];
          for (let i = 0; i < pop; i++) {
            const th = theta.map((t, k) => t + sig[k] * R.normal());
            cands.push(th);
            fits.push(evalTheta(th, env, seeds));
          }
          const order = fits.map((_, i) => i).sort((a, b) => fits[b] - fits[a]);
          const ne = Math.max(2, Math.round(elite_frac * pop));
          const el = order.slice(0, ne).map((i) => cands[i]);
          const mu = new Array(nP).fill(0);
          for (const th of el) for (let k = 0; k < nP; k++) mu[k] += th[k] / ne;
          const sd = new Array(nP).fill(0);
          for (const th of el) for (let k = 0; k < nP; k++) sd[k] += (th[k] - mu[k]) ** 2 / ne;
          gnorm = Math.sqrt(mu.reduce((s, x, k) => s + (x - theta[k]) ** 2, 0));
          theta = mu;
          sig = sd.map((x) => Math.max(sigma_min, Math.sqrt(x)));
        }
        meanF = fits.reduce((s, x) => s + x, 0) / fits.length;
        bestF = Math.max(...fits);
        it += 1;
        const cRet = evalTheta(theta, evalEnv, evalSeeds);
        if (cRet > best.ret) best = { ret: cRet, iter: it, theta: theta.slice() };
        const sigOut = method === 'cem' ? sig.reduce((s, x) => s + x, 0) / nP : sig;
        history.push({ kind: 'es', iter: it, total: iters, mean_return: meanF, best_return: bestF, center_return: cRet, best_center_return: best.ret,
          sigma: sigOut, grad_norm: gnorm, done: it >= iters });
        if (it >= iters) job.done = true;
      }
      return history[history.length - 1] || { kind: 'es', iter: 0, total: iters, done: job.done };
    },
    cancel() { job.done = true; },
    /** → nn-policy JSON (최고 중심 정책). opts.last = true 면 마지막 중심 */
    result(opts = {}) {
      const out = fromJSON(toJSON(net));
      setParams(out, opts.last ? theta : best.theta);
      return nnPolicyJSON(toJSON(out), { u_lim_rad: lim, meta: { algo: method, seed, iters: it, pop, sigma, lr, episodes_per_eval,
        best_iter: opts.last ? it : best.iter, best_center_return: best.ret, env: summarizeEnv(env.opts) } });
    },
  };
  return job;
}
