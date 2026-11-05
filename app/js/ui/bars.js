// 막대 그래프(평균 ± 표준편차 오차 막대). 지표마다 단위가 달라 지표 하나에 그래프 하나(작은 배수).

import { COLORS } from './plot.js';

/**
 * container에 캔버스를 그린다.
 * items: [{ label, mean, sd?, n?, color?, hatch? }], opts: { title, unit, height=170, baseline? (mean 값) }
 */
export function barChart(container, items, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'plot';
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', `${opts.title || ''} 막대 그래프: ${items.map((i) => `${i.label} ${i.mean == null ? '없음' : Number(i.mean).toPrecision(3)}`).join(', ')}`);
  const H = opts.height || 170;
  cv.style.height = H + 'px';
  wrap.appendChild(cv);
  container.appendChild(wrap);
  const draw = () => {
    const g = cv.getContext && cv.getContext('2d');
    if (!g) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const W = cv.clientWidth || 300;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(wrap) : null;
    const v = (k, d) => (css && css.getPropertyValue(k).trim()) || d;
    const ink = v('--ink', '#1d232a'), muted = v('--muted', '#5d6670'), grid = v('--grid', '#e7eaee');
    const m = { l: 46, r: 8, t: 20, b: 34 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const vals = items.flatMap((i) => (i.mean == null ? [] : [i.mean + (i.sd || 0), i.mean - (i.sd || 0), 0]));
    if (opts.baseline != null) vals.push(opts.baseline);
    let ymax = Math.max(0, ...vals), ymin = Math.min(0, ...vals);
    if (ymax === ymin) ymax = ymin + 1;
    const pad = (ymax - ymin) * 0.08; ymax += pad; if (ymin < 0) ymin -= pad;
    const ty = (v) => m.t + (1 - (v - ymin) / (ymax - ymin)) * ph;
    g.font = '600 12px system-ui, sans-serif'; g.fillStyle = ink; g.textAlign = 'left';
    g.fillText(`${opts.title || ''}${opts.unit ? ` (${opts.unit})` : ''}`, m.l, 13);
    g.font = '11px system-ui, sans-serif'; g.strokeStyle = grid; g.fillStyle = muted; g.textAlign = 'right';
    for (let k = 0; k <= 4; k++) { const v = ymin + (k / 4) * (ymax - ymin); const Y = ty(v); g.beginPath(); g.moveTo(m.l, Y); g.lineTo(m.l + pw, Y); g.stroke(); g.fillText(Number(v.toPrecision(3)).toString(), m.l - 4, Y + 4); }
    const n = items.length || 1, slot = pw / n, bw = Math.min(46, slot * 0.6);
    items.forEach((it, i) => {
      const cx = m.l + slot * (i + 0.5);
      g.fillStyle = muted; g.textAlign = 'center';
      const lab = it.label.length > 14 ? it.label.slice(0, 13) + '…' : it.label;
      g.fillText(lab, cx, H - 18);
      if (it.n != null) g.fillText(`n=${it.n}`, cx, H - 5);
      if (it.mean == null) { g.fillText('없음', cx, ty(0) - 4); return; }
      const c = it.color || COLORS[i % COLORS.length];
      g.fillStyle = c; g.globalAlpha = it.hatch ? 0.45 : 0.85;
      const y0 = ty(0), y1 = ty(it.mean);
      g.fillRect(cx - bw / 2, Math.min(y0, y1), bw, Math.abs(y1 - y0));
      g.globalAlpha = 1;
      if (it.sd) {
        g.strokeStyle = ink; g.lineWidth = 1.5;
        const a = ty(it.mean + it.sd), b = ty(it.mean - it.sd);
        g.beginPath(); g.moveTo(cx, a); g.lineTo(cx, b); g.moveTo(cx - 6, a); g.lineTo(cx + 6, a); g.moveTo(cx - 6, b); g.lineTo(cx + 6, b); g.stroke();
      }
    });
    if (opts.baseline != null) { g.strokeStyle = '#D55E00'; g.setLineDash([4, 3]); const Y = ty(opts.baseline); g.beginPath(); g.moveTo(m.l, Y); g.lineTo(m.l + pw, Y); g.stroke(); g.setLineDash([]); }
  };
  draw();
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => draw()); ro.observe(wrap); }
  return { el: wrap, redraw: draw, destroy() { ro && ro.disconnect(); wrap.remove(); } };
}
