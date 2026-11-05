// analysis.js — 교재 위젯용 분석 함수 (controller-interface.md §5)
//
// 모든 함수는 순수 함수다. TF = { num, den, delay } (s 내림차순 계수, delay 초).
// 근궤적·극점·스텝 응답은 지연을 Padé로 근사하고, 보드·나이키스트·여유는 정확한 e^{−jωT}를 쓴다.
import {
  C, roots, polyMul, polyAdd, polyScale, polyDer, polyvalC, polyTrim, polyFromRoots,
  zeros as mzeros, eye, matmul, matadd, matsub, matscale, transpose, solve, inv, expm, eig,
  rank, block, lyap, symmetrize, normFro,
} from './linalg.js';
import { padeCoeffs, tf2ssCanon, plantTF, servoTF } from './plant.js';

// ================================================================ TF 기본
export function tf(num, den, delay = 0) {
  if (!Array.isArray(num) || !Array.isArray(den) || den.length === 0) throw new Error('tf: num, den 배열 필요');
  const d = polyTrim(den.map(Number));
  if (d.length === 1 && d[0] === 0) throw new Error('tf: 분모가 0');
  return { num: polyTrim(num.map(Number)), den: d, delay: Number(delay) || 0 };
}
const asTF = (G) => (G && G.num ? G : tf(G[0], G[1]));

export function series(...tfs) {
  let num = [1], den = [1], delay = 0;
  for (const g of tfs.map(asTF)) { num = polyMul(num, g.num); den = polyMul(den, g.den); delay += g.delay || 0; }
  return { num, den, delay };
}

/** Padé 근사 TF (지연 0) */
export function pade(T_s, order = 1) {
  if (!(T_s > 0)) return { num: [1], den: [1], delay: 0 };
  const p = padeCoeffs(T_s, order);
  return { num: p.num, den: p.den, delay: 0 };
}

/** 지연을 Padé로 바꾼 TF (지연 0) */
export function padeExpand(G, order = 1) {
  if (!(G.delay > 0)) return { num: G.num.slice(), den: G.den.slice(), delay: 0 };
  const P = pade(G.delay, order);
  return { num: polyMul(G.num, P.num), den: polyMul(G.den, P.den), delay: 0 };
}

/** 음의 되먹임 G/(1+GH). 지연이 있으면 opts.pade_order(기본 1)로 근사한 뒤 계산 */
export function feedback(G, H = { num: [1], den: [1], delay: 0 }, opts = {}) {
  G = asTF(G); H = asTF(H);
  const order = opts.pade_order ?? 1;
  const g = padeExpand(G, order), h = padeExpand(H, order);
  return {
    num: polyTrim(polyMul(g.num, h.den)),
    den: polyTrim(polyAdd(polyMul(g.den, h.den), polyMul(g.num, h.num))),
    delay: 0,
  };
}

/** 극점. TF 또는 분모 배열 */
export function poles(tfOrDen) {
  if (Array.isArray(tfOrDen)) return roots(tfOrDen);
  const r = roots(tfOrDen.den);
  if (tfOrDen.delay > 0) Object.defineProperty(r, 'delay_ignored', { value: true, enumerable: false });
  return r;
}
export function zeros(G) { return roots(asTF(G).num); }

/** 제어기 연속 TF. 비선형·상태 의존 제어기는 null */
export function controllerTF(id, params = {}) {
  if (id !== 'pid') return null;
  const kp = params.kp ?? 0, ki = params.ki ?? 0, kd = params.kd ?? 0, N = params.n_filt ?? 10;
  const Tf = kd > 0 ? (kp > 0 ? kd / (N * kp) : kd / N) : 0;
  // kp + ki/s + kd s/(Tf s + 1)  → 통분
  // 분모: s(Tf s + 1) (ki ≠ 0) 또는 (Tf s + 1)
  let num, den;
  if (ki !== 0) {
    den = polyMul([1, 0], [Tf, 1]);
    num = polyAdd(polyAdd(polyMul([kp, 0], [Tf, 1]), polyMul([ki], [Tf, 1])), [kd, 0, 0]);
  } else {
    den = [Tf, 1];
    num = polyAdd(polyMul([kp], [Tf, 1]), [kd, 0]);
  }
  return { num: polyTrim(num), den: polyTrim(den), delay: 0 };
}

/** 재귀 필터 f ← f(1−α)+xα 의 연속 근사 1/(Tf s + 1), Tf = Ts(1−α)/α */
export function sensorTF(alpha, Ts_s) {
  if (!(alpha > 0) || alpha >= 1) return { num: [1], den: [1], delay: 0 };
  const Tf = (Ts_s * (1 - alpha)) / alpha;
  return { num: [1], den: [Tf, 1], delay: 0 };
}

// ================================================================ 주파수 응답
function freqResp(G, w) {
  const s = { re: 0, im: w };
  const v = C.div(polyvalC(G.num, s), polyvalC(G.den, s));
  if (G.delay > 0) return C.mul(v, { re: Math.cos(-w * G.delay), im: Math.sin(-w * G.delay) });
  return v;
}
/** 연속 위상 [rad]: 각 인자 arg의 합 (적분기 등 허수축 근에서도 매끄러움) */
function makePhaseFn(G) {
  const z = roots(G.num), p = roots(G.den);
  const lead = polyTrim(G.num)[0] / polyTrim(G.den)[0];
  const base = lead < 0 ? -Math.PI : 0;
  return (w) => {
    let ph = base;
    for (const r of z) ph += Math.atan2(w - r.im, -r.re);
    for (const r of p) ph -= Math.atan2(w - r.im, -r.re);
    return ph - w * (G.delay || 0);
  };
}
function logspace(a, b, n) {
  const la = Math.log10(a), lb = Math.log10(b);
  return Array.from({ length: n }, (_, i) => 10 ** (la + ((lb - la) * i) / (n - 1)));
}

/** 보드 선도 */
export function bode(L, opts = {}) {
  L = asTF(L);
  const w = opts.w ?? logspace(opts.wmin ?? 0.01, opts.wmax ?? 100, opts.n ?? 400);
  const ph = makePhaseFn(L);
  const mag_db = [], phase_deg = [];
  for (const wi of w) {
    const v = freqResp(L, wi);
    mag_db.push(20 * Math.log10(C.abs(v)));
    phase_deg.push((ph(wi) * 180) / Math.PI);
  }
  return { w, mag_db, phase_deg };
}

function bisect(f, a, b, it = 80) {
  let fa = f(a);
  for (let i = 0; i < it; i++) {
    const m = Math.sqrt(a * b); // 로그 축 이분
    const fm = f(m);
    if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m;
    if (b / a - 1 < 1e-12) break;
  }
  return Math.sqrt(a * b);
}

/** 이득·위상 여유 */
export function margins(L, opts = {}) {
  L = asTF(L);
  const ph = makePhaseFn(L);
  const mag = (w) => C.abs(freqResp(L, w));
  const w = logspace(opts.wmin ?? 1e-4, opts.wmax ?? 1e4, opts.n ?? 3000);
  const gcs = [], pcs = [];
  const lm = w.map((x) => Math.log(mag(x)));
  const phd = w.map((x) => ph(x));
  for (let i = 0; i < w.length - 1; i++) {
    if (Number.isFinite(lm[i]) && Number.isFinite(lm[i + 1]) && (lm[i] > 0) !== (lm[i + 1] > 0)) {
      gcs.push(bisect((x) => Math.log(mag(x)), w[i], w[i + 1]));
    }
    // 위상 −180° + 360°k 교차
    const k0 = Math.floor((phd[i] + Math.PI) / (2 * Math.PI));
    const k1 = Math.floor((phd[i + 1] + Math.PI) / (2 * Math.PI));
    if (k0 !== k1) {
      const k = Math.max(k0, k1);
      const target = -Math.PI + 2 * Math.PI * k;
      pcs.push(bisect((x) => ph(x) - target, w[i], w[i + 1]));
    }
  }
  let pm_deg = null, wgc = null, delay_margin_s = null;
  for (const wc of gcs) {
    let pm = ((ph(wc) + Math.PI) * 180) / Math.PI;
    pm = ((pm + 180) % 360 + 360) % 360 - 180; // (−180, 180]
    if (pm_deg === null || pm < pm_deg) { pm_deg = pm; wgc = wc; }
    if (pm > 0) {
      const dm = (pm * Math.PI) / 180 / wc;
      if (delay_margin_s === null || dm < delay_margin_s) delay_margin_s = dm;
    }
  }
  if (pm_deg !== null && pm_deg <= 0) delay_margin_s = 0;
  let gm_db = null, wpc = null;
  for (const wp of pcs) {
    const g = -20 * Math.log10(mag(wp));
    if (gm_db === null || Math.abs(g) < Math.abs(gm_db)) { gm_db = g; wpc = wp; }
  }
  return { gm_db, pm_deg, wgc, wpc, delay_margin_s, all: { gain_crossovers: gcs.slice(0, 10), phase_crossovers: pcs.slice(0, 10) } };
}

/** 나이키스트: 양의 주파수 가지 + 포위 수 계산 */
export function nyquist(L, opts = {}) {
  L = asTF(L);
  const wmin = opts.wmin ?? 1e-3, wmax = opts.wmax ?? 1e3, n = opts.n ?? 600;
  const pl = roots(L.den);
  const tolAx = 1e-9;
  const axisPoles = pl.filter((p) => Math.abs(p.re) < tolAx * Math.max(1, Math.abs(p.im)) + 1e-12);
  const P_rhp = pl.filter((p) => p.re > tolAx * Math.max(1, Math.abs(p.im)) + 1e-12).length;
  const radius = opts.indent_radius ?? Math.min(1e-3, wmin);
  const Ls = (s) => {
    const v = C.div(polyvalC(L.num, s), polyvalC(L.den, s));
    if (L.delay > 0) return C.mul(v, C.exp({ re: -s.re * L.delay, im: -s.im * L.delay }));
    return v;
  };
  // 표시용 양의 주파수 가지 (−1 근처 적응 세분)
  let w = logspace(wmin, wmax, n);
  const refine = (ws) => {
    const out = [ws[0]];
    for (let i = 1; i < ws.length; i++) {
      const a = freqResp(L, ws[i - 1]), b = freqResp(L, ws[i]);
      const da = C.abs(C.add(a, { re: 1, im: 0 })), db = C.abs(C.add(b, { re: 1, im: 0 }));
      const step = C.abs(C.sub(a, b));
      const near = Math.min(da, db);
      const k = near < 2 && step > 0.05 * Math.max(near, 0.05) ? Math.min(16, Math.ceil(step / (0.05 * Math.max(near, 0.05)))) : 1;
      for (let j = 1; j < k; j++) out.push(ws[i - 1] * (ws[i] / ws[i - 1]) ** (j / k));
      out.push(ws[i]);
    }
    return out;
  };
  w = refine(w);
  const re = [], im = [];
  for (const wi of w) { const v = freqResp(L, wi); re.push(v.re); im.push(v.im); }

  // 포위 수: D-윤곽 (−j∞ → +j∞, 허수축 극점은 오른쪽 반원으로 우회) 위에서 1+L의 위상 누적
  const contour = buildContour(axisPoles, radius, Math.max(wmax, 1e4));
  let total = 0;
  let prev = C.add(Ls(contour[0]), { re: 1, im: 0 });
  let prevS = contour[0];
  const addSeg = (s, depth = 0) => {
    const cur = C.add(Ls(s), { re: 1, im: 0 });
    let d = C.arg(cur) - C.arg(prev);
    if (Math.abs(d) > 0.5 && depth < 14) {
      // 세분
      const mid = { re: 0.5 * (prevS.re + s.re), im: 0.5 * (prevS.im + s.im) };
      addSeg(mid, depth + 1);
      addSeg(s, depth + 1);
      return;
    }
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = cur; prevS = s;
  };
  for (let i = 1; i < contour.length; i++) addSeg(contour[i]);
  const ccw = Math.round(total / (2 * Math.PI));
  const N_cw = -ccw || 0;
  const Z_rhp = N_cw + P_rhp;
  return {
    w, re, im, mirror: true,
    indent: { count: axisPoles.length, radius },
    P_rhp, N_cw, Z_rhp, stable: Z_rhp === 0,
    zoom_radius: opts.zoom_radius ?? 2,
  };
}

function buildContour(axisPoles, r, W) {
  // 허수축 극점 높이(중복 제거)
  const hs = [...new Set(axisPoles.map((p) => +p.im.toFixed(9)))].sort((a, b) => a - b);
  const pts = [];
  const axisSeg = (a, b) => {
    // a < b, 허수축 위 s = j w, 로그 간격(0 근처 조밀)
    const n = 400;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let w;
      if (a < 0 && b > 0) w = a + (b - a) * t;
      else {
        const sa = Math.sign(a || b) || 1;
        const la = Math.log(Math.max(Math.abs(a), 1e-12)), lb = Math.log(Math.max(Math.abs(b), 1e-12));
        if (sa > 0) w = Math.exp(la + (lb - la) * t);
        else w = -Math.exp(la + (lb - la) * t);
      }
      pts.push({ re: 0, im: w });
    }
  };
  let cur = -W;
  const segs = [];
  for (const h of hs) { segs.push([cur, h - r]); segs.push({ arc: h }); cur = h + r; }
  segs.push([cur, W]);
  for (const sg of segs) {
    if (Array.isArray(sg)) {
      const [a, b] = sg;
      if (a < 0 && b > 0) { axisSeg(a, -1e-6 * W); axisSeg(-1e-6 * W, 1e-6 * W); axisSeg(1e-6 * W, b); }
      else axisSeg(a, b);
    } else {
      // 오른쪽 반원 우회: s = j h + r e^{jφ}, φ: −π/2 → π/2
      const n = 200;
      for (let i = 0; i <= n; i++) {
        const ph = -Math.PI / 2 + (Math.PI * i) / n;
        pts.push({ re: r * Math.cos(ph), im: sg.arc + r * Math.sin(ph) });
      }
    }
  }
  // 무한 반원 (+j∞ → −j∞, 시계 방향): 진분수면 L→상수라 작은 영향, 그래도 점을 찍는다
  const n = 200;
  for (let i = 0; i <= n; i++) {
    const ph = Math.PI / 2 - (Math.PI * i) / n;
    pts.push({ re: W * Math.cos(ph), im: W * Math.sin(ph) });
  }
  return pts;
}

// ================================================================ 근궤적
/** 1 + k·L(s) = 0 의 근을 k에 대해 스윕 */
export function rlocus(L, opts = {}) {
  L = asTF(L);
  const G = padeExpand(L, opts.pade_order ?? 1);
  const num = polyTrim(G.num), den = polyTrim(G.den);
  let gains = opts.gains;
  if (!gains) {
    const n = opts.lowres ? 60 : opts.n ?? 200;
    const kmin = opts.kmin ?? 0, kmax = opts.kmax ?? 50;
    gains = Array.from({ length: n }, (_, i) => kmin + (kmax - kmin) * (i / (n - 1)) ** 2);
  }
  const order = den.length - 1;
  const branches = Array.from({ length: Math.max(order, num.length - 1) }, () => []);
  let prev = null;
  for (const k of gains) {
    const cp = polyAdd(den, polyScale(num, k));
    let r = roots(cp);
    while (r.length < branches.length) r.push({ re: NaN, im: NaN });
    if (prev) r = matchRoots(prev, r);
    r.forEach((z, i) => branches[i].push(z));
    prev = r;
  }
  const open_poles = roots(den), open_zeros = roots(num);
  const nm = open_poles.length - open_zeros.length;
  let asymptotes = { centroid: null, angles_rad: [] };
  if (nm > 0) {
    const sp = open_poles.reduce((s, p) => s + p.re, 0), sz = open_zeros.reduce((s, z) => s + z.re, 0);
    asymptotes = { centroid: (sp - sz) / nm, angles_rad: Array.from({ length: nm }, (_, q) => ((2 * q + 1) * Math.PI) / nm) };
  }
  // 이탈·유입점: num'·den − num·den' = 0, k = −den/num 이 양의 실수
  const bpoly = polyAdd(polyMul(polyDer(num), den), polyScale(polyMul(num, polyDer(den)), -1));
  const breakaway = [];
  for (const s of roots(polyTrim(bpoly))) {
    const kk = C.div(polyvalC(den, s), polyvalC(num, s));
    const k = -kk.re;
    if (Math.abs(kk.im) < 1e-6 * Math.max(1, Math.abs(kk.re)) && k > 1e-12 && Number.isFinite(k)) breakaway.push({ s, k });
  }
  return { gains, branches, open_poles, open_zeros, asymptotes, breakaway, jw_crossings: jwCrossings(num, den) };
}

function matchRoots(prev, cur) {
  const n = prev.length;
  const used = new Array(n).fill(false);
  const out = new Array(n);
  // 거리 작은 쌍부터 탐욕 매칭
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const d = Number.isFinite(cur[j].re) && Number.isFinite(prev[i].re) ? Math.hypot(prev[i].re - cur[j].re, prev[i].im - cur[j].im) : 1e300;
    pairs.push([d, i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const doneI = new Array(n).fill(false);
  for (const [, i, j] of pairs) {
    if (doneI[i] || used[j]) continue;
    out[i] = cur[j]; doneI[i] = true; used[j] = true;
  }
  return out;
}

/** 허수축 교차: den(jw) + k num(jw) = 0, k > 0 */
function jwCrossings(num, den) {
  // p(jw) = Σ c_i (jw)^i  → 실수부·허수부 다항식 (w 내림차순)
  const split = (p) => {
    const n = p.length - 1;
    const R = new Array(n + 1).fill(0), I = new Array(n + 1).fill(0);
    for (let i = 0; i <= n; i++) {
      const pow = n - i; // 계수 p[i]는 s^pow
      const c = p[i];
      switch (pow % 4) {
        case 0: R[i] += c; break;      // j^0 = 1
        case 1: I[i] += c; break;      // j
        case 2: R[i] -= c; break;      // −1
        case 3: I[i] -= c; break;      // −j
      }
    }
    return { R, I };
  };
  const d = split(den), nn = split(num);
  // Im(den · conj(num)) = Id·Rn − Rd·In = 0
  const poly = polyTrim(polyAdd(polyMul(d.I, nn.R), polyScale(polyMul(d.R, nn.I), -1)));
  const out = [];
  if (poly.length === 1) return out;
  for (const r of roots(poly)) {
    if (Math.abs(r.im) > 1e-7 * Math.max(1, Math.abs(r.re)) || r.re < -1e-12) continue;
    const w = Math.max(0, r.re);
    const s = { re: 0, im: w };
    const nv = polyvalC(num, s), dv = polyvalC(den, s);
    const n2 = nv.re * nv.re + nv.im * nv.im;
    if (n2 < 1e-300) continue;
    const k = -(dv.re * nv.re + dv.im * nv.im) / n2;
    if (k > 1e-9 && Number.isFinite(k) && !out.some((o) => Math.abs(o.w - w) < 1e-6 * Math.max(1, w))) out.push({ k, w });
  }
  return out.sort((a, b) => a.k - b.k);
}

// ================================================================ 시간 응답
/** TF → 제어기 정준형 상태공간 */
export function tf2ss(G) {
  G = asTF(G);
  return tf2ssCanon(G.num, G.den);
}

/** 상태공간 → TF (단일 입출력). 분모 = det(sI−A), 분자 = det(sI−A+BC) − det(sI−A) + D·det(sI−A) */
export function ss2tf(A, B, Cm, D = [[0]]) {
  const n = A.length;
  const dval = Array.isArray(D) ? (Array.isArray(D[0]) ? D[0][0] : D[0]) : D;
  if (n === 0) return { num: [dval], den: [1], delay: 0 };
  const den = polyFromRoots(eig(A));
  // C (sI−A)^{-1} B = [det(sI − A + B C) − det(sI − A)] / det(sI − A)
  const BC = matmul(B, Cm);
  const den2 = polyFromRoots(eig(matsub(A, BC)));
  let num = polyAdd(den2, polyScale(den, -1));
  num = polyAdd(num, polyScale(den, dval));
  // 반올림 잡음 정리
  const sc = Math.max(...num.map(Math.abs), 1e-300);
  num = num.map((c) => (Math.abs(c) < 1e-12 * sc ? 0 : c));
  return { num: polyTrim(num), den, delay: 0 };
}

/** ZOH 이산화: [[A, B],[0, 0]]·Ts 의 지수 */
export function c2d(A, B, Ts_s) {
  const n = A.length, m = B[0].length;
  const M = mzeros(n + m, n + m);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) M[i][j] = A[i][j] * Ts_s; for (let j = 0; j < m; j++) M[i][n + j] = B[i][j] * Ts_s; }
  const E = expm(M);
  return { Ad: E.slice(0, n).map((r) => r.slice(0, n)), Bd: E.slice(0, n).map((r) => r.slice(n)) };
}

/** 스텝 응답 (정확한 ZOH 이산화로 진행). 지표는 계산하지 않는다(store/metrics.js stepInfo). */
export function stepResponse(sys, opts = {}) {
  const t_end = opts.t_end_s ?? 10, dt = opts.dt_s ?? 0.01, amp = opts.amplitude ?? 1;
  let A, B, Cm, D;
  if (sys.num) {
    const G = padeExpand(sys, opts.pade_order ?? 2);
    const S = tf2ssCanon(G.num, G.den);
    ({ A, B } = S); Cm = S.C; D = S.D[0][0];
  } else {
    A = sys.A; B = sys.B; Cm = sys.C; D = Array.isArray(sys.D) ? (Array.isArray(sys.D[0]) ? sys.D[0][0] : sys.D[0]) : (sys.D ?? 0);
  }
  const N = Math.floor(t_end / dt + 1e-9) + 1;
  const t_s = new Array(N), y = new Array(N);
  const n = A.length;
  if (n === 0) {
    for (let k = 0; k < N; k++) { t_s[k] = k * dt; y[k] = D * amp; }
    return { t_s, y };
  }
  const { Ad, Bd } = c2d(A, B, dt);
  let x = new Array(n).fill(0);
  for (let k = 0; k < N; k++) {
    t_s[k] = k * dt;
    let yk = D * amp;
    for (let i = 0; i < n; i++) yk += Cm[0][i] * x[i];
    y[k] = yk;
    const xn = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { let s = Bd[i][0] * amp; for (let j = 0; j < n; j++) s += Ad[i][j] * x[j]; xn[i] = s; }
    x = xn;
  }
  return { t_s, y };
}

/**
 * 폐루프 (선형 제어기만). 구조: r → [C_r] → u → P → y, 측정 y_m = H·y (센서 필터), 지연은 P에 합산.
 *  d_on = 'error'       : u = C(s)(r − H y)               → T = P C / (1 + P C H)
 *  d_on = 'measurement' : u = C_pi(r − H y) − C_d H y      → T = P C_pi / (1 + P C H)
 * 반환 L은 지연을 정확히 가진 개루프(보드·나이키스트용), T·poles는 Padé 근사.
 */
export function closedLoop(o) {
  const { model, controller } = o;
  const Cc = controllerTF(controller.id, controller.params);
  if (!Cc) return null;
  const P = plantTF(model);
  const H = o.alpha != null && o.alpha < 1 ? sensorTF(o.alpha, o.Ts_s ?? model.sensor.Ts_s) : { num: [1], den: [1], delay: 0 };
  const delay = (P.delay || 0) + (o.delay_s || 0);
  const order = o.pade_order ?? 1;
  const L = series(Cc, P, H); L.delay = delay;
  const Pp = padeExpand({ ...P, delay }, order);
  // 분자 경로 C_r
  let Cr = Cc;
  if ((controller.params.d_on ?? 'measurement') === 'measurement') {
    Cr = controllerTF('pid', { ...controller.params, kd: 0 });
  }
  // T = Pp·Cr / (1 + Pp·C·H) → 공통 분모로
  // Pp = Np/Dp, C = Nc/Dc, Cr = Nr/Dr, H = Nh/Dh
  const Np = Pp.num, Dp = Pp.den, Nc = Cc.num, Dc = Cc.den, Nh = H.num, Dh = H.den;
  const charP = polyTrim(polyAdd(polyMul(polyMul(Dp, Dc), Dh), polyMul(polyMul(Np, Nc), Nh)));
  // Cr의 분모는 Dc를 나눈다고 가정: d_on=measurement에서 Cr = (kp s + ki)/s 또는 kp,
  // Dc = s(Tf s+1) 또는 (Tf s+1) 이므로 Cr를 Dc 위로 올린다.
  let NrOverDc;
  if (Cr === Cc) NrOverDc = Nc;
  else {
    // Cr = Nr/Dr, Dc = Dr·(Tf s + 1) (kd>0) → Nr·(Tf s + 1)
    const ratio = polyDivExact(Dc, Cr.den);
    NrOverDc = polyMul(Cr.num, ratio);
  }
  const Tnum = polyTrim(polyMul(polyMul(Np, NrOverDc), Dh));
  const T = { num: Tnum, den: charP, delay: 0 };
  const pl = roots(charP);
  const stable = pl.every((p) => p.re < -1e-9);
  const step = o.step === false ? null : stepResponse(T, { t_end_s: o.t_end_s ?? 10, dt_s: o.dt_s ?? 0.01 });
  return { L, T, poles: pl, stable, step };
}

/** 다항식 정확 나눗셈 (나머지 무시) a / b */
function polyDivExact(a, b) {
  a = polyTrim(a); b = polyTrim(b);
  const n = a.length - b.length;
  if (n < 0) return [0];
  const q = new Array(n + 1).fill(0);
  const r = a.slice();
  for (let i = 0; i <= n; i++) {
    const c = r[i] / b[0];
    q[i] = c;
    for (let j = 0; j < b.length; j++) r[i + j] -= c * b[j];
  }
  return q;
}

// ================================================================ 상태공간 설계
export function ctrb(A, B) {
  const n = A.length;
  const cols = [];
  let v = B.map((r) => r[0]);
  for (let i = 0; i < n; i++) { cols.push(v); v = A.map((r) => r.reduce((s, x, j) => s + x * v[j], 0)); }
  const M = transpose(cols);
  return { M, rank: rank(M) };
}
export function obsv(A, Cm) {
  const n = A.length;
  const rows = [];
  let v = Cm[0].slice();
  for (let i = 0; i < n; i++) { rows.push(v); v = v.map((_, j) => v.reduce((s, x, k) => s + x * A[k][j], 0)); }
  return { M: rows, rank: rank(rows) };
}

/** Ackermann 극점 배치 (단일 입력): K = [0 … 0 1] 𝒞⁻¹ φ(A) */
export function place(A, B, polesWanted) {
  const n = A.length;
  const coeff = polyFromRoots(polesWanted); // [1, a1, …, an]
  let phi = mzeros(n, n);
  let Ak = eye(n);
  for (let i = coeff.length - 1; i >= 0; i--) { phi = matadd(phi, matscale(Ak, coeff[i])); Ak = matmul(Ak, A); }
  const { M } = ctrb(A, B);
  const en = new Array(n).fill(0); en[n - 1] = 1;
  const row = solve(transpose(M), en); // eₙᵀ 𝒞⁻¹ = (𝒞⁻ᵀ eₙ)ᵀ
  const K = row.map((_, j) => row.reduce((s, x, i) => s + x * phi[i][j], 0));
  return [K];
}

const asMat = (R) => (Array.isArray(R) ? (Array.isArray(R[0]) ? R : [R]) : [[R]]);

/**
 * 연속 LQR: AᵀP + PA − PBR⁻¹BᵀP + Q = 0
 * 해밀토니안 H = [[A, −BR⁻¹Bᵀ], [−Q, −Aᵀ]] 의 안정 고유공간을 행렬 부호함수 반복으로 분리하고
 * (sign(H) = −I 인 부분공간이 [I; P]), 뉴턴–클라이만 2회로 다듬는다.
 */
export function lqr(A, B, Q, R) {
  const n = A.length;
  const Rm = asMat(R);
  const Ri = inv(Rm);
  const G = matmul(matmul(B, Ri), transpose(B));
  const H = block([[A, matscale(G, -1)], [matscale(Q, -1), matscale(transpose(A), -1)]]);
  let Z = H;
  for (let it = 0; it < 100; it++) {
    const Zi = inv(Z);
    const dd = Math.abs(detSafe(Z));
    const c = dd > 0 ? dd ** (1 / (2 * n)) : 1;
    const Zn = matscale(matadd(matscale(Z, 1 / c), matscale(Zi, c)), 0.5);
    const diff = normFro(matsub(Zn, Z)) / Math.max(1, normFro(Z));
    Z = Zn;
    if (diff < 1e-13) break;
  }
  const W11 = Z.slice(0, n).map((r) => r.slice(0, n)), W12 = Z.slice(0, n).map((r) => r.slice(n));
  const W21 = Z.slice(n).map((r) => r.slice(0, n)), W22 = Z.slice(n).map((r) => r.slice(n));
  const M = [...W12, ...matadd(W22, eye(n))];
  const rhs = matscale([...matadd(W11, eye(n)), ...W21], -1);
  const Mt = transpose(M);
  let P = symmetrize(solve(matmul(Mt, M), matmul(Mt, rhs)));
  // 뉴턴–클라이만 보정
  for (let k = 0; k < 3; k++) {
    const K = matmul(matmul(Ri, transpose(B)), P);
    const Acl = matsub(A, matmul(B, K));
    const Pn = symmetrize(lyap(Acl, matadd(Q, matmul(matmul(transpose(K), Rm), K))));
    if (normFro(matsub(Pn, P)) < 1e-14 * Math.max(1, normFro(P))) { P = Pn; break; }
    P = Pn;
  }
  const K = matmul(matmul(Ri, transpose(B)), P);
  return { K, P, poles: eig(matsub(A, matmul(B, K))) };
}

function detSafe(M) {
  // 로그 스케일 없이 작은 행렬 행렬식
  const n = M.length;
  const A = M.map((r) => r.slice());
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (A[p][c] === 0) return 0;
    if (p !== c) { const t = A[p]; A[p] = A[c]; A[c] = t; d = -d; }
    d *= A[c][c];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let j = c; j < n; j++) A[r][j] -= f * A[c][j]; }
  }
  return d;
}

/**
 * 이산 LQR: P = Q + AᵀPA − AᵀPB(R + BᵀPB)⁻¹BᵀPA 를 수렴할 때까지 반복
 * K = (R + BᵀPB)⁻¹BᵀPA,  u_k = −K x_k
 */
export function dlqr(Ad, Bd, Q, R, opts = {}) {
  const Rm = asMat(R);
  const At = transpose(Ad), Bt = transpose(Bd);
  let P = Q.map((r) => r.slice());
  const maxIt = opts.max_iter ?? 100000;
  let it = 0;
  for (; it < maxIt; it++) {
    const PB = matmul(P, Bd);
    const S = matadd(Rm, matmul(Bt, PB));
    const K = solve(S, matmul(transpose(PB), Ad));
    const Pn = symmetrize(matadd(Q, matsub(matmul(matmul(At, P), Ad), matmul(matmul(At, PB), K))));
    const d = normFro(matsub(Pn, P));
    P = Pn;
    if (d < 1e-12 * Math.max(1, normFro(P))) break;
  }
  const S = matadd(Rm, matmul(matmul(Bt, P), Bd));
  const K = solve(S, matmul(matmul(Bt, P), Ad));
  return { K, P, poles: eig(matsub(Ad, matmul(Bd, K))), iterations: it };
}

export { servoTF };
