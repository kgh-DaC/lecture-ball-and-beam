// 캔버스 그래프(외부 라이브러리 없음). 시계열과 XY(근궤적·나이키스트) 모두 그린다.
// - 하나의 y축만 쓴다(이중 축 금지). 단위가 다른 신호는 패널을 나눈다.
// - 색맹 친화 팔레트(Okabe–Ito 계열, validate_palette 통과) + 선 스타일로 이중 부호화.
// - 마우스: 커서 값 읽기(십자선+툴팁), 휠 확대(x), 더블클릭 원래대로, 일시정지는 호출자가 setSeries를 멈춘다.

export const COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#444444'];
export const DASHES = [[], [6, 4], [2, 3], [8, 3, 2, 3], [1, 2], [10, 5], [4, 4]];
export function styleOf(i) { return { color: COLORS[i % COLORS.length], dash: DASHES[i % DASHES.length] }; }

function niceStep(range, n = 5) {
  if (!(range > 0)) return 1;
  const raw = range / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function fmtTick(v, step) {
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(Math.min(d, 6));
}

export class Plot {
  /**
   * opts: { height=220, xLabel, yLabel, xRange, yRange, equalAspect, legend=true, logX=false, title, minYSpan }
   */
  constructor(container, opts = {}) {
    this.opts = { height: 220, legend: true, ...opts };
    this.wrap = document.createElement('div');
    this.wrap.className = 'plot';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', opts.title || opts.yLabel || '그래프');
    this.canvas.style.height = this.opts.height + 'px';
    this.tip = document.createElement('div');
    this.tip.className = 'plot-tip';
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'plot-legend';
    this.wrap.append(this.canvas, this.tip, this.legendEl);
    container.appendChild(this.wrap);
    this.series = [];
    this.ann = [];
    this.view = null; // 사용자 확대 x 범위
    this.hover = null;
    this.dirty = true;
    this.onPointer = null;
    this._bind();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.wrap);
  }

  destroy() { this.ro.disconnect(); cancelAnimationFrame(this.raf); this.wrap.remove(); }

  setSeries(series) { this.series = series; this.draw(); }
  setAnnotations(ann) { this.ann = ann || []; this.draw(); }
  setOpts(o) { Object.assign(this.opts, o); this.draw(); }

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this._render(); });
  }

  _bounds() {
    const o = this.opts;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const s of this.series) {
      if (s.hidden) continue;
      const n = s.y.length;
      for (let i = 0; i < n; i++) {
        const x = s.x[i], y = s.y[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (!o.yFromView || !this.view || (x >= this.view[0] && x <= this.view[1])) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
      }
    }
    for (const a of this.ann) {
      if (a.type === 'hline' && Number.isFinite(a.y) && !a.noScale) { ymin = Math.min(ymin, a.y); ymax = Math.max(ymax, a.y); }
    }
    if (o.xRange) [xmin, xmax] = o.xRange;
    if (this.view) [xmin, xmax] = this.view;
    if (o.yRange) [ymin, ymax] = o.yRange;
    if (!Number.isFinite(xmin)) { xmin = 0; xmax = 1; }
    if (!Number.isFinite(ymin)) { ymin = 0; ymax = 1; }
    if (xmax === xmin) { xmax += 0.5; xmin -= 0.5; }
    const minSpan = o.minYSpan || 0;
    if (ymax - ymin < minSpan) { const c = (ymax + ymin) / 2; ymin = c - minSpan / 2; ymax = c + minSpan / 2; }
    if (ymax === ymin) { ymax += 1; ymin -= 1; }
    if (!o.yRange) { const pad = (ymax - ymin) * 0.06; ymin -= pad; ymax += pad; }
    return { xmin, xmax, ymin, ymax };
  }

  _render() {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth || 600, H = this.opts.height;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.wrap);
    const ink = css.getPropertyValue('--ink').trim() || '#222';
    const muted = css.getPropertyValue('--muted').trim() || '#777';
    const gridC = css.getPropertyValue('--grid').trim() || '#e6e6e6';
    const bg = css.getPropertyValue('--plot-bg').trim() || '#fff';
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const m = { l: 56, r: 12, t: this.opts.title ? 22 : 10, b: 34 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    let { xmin, xmax, ymin, ymax } = this._bounds();
    if (this.opts.equalAspect) {
      const sx = (xmax - xmin) / pw, sy = (ymax - ymin) / ph;
      if (sx > sy) { const c0 = (ymax + ymin) / 2, half = sx * ph / 2; ymin = c0 - half; ymax = c0 + half; }
      else { const c0 = (xmax + xmin) / 2, half = sy * pw / 2; xmin = c0 - half; xmax = c0 + half; }
    }
    const logX = this.opts.logX;
    const tx = logX ? (x) => m.l + (Math.log10(x) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin)) * pw : (x) => m.l + (x - xmin) / (xmax - xmin) * pw;
    const ty = (y) => m.t + (1 - (y - ymin) / (ymax - ymin)) * ph;
    this.map = { tx, ty, m, pw, ph, xmin, xmax, ymin, ymax, logX };
    // 격자·눈금
    g.font = '11px system-ui, sans-serif';
    g.lineWidth = 1;
    g.strokeStyle = gridC; g.fillStyle = muted;
    if (logX) {
      for (let e = Math.floor(Math.log10(xmin)); e <= Math.ceil(Math.log10(xmax)); e++) {
        const v = 10 ** e; if (v < xmin || v > xmax) continue;
        const X = tx(v); g.beginPath(); g.moveTo(X, m.t); g.lineTo(X, m.t + ph); g.stroke();
        g.textAlign = 'center'; g.fillText(String(v), X, m.t + ph + 14);
      }
    } else {
      const xs = niceStep(xmax - xmin, Math.max(2, Math.floor(pw / 80)));
      for (let v = Math.ceil(xmin / xs) * xs; v <= xmax + 1e-12; v += xs) {
        const X = tx(v); g.beginPath(); g.moveTo(X, m.t); g.lineTo(X, m.t + ph); g.stroke();
        g.textAlign = 'center'; g.fillText(fmtTick(v, xs), X, m.t + ph + 14);
      }
    }
    const ys = niceStep(ymax - ymin, Math.max(2, Math.floor(ph / 40)));
    for (let v = Math.ceil(ymin / ys) * ys; v <= ymax + 1e-12; v += ys) {
      const Y = ty(v); g.beginPath(); g.moveTo(m.l, Y); g.lineTo(m.l + pw, Y); g.stroke();
      g.textAlign = 'right'; g.fillText(fmtTick(v, ys), m.l - 5, Y + 4);
    }
    g.strokeStyle = muted; g.strokeRect(m.l + 0.5, m.t + 0.5, pw, ph);
    g.fillStyle = ink;
    if (this.opts.xLabel) { g.textAlign = 'center'; g.fillText(this.opts.xLabel, m.l + pw / 2, H - 4); }
    if (this.opts.yLabel) { g.save(); g.translate(12, m.t + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(this.opts.yLabel, 0, 0); g.restore(); }
    if (this.opts.title) { g.textAlign = 'left'; g.font = '600 12px system-ui, sans-serif'; g.fillText(this.opts.title, m.l, 14); g.font = '11px system-ui, sans-serif'; }
    g.save();
    g.beginPath(); g.rect(m.l, m.t, pw, ph); g.clip();
    // 주석(영역 먼저)
    for (const a of this.ann) {
      g.setLineDash(a.dash || [4, 4]); g.strokeStyle = a.color || muted; g.fillStyle = a.fill || 'rgba(0,114,178,0.08)'; g.lineWidth = a.width || 1;
      if (a.type === 'rect') { const x0 = Math.max(tx(a.x0 ?? xmin), m.l), x1 = Math.min(tx(a.x1 ?? xmax), m.l + pw); const y0 = ty(a.y1 ?? ymax), y1 = ty(a.y0 ?? ymin); g.fillRect(x0, y0, x1 - x0, y1 - y0); }
      else if (a.type === 'poly') { g.beginPath(); a.pts.forEach(([x, y], i) => (i ? g.lineTo(tx(x), ty(y)) : g.moveTo(tx(x), ty(y)))); g.closePath(); g.fill(); }
      else if (a.type === 'hline') { const Y = ty(a.y); g.beginPath(); g.moveTo(m.l, Y); g.lineTo(m.l + pw, Y); g.stroke(); if (a.label) { g.fillStyle = muted; g.textAlign = 'right'; g.fillText(a.label, m.l + pw - 4, Y - 3); } }
      else if (a.type === 'vline') { const X = tx(a.x); g.beginPath(); g.moveTo(X, m.t); g.lineTo(X, m.t + ph); g.stroke(); if (a.label) { g.fillStyle = muted; g.textAlign = 'left'; g.fillText(a.label, X + 3, m.t + 12); } }
      else if (a.type === 'text') { g.fillStyle = a.color || ink; g.textAlign = a.align || 'left'; g.fillText(a.text, tx(a.x), ty(a.y)); }
    }
    g.setLineDash([]);
    // 계열
    for (const s of this.series) {
      if (s.hidden) continue;
      g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = s.width || 2; g.globalAlpha = s.alpha ?? 1;
      g.setLineDash(s.dash || []);
      if (!s.pointsOnly) {
        g.beginPath();
        let pen = false;
        for (let i = 0; i < s.y.length; i++) {
          const x = s.x[i], y = s.y[i];
          if (!Number.isFinite(x) || !Number.isFinite(y) || (logX && x <= 0)) { if (!s.connectGaps) pen = false; continue; }
          const X = tx(x), Y = ty(y);
          if (s.step && pen) { g.lineTo(X, g._lastY); }
          if (pen) g.lineTo(X, Y); else { g.moveTo(X, Y); pen = true; }
          g._lastY = Y;
        }
        g.stroke();
      }
      g.setLineDash([]);
      if (s.marker) {
        const idx = s.markerIdx || s.y.map((_, i) => i);
        for (const i of idx) {
          const x = s.x[i], y = s.y[i];
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          drawMarker(g, s.marker, tx(x), ty(y), s.markerSize || 5, bg);
        }
      }
      g.globalAlpha = 1;
    }
    // 십자선
    if (this.hover && this.opts.crosshair !== false) {
      g.strokeStyle = muted; g.setLineDash([3, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(this.hover.X, m.t); g.lineTo(this.hover.X, m.t + ph); g.stroke(); g.setLineDash([]);
    }
    g.restore();
    this._legend();
  }

  _legend() {
    if (!this.opts.legend) { this.legendEl.textContent = ''; return; }
    const key = this.series.filter((s) => s.label && !s.noLegend).map((s) => `${s.label}|${s.color}|${(s.dash || []).join('-')}|${s.hidden ? 1 : 0}`).join(';');
    if (key === this._legendKey) return;
    this._legendKey = key;
    this.legendEl.textContent = '';
    for (const s of this.series) {
      if (!s.label || s.noLegend) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'lg-item' + (s.hidden ? ' off' : '');
      item.title = '눌러서 보이기/숨기기';
      const sw = document.createElement('canvas');
      sw.width = 28; sw.height = 10;
      const sg = sw.getContext('2d');
      sg.strokeStyle = s.color; sg.lineWidth = 2; sg.setLineDash(s.dash || []);
      sg.beginPath(); sg.moveTo(1, 5); sg.lineTo(27, 5); sg.stroke();
      if (s.marker) drawMarker(sg, s.marker, 14, 5, 3.5, '#fff');
      item.append(sw, document.createTextNode(s.label));
      item.addEventListener('click', () => { s.hidden = !s.hidden; this.draw(); });
      this.legendEl.appendChild(item);
    }
  }

  /** 픽셀 → 데이터 */
  toData(X, Y) {
    const mp = this.map; if (!mp) return null;
    const fx = (X - mp.m.l) / mp.pw;
    const x = mp.logX ? 10 ** (Math.log10(mp.xmin) + fx * (Math.log10(mp.xmax) - Math.log10(mp.xmin))) : mp.xmin + fx * (mp.xmax - mp.xmin);
    const y = mp.ymin + (1 - (Y - mp.m.t) / mp.ph) * (mp.ymax - mp.ymin);
    return { x, y };
  }
  toPx(x, y) { const mp = this.map; return mp ? { X: mp.tx(x), Y: mp.ty(y) } : null; }

  _bind() {
    const c = this.canvas;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { X: e.clientX - r.left, Y: e.clientY - r.top }; };
    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      this.hover = p;
      this._tooltip(p);
      this.draw();
      if (this.onPointer) { const d = this.toData(p.X, p.Y); this.onPointer({ type: 'move', ...d, ...p, ev: e }); }
    });
    c.addEventListener('pointerleave', () => { this.hover = null; this.tip.style.display = 'none'; this.draw(); });
    c.addEventListener('pointerdown', (e) => {
      if (!this.onPointer) return;
      const p = pos(e); c.setPointerCapture(e.pointerId);
      this.onPointer({ type: 'down', ...this.toData(p.X, p.Y), ...p, ev: e });
    });
    c.addEventListener('pointerup', (e) => {
      if (!this.onPointer) return;
      const p = pos(e);
      this.onPointer({ type: 'up', ...this.toData(p.X, p.Y), ...p, ev: e });
    });
    c.addEventListener('wheel', (e) => {
      if (this.opts.noZoom || !this.map || this.opts.logX) return;
      e.preventDefault();
      const p = pos(e); const d = this.toData(p.X, p.Y);
      const { xmin, xmax } = this.map;
      const k = e.deltaY > 0 ? 1.25 : 0.8;
      this.view = [d.x - (d.x - xmin) * k, d.x + (xmax - d.x) * k];
      this.draw();
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.view = null; this.draw(); });
  }

  _tooltip(p) {
    const mp = this.map;
    if (!mp || this.opts.tooltip === false || p.X < mp.m.l || p.X > mp.m.l + mp.pw) { this.tip.style.display = 'none'; return; }
    const d = this.toData(p.X, p.Y);
    const lines = [];
    if (this.opts.xy) {
      lines.push(`${this.opts.xLabel || 'x'}: ${d.x.toPrecision(4)}`, `${this.opts.yLabel || 'y'}: ${d.y.toPrecision(4)}`);
    } else {
      lines.push(`${this.opts.xLabel || 'x'} = ${d.x.toPrecision(4)}`);
      for (const s of this.series) {
        if (s.hidden || !s.label || s.noTip) continue;
        // 가장 가까운 x의 값
        let best = -1, bd = Infinity;
        const n = s.x.length;
        // x가 정렬되어 있다고 가정하고 이분 탐색
        let lo = 0, hi = n - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (s.x[mid] < d.x) lo = mid + 1; else hi = mid; }
        for (const i of [lo - 1, lo, lo + 1]) if (i >= 0 && i < n && Number.isFinite(s.y[i])) { const dd = Math.abs(s.x[i] - d.x); if (dd < bd) { bd = dd; best = i; } }
        if (best >= 0) lines.push(`${s.label}: ${Number(s.y[best]).toPrecision(4)}`);
      }
    }
    this.tip.textContent = lines.join('\n');
    this.tip.style.display = 'block';
    const left = p.X + 14 + 160 > (this.canvas.clientWidth || 600) ? p.X - 170 : p.X + 14;
    this.tip.style.left = left + 'px';
    this.tip.style.top = Math.max(0, p.Y - 10) + 'px';
  }
}

function drawMarker(g, kind, X, Y, r, bg) {
  g.setLineDash([]);
  g.lineWidth = 2;
  if (kind === 'x') { g.beginPath(); g.moveTo(X - r, Y - r); g.lineTo(X + r, Y + r); g.moveTo(X + r, Y - r); g.lineTo(X - r, Y + r); g.stroke(); }
  else if (kind === 'o') { g.beginPath(); g.arc(X, Y, r, 0, 2 * Math.PI); g.fillStyle = bg; g.fill(); g.stroke(); }
  else if (kind === 'dot') { g.beginPath(); g.arc(X, Y, r, 0, 2 * Math.PI); g.fill(); }
  else if (kind === 'sq') { g.strokeRect(X - r, Y - r, 2 * r, 2 * r); }
}

/** 행 배열 → 계열 데이터 */
export function seriesFromRows(rows, key, { scale = 1, tKey = 't_s', tOffset = 0 } = {}) {
  const x = new Array(rows.length), y = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) { x[i] = rows[i][tKey] - tOffset; const v = rows[i][key]; y[i] = typeof v === 'number' ? v * scale : NaN; }
  return { x, y };
}
