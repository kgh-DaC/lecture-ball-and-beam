// mlp.js — 완전연결 신경망(MLP): 순전파, 역전파, SGD·Adam, 미니배치, 학습/검증 분할, JSON 직렬화
// docs/spec/ai-extension.md §2.1. 외부 의존성 없음, 난수는 linalg.rng(seed)만 사용(결정론).
//
// 표기: 층 l = 1..L,  z_l = W_l a_{l−1} + b_l,  a_l = f_l(z_l),  a_0 = x
//   W_l 은 행 우선 1차원 배열 [n_out × n_in],  W_l[o·n_in + i]
//   손실 MSE = mean_{표본, 출력} (ŷ − y)²
//   역전파: δ_L = ∂J/∂a_L ⊙ f'_L(z_L),  δ_{l−1} = (W_lᵀ δ_l) ⊙ f'_{l−1}(z_{l−1})
//           ∂J/∂W_l = δ_l a_{l−1}ᵀ,  ∂J/∂b_l = δ_l
import { rng } from '../linalg.js';

const ACT = {
  tanh: { f: (z) => Math.tanh(z), df: (z, a) => 1 - a * a },
  relu: { f: (z) => (z > 0 ? z : 0), df: (z) => (z > 0 ? 1 : 0) },
  linear: { f: (z) => z, df: () => 1 },
};

/** 신경망 생성. 초기화: tanh/linear → Xavier(√(1/n_in)), relu → He(√(2/n_in)) 정규분포 */
export function createMLP({ sizes, activation = 'tanh', out_activation = 'linear', seed = 1, init_scale = 1 } = {}) {
  if (!Array.isArray(sizes) || sizes.length < 2 || sizes.some((n) => !(Number.isInteger(n) && n > 0))) {
    throw new Error('createMLP: sizes 는 양의 정수 배열(길이 ≥ 2)');
  }
  if (!ACT[activation] || !ACT[out_activation]) throw new Error('createMLP: activation 은 tanh|relu|linear');
  const R = rng(seed);
  const W = [], b = [];
  for (let l = 1; l < sizes.length; l++) {
    const nIn = sizes[l - 1], nOut = sizes[l];
    const isOut = l === sizes.length - 1;
    const act = isOut ? out_activation : activation;
    const s = init_scale * (act === 'relu' ? Math.sqrt(2 / nIn) : Math.sqrt(1 / nIn));
    W.push(Array.from({ length: nIn * nOut }, () => s * R.normal()));
    b.push(new Array(nOut).fill(0));
  }
  return { sizes: sizes.slice(), activation, out_activation, W, b };
}

function actOf(net, l) { return l === net.sizes.length - 1 ? ACT[net.out_activation] : ACT[net.activation]; }

/** 순전파 (활성값 저장) → { z, a }  a[0] = x, a[L] = 출력 */
export function forwardCache(net, x) {
  const L = net.sizes.length - 1;
  const z = [null], a = [Array.from(x)];
  for (let l = 1; l <= L; l++) {
    const nIn = net.sizes[l - 1], nOut = net.sizes[l];
    const Wl = net.W[l - 1], bl = net.b[l - 1], ap = a[l - 1];
    const f = actOf(net, l).f;
    const zl = new Array(nOut), al = new Array(nOut);
    for (let o = 0; o < nOut; o++) {
      let s = bl[o];
      const off = o * nIn;
      for (let i = 0; i < nIn; i++) s += Wl[off + i] * ap[i];
      zl[o] = s; al[o] = f(s);
    }
    z.push(zl); a.push(al);
  }
  return { z, a };
}

/** 순전파 → 출력 */
export function forward(net, x) { const c = forwardCache(net, x); return c.a[c.a.length - 1]; }

function zeroGrads(net) {
  return { gW: net.W.map((w) => new Array(w.length).fill(0)), gb: net.b.map((v) => new Array(v.length).fill(0)) };
}

/**
 * 역전파 (한 표본). dLdy = ∂J/∂출력. acc 를 주면 거기에 누적한다.
 * @returns {{ gW, gb, dx }}
 */
export function backward(net, cache, dLdy, acc = null) {
  const L = net.sizes.length - 1;
  const g = acc || zeroGrads(net);
  let delta = dLdy.map((d, o) => d * actOf(net, L).df(cache.z[L][o], cache.a[L][o]));
  let dx = null;
  for (let l = L; l >= 1; l--) {
    const nIn = net.sizes[l - 1], nOut = net.sizes[l];
    const Wl = net.W[l - 1], ap = cache.a[l - 1];
    const gW = g.gW[l - 1], gb = g.gb[l - 1];
    const prev = new Array(nIn).fill(0);
    for (let o = 0; o < nOut; o++) {
      const d = delta[o];
      gb[o] += d;
      const off = o * nIn;
      for (let i = 0; i < nIn; i++) { gW[off + i] += d * ap[i]; prev[i] += Wl[off + i] * d; }
    }
    if (l > 1) {
      const df = actOf(net, l - 1).df;
      delta = prev.map((p, i) => p * df(cache.z[l - 1][i], cache.a[l - 1][i]));
    } else dx = prev;
  }
  g.dx = dx;
  return g;
}

/**
 * MSE 손실과 기울기 (미니배치). loss = mean((ŷ−y)²) + l2·Σw²(편향 제외)
 * @param idx 사용할 표본 인덱스(없으면 전체)
 */
export function lossAndGrad(net, X, Y, idx = null, { l2 = 0 } = {}) {
  const ids = idx || X.map((_, i) => i);
  const n = ids.length;
  const nOut = net.sizes[net.sizes.length - 1];
  const g = zeroGrads(net);
  let loss = 0;
  const scale = 2 / (n * nOut);
  for (const k of ids) {
    const c = forwardCache(net, X[k]);
    const yh = c.a[c.a.length - 1];
    const d = new Array(nOut);
    for (let o = 0; o < nOut; o++) { const r = yh[o] - Y[k][o]; loss += r * r; d[o] = scale * r; }
    backward(net, c, d, g);
  }
  loss /= n * nOut;
  if (l2 > 0) {
    for (let l = 0; l < net.W.length; l++) {
      const w = net.W[l], gw = g.gW[l];
      for (let i = 0; i < w.length; i++) { loss += l2 * w[i] * w[i]; gw[i] += 2 * l2 * w[i]; }
    }
  }
  delete g.dx;
  return { loss, gW: g.gW, gb: g.gb };
}

/** 손실만 (기울기 없음) */
export function evalLoss(net, X, Y) {
  if (!X.length) return NaN;
  const nOut = net.sizes[net.sizes.length - 1];
  let s = 0;
  for (let k = 0; k < X.length; k++) {
    const yh = forward(net, X[k]);
    for (let o = 0; o < nOut; o++) { const r = yh[o] - Y[k][o]; s += r * r; }
  }
  return s / (X.length * nOut);
}

/** 최적화기: sgd(모멘텀 선택) | adam */
export function createOptimizer(net, { type = 'adam', lr = 1e-3, momentum = 0, beta1 = 0.9, beta2 = 0.999, eps = 1e-8 } = {}) {
  if (type !== 'sgd' && type !== 'adam') throw new Error('createOptimizer: type 은 sgd|adam');
  const st = { t: 0, mW: net.W.map((w) => new Array(w.length).fill(0)), mb: net.b.map((v) => new Array(v.length).fill(0)),
    vW: net.W.map((w) => new Array(w.length).fill(0)), vb: net.b.map((v) => new Array(v.length).fill(0)) };
  const opt = { type, lr, momentum, beta1, beta2, eps, state: st };
  const upd = (p, g, m, v) => {
    if (type === 'sgd') {
      for (let i = 0; i < p.length; i++) { m[i] = opt.momentum * m[i] + g[i]; p[i] -= opt.lr * m[i]; }
    } else {
      const b1t = 1 - beta1 ** st.t, b2t = 1 - beta2 ** st.t;
      for (let i = 0; i < p.length; i++) {
        m[i] = beta1 * m[i] + (1 - beta1) * g[i];
        v[i] = beta2 * v[i] + (1 - beta2) * g[i] * g[i];
        p[i] -= (opt.lr * (m[i] / b1t)) / (Math.sqrt(v[i] / b2t) + eps);
      }
    }
  };
  opt.step = (nt, grads) => {
    st.t += 1;
    for (let l = 0; l < nt.W.length; l++) { upd(nt.W[l], grads.gW[l], st.mW[l], st.vW[l]); upd(nt.b[l], grads.gb[l], st.mb[l], st.vb[l]); }
  };
  return opt;
}

/** 결정론적 섞기 (Fisher–Yates) */
export function shuffled(n, R) {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(R.uniform() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}

/** 학습/검증 분할 */
export function splitData(X, Y, { val_frac = 0.2, seed = 1, shuffle = true } = {}) {
  const n = X.length;
  const order = shuffle ? shuffled(n, rng(seed)) : Array.from({ length: n }, (_, i) => i);
  const nVa = Math.min(n - 1, Math.max(0, Math.round(n * val_frac)));
  const va = order.slice(0, nVa), tr = order.slice(nVa);
  return { Xtr: tr.map((i) => X[i]), Ytr: tr.map((i) => Y[i]), Xva: va.map((i) => X[i]), Yva: va.map((i) => Y[i]) };
}

/** 열별 평균·표준편차 (std 0 → 1) */
export function fitNormalizer(X) {
  const d = X[0].length, n = X.length;
  const mean = new Array(d).fill(0), std = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) { std[j] = Math.sqrt(std[j]); if (!(std[j] > 1e-12)) std[j] = 1; }
  return { mean, std };
}
export function normalize(norm, x) { return x.map((v, j) => (v - norm.mean[j]) / norm.std[j]); }
export function denormalize(norm, x) { return x.map((v, j) => v * norm.std[j] + norm.mean[j]); }

export function cloneNet(net) {
  return { sizes: net.sizes.slice(), activation: net.activation, out_activation: net.out_activation, W: net.W.map((w) => w.slice()), b: net.b.map((v) => v.slice()) };
}

/**
 * 학습 job (ai-extension §2.0). budget = 에폭 수.
 * Progress { kind:'mlp', iter, total, train_loss, val_loss, best_epoch, best_val_loss, done }
 */
export function createTrainer(net, { X, Y }, { epochs = 200, batch_size = 32, optimizer = 'adam', lr = 1e-3, momentum = 0.9, l2 = 0,
  val_frac = 0.2, seed = 1, keep_best = true, kind = 'mlp' } = {}) {
  const sp = splitData(X, Y, { val_frac, seed });
  const R = rng(seed + 7919);
  const opt = createOptimizer(net, { type: optimizer, lr, momentum: optimizer === 'sgd' ? momentum : 0 });
  let epoch = 0, best = { epoch: 0, val: Infinity, net: cloneNet(net) };
  const history = [];
  const job = {
    done: false, history, split: sp,
    step(budget = 1) {
      for (let b = 0; b < budget && !job.done; b++) {
        const order = shuffled(sp.Xtr.length, R);
        for (let s = 0; s < order.length; s += batch_size) {
          const g = lossAndGrad(net, sp.Xtr, sp.Ytr, order.slice(s, s + batch_size), { l2 });
          opt.step(net, g);
        }
        epoch += 1;
        const trL = evalLoss(net, sp.Xtr, sp.Ytr);
        const vaL = sp.Xva.length ? evalLoss(net, sp.Xva, sp.Yva) : NaN;
        const score = Number.isFinite(vaL) ? vaL : trL;
        if (score < best.val) best = { epoch, val: score, net: cloneNet(net) };
        history.push({ kind, iter: epoch, total: epochs, train_loss: trL, val_loss: vaL, best_epoch: best.epoch, best_val_loss: best.val, done: epoch >= epochs });
        if (epoch >= epochs) job.done = true;
      }
      return history[history.length - 1] || { kind, iter: 0, total: epochs, done: job.done };
    },
    cancel() { job.done = true; },
    result() { return { net: keep_best ? cloneNet(best.net) : cloneNet(net), history: history.slice(), best_epoch: best.epoch, last_net: cloneNet(net) }; },
  };
  return job;
}

export function paramCount(net) { return net.W.reduce((s, w) => s + w.length, 0) + net.b.reduce((s, v) => s + v.length, 0); }

/** 모든 파라미터를 하나의 벡터로 (층마다 W 다음 b) */
export function getParams(net) {
  const out = new Float64Array(paramCount(net));
  let k = 0;
  for (let l = 0; l < net.W.length; l++) { for (const v of net.W[l]) out[k++] = v; for (const v of net.b[l]) out[k++] = v; }
  return out;
}
export function setParams(net, flat) {
  let k = 0;
  for (let l = 0; l < net.W.length; l++) {
    for (let i = 0; i < net.W[l].length; i++) net.W[l][i] = flat[k++];
    for (let i = 0; i < net.b[l].length; i++) net.b[l][i] = flat[k++];
  }
  return net;
}

const r7 = (v) => +v.toPrecision(7);
export function toJSON(net, extra = {}) {
  return { format: 'mlp', version: 1, sizes: net.sizes.slice(), activation: net.activation, out_activation: net.out_activation,
    W: net.W.map((w) => w.map(r7)), b: net.b.map((v) => v.map(r7)), ...extra };
}
export function fromJSON(j) {
  if (!j || j.format !== 'mlp' || !Array.isArray(j.sizes) || !Array.isArray(j.W) || !Array.isArray(j.b)) throw new Error('fromJSON: mlp 형식이 아님');
  if (j.W.length !== j.sizes.length - 1) throw new Error('fromJSON: 층 수 불일치');
  for (let l = 1; l < j.sizes.length; l++) {
    if (j.W[l - 1].length !== j.sizes[l] * j.sizes[l - 1] || j.b[l - 1].length !== j.sizes[l]) throw new Error(`fromJSON: ${l}층 크기 불일치`);
  }
  if (!ACT[j.activation] || !ACT[j.out_activation]) throw new Error('fromJSON: activation 알 수 없음');
  return { sizes: j.sizes.slice(), activation: j.activation, out_activation: j.out_activation, W: j.W.map((w) => w.map(Number)), b: j.b.map((v) => v.map(Number)) };
}
export function describe(net) {
  return { layers: net.sizes.slice(1).map((n, i) => ({ n_in: net.sizes[i], n_out: n, activation: i === net.sizes.length - 2 ? net.out_activation : net.activation })), n_params: paramCount(net) };
}
