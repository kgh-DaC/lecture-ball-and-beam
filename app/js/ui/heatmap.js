// 2차원 칸 그림(히트맵). Q 표·정책 지도용. 외부 라이브러리 없음.
// - 색: 발산형(음 = 주황, 0 = 바탕, 양 = 파랑; Okabe–Ito 끝색) 또는 순차형(바탕 → 파랑). 값 범례 막대 포함.
// - x 경계/중심, y 경계/중심을 받아 불균일 칸도 그린다. 커서 위치 값 툴팁. 겹침 선(lines)으로 PD 직선 등을 그린다.

const POS = [0, 114, 178], NEG = [213, 94, 0];

function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function parseHex(c) { const m = /^#?([0-9a-f]{6})$/i.exec(String(c).trim()); if (!m) return [255, 255, 255]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

/** 칸 경계 배열(중심만 있으면 중간점으로) */
export function edgesFromCenters(c) {
  if (c.length === 1) return [c[0] - 0.5, c[0] + 0.5];
  const e = [c[0] - (c[1] - c[0]) / 2];
  for (let i = 1; i < c.length; i++) e.push((c[i - 1] + c[i]) / 2);
  e.push(c[c.length - 1] + (c[c.length - 1] - c[c.length - 2]) / 2);
  return e;
}

export class Heatmap {
  /** opts: { height=240, xLabel, yLabel, unit, diverging=true, title, fmt(v) } */
  constructor(container, opts = {}) {
    this.opts = { height: 240, diverging: true, fmt: (v) => (v == null || !Number.isFinite(v) ? '–' : Number(v.toPrecision(3)).toString()), ...opts };
    this.wrap = document.createElement('div');
    this.wrap.className = 'plot';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', opts.title || opts.unit || '칸 그림');
    this.canvas.style.height = this.opts.height + 'px';
    this.tip = document.createElement('div');
    this.tip.className = 'plot-tip';
    this.wrap.append(this.canvas, this.tip);
    container.appendChild(this.wrap);
    this.data = null;
    this.canvas.addEventListener('pointermove', (e) => this._hover(e));
    this.canvas.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; });
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.draw()) : null;
    if (this.ro) this.ro.observe(this.wrap);
  }

  /**
   * d: { xEdges, yEdges, z[i_y][i_x] (null = 빈 칸), range?: [lo, hi], lines?: [{ x:[], y:[], color, dash, label }], points?: [{x,y,color}] }
   */
  set(d) {
    this.data = d;
    this.canvas.setAttribute('aria-label', `${this.opts.title || ''} ${d.z.length}×${(d.z[0] || []).length} 칸`);
    this.draw();
  }

  destroy() { if (this.ro) this.ro.disconnect(); this.wrap.remove(); }

  draw() {
    if (this.raf) return;
    const r = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
    this.raf = r(() => { this.raf = null; this._render(); });
  }

  _range() {
    const d = this.data;
    if (d.range) return d.range;
    let lo = Infinity, hi = -Infinity;
    for (const row of d.z) for (const v of row) if (v != null && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) return [0, 1];
    if (this.opts.diverging) { const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-a, a]; }
    return lo === hi ? [lo, lo + 1] : [lo, hi];
  }

  color(v, bg) {
    if (v == null || !Number.isFinite(v)) return null;
    const [lo, hi] = this._range();
    if (this.opts.diverging) {
      const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
      const t = Math.max(-1, Math.min(1, v / a));
      const c = t >= 0 ? mix(bg, POS, t) : mix(bg, NEG, -t);
      return `rgb(${c.join(',')})`;
    }
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
    return `rgb(${mix(bg, POS, Math.sqrt(t)).join(',')})`;
  }

  _render() {
    const d = this.data;
    const c = this.canvas;
    const g = c.getContext && c.getContext('2d');
    if (!g || !d) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const W = c.clientWidth || 500, H = this.opts.height;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(this.wrap) : null;
    const v = (k, dflt) => (css && css.getPropertyValue(k).trim()) || dflt;
    const ink = v('--ink', '#1d232a'), muted = v('--muted', '#5d6670'), bgHex = v('--plot-bg', '#ffffff');
    const bg = parseHex(bgHex.startsWith('#') ? bgHex : '#ffffff');
    g.fillStyle = bgHex; g.fillRect(0, 0, W, H);
    const m = { l: 56, r: 64, t: this.opts.title ? 22 : 10, b: 36 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xe = d.xEdges, ye = d.yEdges;
    const x0 = xe[0], x1 = xe[xe.length - 1], y0 = ye[0], y1 = ye[ye.length - 1];
    const tx = (x) => m.l + ((x - x0) / (x1 - x0)) * pw;
    const ty = (y) => m.t + (1 - (y - y0) / (y1 - y0)) * ph;
    this.map = { tx, ty, m, pw, ph, x0, x1, y0, y1 };
    // 칸
    for (let iy = 0; iy < d.z.length; iy++) {
      for (let ix = 0; ix < d.z[iy].length; ix++) {
        const col = this.color(d.z[iy][ix], bg);
        const X0 = tx(xe[ix]), X1 = tx(xe[ix + 1]), Y0 = ty(ye[iy + 1]), Y1 = ty(ye[iy]);
        if (col) { g.fillStyle = col; g.fillRect(X0, Y0, X1 - X0 + 0.5, Y1 - Y0 + 0.5); }
        else { g.fillStyle = muted; g.globalAlpha = 0.12; g.fillRect(X0, Y0, X1 - X0, Y1 - Y0); g.globalAlpha = 1; }
      }
    }
    // 축
    g.strokeStyle = muted; g.lineWidth = 1; g.strokeRect(m.l, m.t, pw, ph);
    g.font = '11px system-ui, sans-serif'; g.fillStyle = muted;
    const ticks = (a, b, n) => {
      const raw = (b - a) / n, p = 10 ** Math.floor(Math.log10(raw)), mm = raw / p;
      const st = (mm < 1.5 ? 1 : mm < 3 ? 2 : mm < 7 ? 5 : 10) * p;
      const out = [];
      for (let v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
      return out;
    };
    const f = (x) => Number(x.toPrecision(3)).toString();
    const sx = d.xScale || 1, sy = d.yScale || 1;
    g.textAlign = 'center';
    for (const t of ticks(x0, x1, 4)) g.fillText(f(t * sx), tx(t), m.t + ph + 13);
    g.textAlign = 'right';
    for (const t of ticks(y0, y1, 4)) g.fillText(f(t * sy), m.l - 4, ty(t) + 4);
    g.fillStyle = ink; g.textAlign = 'center';
    if (this.opts.xLabel) g.fillText(this.opts.xLabel, m.l + pw / 2, H - 4);
    if (this.opts.title) { g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(this.opts.title, m.l, 14); g.font = '11px system-ui, sans-serif'; }
    if (this.opts.yLabel) { g.save(); g.translate(12, m.t + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(this.opts.yLabel, 0, 0); g.restore(); }
    // 겹침 선
    g.save(); g.beginPath(); g.rect(m.l, m.t, pw, ph); g.clip();
    for (const ln of d.lines || []) {
      g.strokeStyle = ln.color || ink; g.lineWidth = ln.width || 2; g.setLineDash(ln.dash || []);
      g.beginPath();
      ln.x.forEach((x, i) => (i ? g.lineTo(tx(x), ty(ln.y[i])) : g.moveTo(tx(x), ty(ln.y[i]))));
      g.stroke();
    }
    g.setLineDash([]);
    for (const p of d.points || []) { g.fillStyle = p.color || ink; g.beginPath(); g.arc(tx(p.x), ty(p.y), p.r || 2, 0, 2 * Math.PI); g.fill(); }
    g.restore();
    // 범례 막대
    const [lo, hi] = this._range();
    const bx = m.l + pw + 14, bw = 12;
    for (let i = 0; i < ph; i++) {
      const val = hi - ((hi - lo) * i) / ph;
      g.fillStyle = this.color(val, bg) || bgHex; g.fillRect(bx, m.t + i, bw, 1.5);
    }
    g.strokeStyle = muted; g.strokeRect(bx, m.t, bw, ph);
    g.fillStyle = muted; g.textAlign = 'left';
    const vs = d.valueScale || 1;
    g.fillText(this.opts.fmt(hi * vs), bx + bw + 3, m.t + 9);
    g.fillText(this.opts.fmt(lo * vs), bx + bw + 3, m.t + ph);
    if (this.opts.unit) { g.textAlign = 'center'; g.fillText(this.opts.unit, bx + bw / 2, m.t + ph + 13); }
    // 범례 문자(선)
    let ly = m.t + 14;
    g.textAlign = 'left';
    for (const ln of d.lines || []) {
      if (!ln.label) continue;
      g.fillStyle = ln.color || ink; g.fillText(`— ${ln.label}`, m.l + 6, ly); ly += 13;
    }
  }

  _hover(e) {
    const mp = this.map, d = this.data;
    if (!mp || !d) return;
    const r = this.canvas.getBoundingClientRect();
    const X = e.clientX - r.left, Y = e.clientY - r.top;
    const x = mp.x0 + ((X - mp.m.l) / mp.pw) * (mp.x1 - mp.x0);
    const y = mp.y0 + (1 - (Y - mp.m.t) / mp.ph) * (mp.y1 - mp.y0);
    const ix = d.xEdges.findIndex((xe, i) => i < d.xEdges.length - 1 && x >= xe && x < d.xEdges[i + 1]);
    const iy = d.yEdges.findIndex((ye, i) => i < d.yEdges.length - 1 && y >= ye && y < d.yEdges[i + 1]);
    if (ix < 0 || iy < 0) { this.tip.style.display = 'none'; return; }
    const val = d.z[iy][ix];
    const extra = d.tip ? d.tip(iy, ix) : '';
    const sx = d.xScale || 1, sy = d.yScale || 1, vs = d.valueScale || 1;
    this.tip.textContent = `${this.opts.xLabel || 'x'} ${Number((x * sx).toPrecision(3))}, ${this.opts.yLabel || 'y'} ${Number((y * sy).toPrecision(3))} → ${val == null ? '빈 칸' : this.opts.fmt(val * vs)} ${this.opts.unit || ''}${extra ? ` · ${extra}` : ''}`;
    this.tip.style.display = 'block';
    this.tip.style.left = `${Math.min(X + 12, (this.canvas.clientWidth || 500) - 200)}px`;
    this.tip.style.top = `${Y + 12}px`;
  }
}
