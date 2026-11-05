// linalg.js — 작은 행렬·다항식·복소수 도구 (순수 함수, 외부 라이브러리 없음)
//
// 행렬: number[][] (행 우선). 벡터: number[]. 복소수: { re, im }.
// 다항식: 계수 배열, s의 내림차순 (예: s^2 + 2s + 3 → [1, 2, 3]).
// 크기는 볼앤빔 규모(최대 8×8 정도)를 가정한다. 큰 행렬용으로 최적화하지 않았다.

// ---------------------------------------------------------------- 복소수
export const C = {
  make: (re, im = 0) => ({ re, im }),
  add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
  sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
  mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
  div: (a, b) => {
    const d = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  },
  abs: (a) => Math.hypot(a.re, a.im),
  arg: (a) => Math.atan2(a.im, a.re),
  scale: (a, k) => ({ re: a.re * k, im: a.im * k }),
  exp: (a) => { const m = Math.exp(a.re); return { re: m * Math.cos(a.im), im: m * Math.sin(a.im) }; },
};

// ---------------------------------------------------------------- 다항식
/** 앞쪽(최고차) 0 계수 제거. 모두 0이면 [0]. */
export function polyTrim(p) {
  let i = 0;
  while (i < p.length - 1 && p[i] === 0) i++;
  return p.slice(i);
}
export function polyMul(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
  return r;
}
export function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const r = new Array(n).fill(0);
  for (let i = 0; i < a.length; i++) r[n - a.length + i] += a[i];
  for (let i = 0; i < b.length; i++) r[n - b.length + i] += b[i];
  return r;
}
export function polyScale(a, k) { return a.map((x) => x * k); }
export function polyDer(a) {
  const n = a.length - 1;
  if (n <= 0) return [0];
  return a.slice(0, n).map((c, i) => c * (n - i));
}
/** 실수 s에서 다항식 값 (Horner) */
export function polyval(p, x) { let y = 0; for (const c of p) y = y * x + c; return y; }
/** 복소수 s에서 다항식 값 */
export function polyvalC(p, s) {
  let re = 0, im = 0;
  for (const c of p) { const r = re * s.re - im * s.im + c; im = re * s.im + im * s.re; re = r; }
  return { re, im };
}
/** 근으로부터 실계수 다항식(모닉). 켤레쌍이 아니면 허수부는 버린다. */
export function polyFromRoots(roots) {
  let re = [1], im = [0];
  for (const r of roots) {
    const nre = new Array(re.length + 1).fill(0), nim = new Array(re.length + 1).fill(0);
    for (let i = 0; i < re.length; i++) {
      nre[i] += re[i]; nim[i] += im[i];
      // −r · (re + j im)
      nre[i + 1] -= r.re * re[i] - r.im * im[i];
      nim[i + 1] -= r.re * im[i] + r.im * re[i];
    }
    re = nre; im = nim;
  }
  return re;
}

/**
 * 다항식의 근. 컴패니언 행렬의 고유값(균형화 + Hessenberg QR)으로 구하고
 * 뉴턴 보정을 한두 번 한다. 끝쪽 0 계수는 정확한 원점 근으로 처리한다.
 */
export function roots(p) {
  let q = polyTrim(p.map(Number));
  if (q.some((x) => !Number.isFinite(x))) throw new Error('roots: 계수가 유한한 수가 아님');
  const out = [];
  while (q.length > 1 && q[q.length - 1] === 0) { out.push({ re: 0, im: 0 }); q = q.slice(0, -1); }
  const n = q.length - 1;
  if (n <= 0) return out;
  if (n === 1) { out.push({ re: -q[1] / q[0], im: 0 }); return out; }
  if (n === 2) {
    const a = q[0], b = q[1], c = q[2];
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t = -0.5 * (b + (b >= 0 ? sq : -sq));
      const r1 = t / a, r2 = t !== 0 ? c / t : -b / a - r1;
      out.push({ re: r1, im: 0 }, { re: r2, im: 0 });
    } else {
      const re = -b / (2 * a), im = Math.sqrt(-disc) / (2 * Math.abs(a));
      out.push({ re, im }, { re, im: -im });
    }
    return out;
  }
  // 컴패니언 행렬
  const A = zeros(n, n);
  for (let j = 0; j < n; j++) A[0][j] = -q[j + 1] / q[0];
  for (let i = 1; i < n; i++) A[i][i - 1] = 1;
  const ev = eig(A);
  const dp = polyDer(q);
  for (const r of ev) {
    let z = r;
    for (let it = 0; it < 3; it++) {
      const f = polyvalC(q, z), d = polyvalC(dp, z);
      if (C.abs(d) === 0) break;
      const zn = C.sub(z, C.div(f, d));
      if (C.abs(polyvalC(q, zn)) < C.abs(f)) z = zn; else break;
    }
    if (Math.abs(z.im) < 1e-12 * Math.max(1, Math.abs(z.re))) z = { re: z.re, im: 0 };
    out.push(z);
  }
  return out;
}

// ---------------------------------------------------------------- 행렬 기본
export function zeros(n, m) { return Array.from({ length: n }, () => new Array(m).fill(0)); }
export function eye(n) { const I = zeros(n, n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; }
export function clone(A) { return A.map((r) => r.slice()); }
export function transpose(A) { return A[0].map((_, j) => A.map((r) => r[j])); }
export function matmul(A, B) {
  const n = A.length, m = B[0].length, k = B.length;
  const R = zeros(n, m);
  for (let i = 0; i < n; i++) for (let l = 0; l < k; l++) {
    const a = A[i][l]; if (a === 0) continue;
    for (let j = 0; j < m; j++) R[i][j] += a * B[l][j];
  }
  return R;
}
export function matadd(A, B) { return A.map((r, i) => r.map((x, j) => x + B[i][j])); }
export function matsub(A, B) { return A.map((r, i) => r.map((x, j) => x - B[i][j])); }
export function matscale(A, k) { return A.map((r) => r.map((x) => x * k)); }
export function matvec(A, v) { return A.map((r) => r.reduce((s, x, j) => s + x * v[j], 0)); }
export function normInf(A) { return Math.max(...A.map((r) => r.reduce((s, x) => s + Math.abs(x), 0))); }
export function normFro(A) { return Math.sqrt(A.reduce((s, r) => s + r.reduce((t, x) => t + x * x, 0), 0)); }
export function diag(v) { const D = zeros(v.length, v.length); v.forEach((x, i) => { D[i][i] = x; }); return D; }
/** 블록 행렬 [[A, B], [C, D]] 조립 (블록은 number[][]) */
export function block(rows) {
  const out = [];
  for (const br of rows) {
    const h = br[0].length;
    for (let i = 0; i < h; i++) out.push([].concat(...br.map((b) => b[i])));
  }
  return out;
}

/** 부분 피벗 가우스 소거로 A X = B (B: 행렬 또는 벡터) */
export function solve(A, B) {
  const n = A.length;
  const isVec = !Array.isArray(B[0]);
  const M = A.map((r, i) => r.concat(isVec ? [B[i]] : B[i]));
  const m = M[0].length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) throw new Error('solve: 특이 행렬');
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let j = c; j < m; j++) M[r][j] -= f * M[c][j];
    }
  }
  const X = M.map((r, i) => r.slice(n).map((x) => x / M[i][i]));
  return isVec ? X.map((r) => r[0]) : X;
}
export function inv(A) { return solve(A, eye(A.length)); }
export function det(A) {
  const n = A.length, M = clone(A);
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return 0;
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let j = c; j < n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return d;
}
/** 수치 계수(rank): 가우스 소거 후 상대 허용오차 */
export function rank(A, tol = 1e-9) {
  const M = clone(A), n = M.length, m = M[0].length;
  const scale = Math.max(1e-300, ...M.flat().map(Math.abs));
  let r = 0;
  for (let c = 0; c < m && r < n; c++) {
    let p = r;
    for (let i = r + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) <= tol * scale) continue;
    const t = M[p]; M[p] = M[r]; M[r] = t;
    for (let i = r + 1; i < n; i++) {
      const f = M[i][c] / M[r][c];
      for (let j = c; j < m; j++) M[i][j] -= f * M[r][j];
    }
    r++;
  }
  return r;
}

// ---------------------------------------------------------------- 고유값
// 균형화(balanc) → Hessenberg 축약(elmhes) → 이동 QR(hqr).
// Numerical Recipes 2판의 알고리즘을 1-기반 인덱스 그대로 옮겼다.
function sign(a, b) { return b >= 0 ? Math.abs(a) : -Math.abs(a); }

function balanc(a, n) {
  const RADIX = 2, sqrdx = RADIX * RADIX;
  let last = 0;
  while (last === 0) {
    last = 1;
    for (let i = 1; i <= n; i++) {
      let r = 0, c = 0;
      for (let j = 1; j <= n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
      if (c !== 0 && r !== 0) {
        let g = r / RADIX, f = 1;
        const s = c + r;
        while (c < g) { f *= RADIX; c *= sqrdx; }
        g = r * RADIX;
        while (c > g) { f /= RADIX; c /= sqrdx; }
        if ((c + r) / f < 0.95 * s) {
          last = 0;
          g = 1 / f;
          for (let j = 1; j <= n; j++) a[i][j] *= g;
          for (let j = 1; j <= n; j++) a[j][i] *= f;
        }
      }
    }
  }
}

function elmhes(a, n) {
  for (let m = 2; m < n; m++) {
    let x = 0, i = m;
    for (let j = m; j <= n; j++) if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
    if (i !== m) {
      for (let j = m - 1; j <= n; j++) { const t = a[i][j]; a[i][j] = a[m][j]; a[m][j] = t; }
      for (let j = 1; j <= n; j++) { const t = a[j][i]; a[j][i] = a[j][m]; a[j][m] = t; }
    }
    if (x !== 0) {
      for (i = m + 1; i <= n; i++) {
        let y = a[i][m - 1];
        if (y !== 0) {
          y /= x;
          a[i][m - 1] = y;
          for (let j = m; j <= n; j++) a[i][j] -= y * a[m][j];
          for (let j = 1; j <= n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
  }
  for (let i = 3; i <= n; i++) for (let j = 1; j <= i - 2; j++) a[i][j] = 0;
}

function hqr(a, n) {
  const wr = new Array(n + 1).fill(0), wi = new Array(n + 1).fill(0);
  let anorm = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j]);
  let nn = n, t = 0;
  let l, m, x, y, z, w, v, u, s, r, q, p;
  while (nn >= 1) {
    let its = 0;
    do {
      for (l = nn; l >= 2; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) + s === s) { a[l][l - 1] = 0; break; }
      }
      x = a[nn][nn];
      if (l === nn) {
        wr[nn] = x + t; wi[nn] = 0; nn--;
      } else {
        y = a[nn - 1][nn - 1];
        w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x);
          q = p * p + w;
          z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + sign(z, p);
            wr[nn - 1] = wr[nn] = x + z;
            if (z !== 0) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) throw new Error('eig: QR 반복이 수렴하지 않음');
          if (its % 10 === 0 && its > 0) {
            t += x;
            for (let i = 1; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s;
            r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s; q /= s; r /= s;
            if (m === l) break;
            u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; }
            }
            if ((s = sign(Math.sqrt(p * p + q * q + r * r), p)) !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1];
              } else {
                a[k][k - 1] = -s * x;
              }
              p += s;
              x = p / s; y = q / s; z = r / s; q /= p; r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; }
                a[k + 1][j] -= p * y;
                a[k][j] -= p * x;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k !== nn - 1) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ re: wr[i], im: wi[i] });
  return out;
}

/** 실수 정방행렬의 고유값 (Complex[]) */
export function eig(A) {
  const n = A.length;
  if (n === 0) return [];
  if (n === 1) return [{ re: A[0][0], im: 0 }];
  const a = zeros(n + 1, n + 1);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) a[i + 1][j + 1] = A[i][j];
  balanc(a, n);
  elmhes(a, n);
  const ev = hqr(a, n);
  // 정렬: 실수부 내림차순, 같으면 허수부 내림차순 (재현성)
  ev.sort((p, q) => (q.re - p.re) || (q.im - p.im));
  return ev;
}

/** 특성다항식 det(sI − A), 고유값으로부터 (내림차순) */
export function charpoly(A) { return polyFromRoots(eig(A)); }

// ---------------------------------------------------------------- 행렬 함수
/** 행렬 지수 e^A — 스케일링·제곱 + Padé(6) */
export function expm(A) {
  const n = A.length;
  const nrm = normInf(A);
  const s = nrm > 0 ? Math.max(0, Math.floor(Math.log2(nrm)) + 2) : 0;
  const As = matscale(A, 1 / 2 ** s);
  const q = 6;
  let c = 0.5;
  let X = clone(As);
  let N = matadd(eye(n), matscale(As, c));
  let D = matsub(eye(n), matscale(As, c));
  let positive = true;
  for (let k = 2; k <= q; k++) {
    c = (c * (q - k + 1)) / (k * (2 * q - k + 1));
    X = matmul(As, X);
    const cX = matscale(X, c);
    N = matadd(N, cX);
    D = positive ? matadd(D, cX) : matsub(D, cX);
    positive = !positive;
  }
  let E = solve(D, N);
  for (let k = 0; k < s; k++) E = matmul(E, E);
  return E;
}

/** 연속 리아푸노프 방정식 Aᵀ X + X A + M = 0 (크로네커 전개, 작은 n 전용) */
export function lyap(A, M) {
  const n = A.length, N = n * n;
  const K = zeros(N, N);
  // vec 열 우선: idx(i,j) = j*n + i
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const row = j * n + i;
    // (AᵀX)_{ij} = Σ_k A[k][i] X[k][j]
    for (let k = 0; k < n; k++) K[row][j * n + k] += A[k][i];
    // (XA)_{ij} = Σ_k X[i][k] A[k][j]
    for (let k = 0; k < n; k++) K[row][k * n + i] += A[k][j];
  }
  const rhs = new Array(N);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) rhs[j * n + i] = -M[i][j];
  const x = solve(K, rhs);
  const X = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) X[i][j] = x[j * n + i];
  return X;
}

/** 대칭화 (P + Pᵀ)/2 */
export function symmetrize(P) { return P.map((r, i) => r.map((x, j) => 0.5 * (x + P[j][i]))); }

// ---------------------------------------------------------------- 결정론적 난수 (시뮬레이션 잡음용)
/** mulberry32 — seed가 같으면 같은 수열 */
export function rng(seed = 1) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = uniform();
    v = uniform();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { uniform, normal };
}
