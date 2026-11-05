// 작은 DOM 도우미. 모든 사용자/교재 문자열은 textContent로 넣는다(HTML 주입 방지).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** 평문에서 t_r, u_{tv}, ωn 같은 표기를 아래첨자 요소로 바꾼 노드 배열(textContent만 사용, HTML 주입 없음) */
export function subNodes(text) {
  const out = [];
  const re = /(^|[^A-Za-z0-9_])([A-Za-zζθ])_(\{[^}\n]+\}|[A-Za-z0-9ζθαβωτė]{1,4})(?![A-Za-z0-9_ζθαβωτė])|ω([nd])(?![A-Za-z0-9])/g;
  const str = String(text);
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m[4]) { out.push(str.slice(last, m.index) + 'ω'); out.push(h('sub', null, m[4])); }
    else { out.push(str.slice(last, m.index) + m[1] + m[2]); out.push(h('sub', null, m[3].replace(/^\{|\}$/g, ''))); }
    last = m.index + m[0].length;
  }
  out.push(str.slice(last));
  return out;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 숫자 표시. null/NaN → '–' */
export function fmt(v, digits = 3) {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toFixed(digits)).toString();
}

export function badge(text, kind = '') { return h('span', { class: `badge ${kind}` }, text); }

export function provenanceBadge(prov) {
  if (prov === 'real') return badge('실측', 'b-real');
  if (prov === 'simulated') return badge('시뮬레이션', 'b-sim');
  return badge('출처 미상', 'b-unknown');
}

/**
 * 데이터 소스 이름(라벨·표 행 머리용). "실측"은 provenance가 real(또는 measured)일 때만 쓴다(G-3).
 * 인자: provenance 문자열 또는 { provenance, meta } 소스 객체.
 * 반환: '실측' | '시뮬레이션' | '시뮬레이션(디지털 트윈)' | '시뮬레이션(가상 장치)' | '모델 예측' | '출처 미상 데이터'
 */
export function provenanceWord(src) {
  const o = typeof src === 'string' || src == null ? { provenance: src } : src;
  const meta = o.meta || {};
  const prov = o.provenance || meta.provenance;
  if (prov === 'real' || prov === 'measured') return '실측';
  if (prov === 'simulated') {
    if (o.kind === 'prediction' || meta.source === 'prediction') return '모델 예측';
    if (meta.device && meta.device.mode === 'twin') return '시뮬레이션(디지털 트윈)';
    if (meta.source === 'virtual') return '시뮬레이션(가상 장치)';
    return '시뮬레이션';
  }
  return '출처 미상 데이터';
}

export const TIER_LABEL = { 'my-real': '내 실측', 'bundle-real': '실측', 'my-sim': '내 시뮬레이션', 'bundle-sim': '시뮬레이션' };
export function tierBadge(tier) {
  return badge(TIER_LABEL[tier] || tier, tier && tier.endsWith('real') ? 'b-real' : 'b-sim');
}

export function errorBox(msg, detail) {
  return h('div', { class: 'box box-error' }, h('strong', null, '오류: '), msg, detail ? h('pre', null, detail) : null);
}
export function infoBox(msg) { return h('div', { class: 'box box-info' }, msg); }
export function warnBox(msg) { return h('div', { class: 'box box-warn' }, msg); }

/** 위젯 공통: 알 수 없는 props 키 경고 상자 (chapter-format §5.1) */
export function checkProps(el, name, props, accepts) {
  const common = ['id', 'bind', 'height_px', 'caption'];
  const unknown = Object.keys(props || {}).filter((k) => !accepts.includes(k) && !common.includes(k));
  if (unknown.length) {
    el.appendChild(warnBox(`위젯 ${name}: 알 수 없는 props 키 ${unknown.join(', ')} (오타인지 확인하세요)`));
    console.warn(`[widget ${name}] unknown props:`, unknown);
  }
  return unknown;
}

export function download(filename, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple });
    inp.addEventListener('change', () => resolve(Array.from(inp.files || [])));
    inp.click();
  });
}

export function toast(msg, kind = 'info', ms = 4000) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.appendChild(host); }
  const t = h('div', { class: `toast toast-${kind}`, role: 'status' }, msg);
  host.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** 모달 대화상자. body는 Node. 반환: { el, close } */
export function modal(title, body, { wide = false, onClose } = {}) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); onClose && onClose(); };
  const box = h('div', { class: `modal ${wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'btn-x', onclick: close, 'aria-label': '닫기' }, '×')),
    h('div', { class: 'modal-body' }, body));
  back.appendChild(box);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.appendChild(back);
  return { el: box, close };
}

/** 슬라이더 + 숫자 입력 한 줄 */
export function slider({ label, min, max, step, value, unit = '', onInput, log = false, disabled = false }) {
  const toPos = (v) => (log ? Math.log10(Math.max(v, 1e-12)) : v);
  const fromPos = (p) => (log ? 10 ** p : p);
  const rng = h('input', { type: 'range', min: toPos(min), max: toPos(max), step: log ? (toPos(max) - toPos(min)) / 200 : step, value: toPos(value), disabled });
  const num = h('input', { type: 'number', min, max, step: step || 'any', value, disabled, class: 'num' });
  const set = (v, src) => {
    v = Math.min(max, Math.max(min, v));
    if (src !== rng) rng.value = toPos(v);
    if (src !== num) num.value = Number(v.toPrecision(5));
    onInput && onInput(v);
  };
  rng.addEventListener('input', () => set(fromPos(Number(rng.value)), rng));
  num.addEventListener('change', () => { const v = Number(num.value); if (Number.isFinite(v)) set(v, num); });
  const row = h('label', { class: 'slider-row' }, h('span', { class: 'sl-label' }, label), rng, num, h('span', { class: 'sl-unit' }, unit));
  row.setValue = (v) => { rng.value = toPos(v); num.value = Number(Number(v).toPrecision(5)); };
  row.setDisabled = (d) => { rng.disabled = d; num.disabled = d; };
  return row;
}

export function table(headers, rows, { cls = '' } = {}) {
  return h('table', { class: `tbl ${cls}` },
    h('thead', null, h('tr', null, headers.map((x) => h('th', null, x)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => (c instanceof Node ? h('td', null, c) : h('td', null, c == null ? '–' : String(c))))))));
}
