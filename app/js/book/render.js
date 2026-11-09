// 챕터 마크다운 렌더러 (chapter-format.md §3).
// - 본문 HTML은 허용하지 않는다: 모든 텍스트를 이스케이프한 뒤 마크다운 문법만 태그로 바꾼다.
// - 수식: 인라인 $...$, 블록 $$...$$ → katex.renderToString (opts.katex로 주입, Node 시험에서는 생략 가능).
// - 지시자: :::widget / :::details / :::note / :::warning / :::predict / :::part theory|practice (:::quiz:::는 무시 — 퀴즈 제거)
// DOM 없이 동작하는 순수 모듈(Node에서 시험 가능). 결과는 HTML 문자열 + 위젯·예측 목록.

import { esc } from './escape.js';

const SOURCE_TAGS = { '실측': 'b-real', '시뮬레이션': 'b-sim', '가정': 'b-assumed' };
/** 출처 표기: [실측] [시뮬레이션] [가정] [슬라이드 N] 과 세부 설명형 [시뮬레이션: …] [가정: …] [실측: …] */
const SRC_RE = /\[(실측|시뮬레이션|가정|슬라이드\s*\d+(?:[-–,]\s*\d+)*)(?:\s*[:：]\s*([^\]]+))?\](?!\()/g;
function srcBadge(tag, detail) {
  const cls = SOURCE_TAGS[tag] || 'b-slide';
  return detail ? `<span class="badge src ${cls}" title="${esc(detail)}">${esc(tag)}: ${esc(detail)}</span>` : `<span class="badge src ${cls}">${esc(tag)}</span>`;
}
/** 그림 캡션: 이스케이프 + 출처 배지 */
/** 이스케이프가 끝난 평문의 t_r, u_{tv}, ωn 같은 표기를 아래첨자(<sub>)로 바꾼다.
 *  수식($…$)·코드(`…`)는 호출 전에 자리표시자로 빠져 있어야 한다. 단어 중간의 snake_case(step_response)는 건드리지 않는다. */
export function subscripts(escaped) {
  return String(escaped)
    .replace(/(^|[^A-Za-z0-9_])([A-Za-zζθ])_(\{[^}\n]+\}|[A-Za-z0-9ζθαβωτė]{1,4})(?![A-Za-z0-9_ζθαβωτė])/g,
      (_, pre, base, sub) => `${pre}${base}<sub>${sub.replace(/^\{|\}$/g, '')}</sub>`)
    .replace(/ω([nd])(?![A-Za-z0-9])/g, 'ω<sub>$1</sub>');
}
/** 평문 → 안전한 HTML(이스케이프 + 아래첨자). 그림 설명·학습 목표처럼 마크다운이 아닌 글에 쓴다. */
export function plainHtml(text) { return subscripts(esc(String(text))); }

function captionHtml(text) {
  const parts = [];
  let last = 0;
  String(text).replace(SRC_RE, (m, tag, detail, off) => { parts.push(plainHtml(String(text).slice(last, off)), srcBadge(tag, detail)); last = off + m.length; return m; });
  parts.push(plainHtml(String(text).slice(last)));
  return parts.join('');
}

/**
 * @param {string} md
 * @param {{ katex?: any, chapterId?: string, assetBase?: string }} opts
 * @returns {{ html: string, widgets: Array<{slot:string,name:string,props:object,line:number,error?:string}>,
 *             predicts: Array<{slot:string,id:string,line:number}>, quizSlot: boolean, errors: Array<{line:number,msg:string}>, title: string|null }}
 */
export function renderChapter(md, opts = {}) {
  const ctx = { opts, widgets: [], predicts: [], quizSlot: false, errors: [], title: null, n: 0, headings: [], parts: [], part: null };
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const tree = parseDirectives(lines, ctx);
  const html = renderNodes(tree, ctx);
  return { html, widgets: ctx.widgets, predicts: ctx.predicts, quizSlot: ctx.quizSlot, errors: ctx.errors, title: ctx.title, headings: ctx.headings, parts: ctx.parts };
}

// ---------- 1단계: 지시자 블록 구조 ----------
const RE_WIDGET = /^:::widget\s+([a-z0-9-]+)\s*(.*?):::\s*$/;
const RE_OPEN = /^:::(details|note|warning|predict|part)(?:\s+(.*))?\s*$/;
export const PART_LABEL = { theory: '이론', practice: '실습: 장비 측정' };

function parseDirectives(lines, ctx) {
  const root = { type: 'root', children: [], line: 0 };
  const stack = [root];
  let text = [];
  let inFence = false;
  let inMath = false;
  const flush = () => { if (text.length) { stack[stack.length - 1].children.push({ type: 'md', lines: text }); text = []; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const ln = i + 1;
    const t = raw.trim();
    if (/^(```|~~~)/.test(t)) inFence = !inFence;
    else if (!inFence && t === '$$') inMath = !inMath;
    if (inFence || inMath || !t.startsWith(':::') || /^(```|~~~)/.test(t)) {
      text.push({ s: raw, ln });
      continue;
    }
    const cur = stack[stack.length - 1];
    let m;
    if ((m = t.match(RE_WIDGET))) {
      flush();
      cur.children.push({ type: 'widget', name: m[1], json: m[2].trim(), line: ln });
    } else if (t === ':::quiz:::') {
      flush();
      cur.children.push({ type: 'quiz', line: ln });
    } else if ((m = t.match(RE_OPEN))) {
      flush();
      const node = { type: m[1], arg: (m[2] || '').trim(), children: [], line: ln };
      cur.children.push(node);
      stack.push(node);
    } else if (t === ':::') {
      flush();
      if (stack.length === 1) {
        ctx.errors.push({ line: ln, msg: '여는 지시자 없이 ::: 가 나왔습니다' });
        cur.children.push({ type: 'error', msg: `줄 ${ln}: 짝이 없는 ':::'`, line: ln });
      } else stack.pop();
    } else {
      flush();
      ctx.errors.push({ line: ln, msg: `알 수 없는 지시자: ${t}` });
      cur.children.push({ type: 'error', msg: `줄 ${ln}: 알 수 없는 지시자 "${t}"`, line: ln });
    }
  }
  flush();
  while (stack.length > 1) {
    const open = stack.pop();
    ctx.errors.push({ line: open.line, msg: `:::${open.type} 가 닫히지 않았습니다` });
    open.unclosed = true;
  }
  return root;
}

// ---------- 2단계: 렌더 ----------
function renderNodes(node, ctx) {
  let out = '';
  for (const c of node.children) {
    switch (c.type) {
      case 'md': out += renderMarkdown(c.lines, ctx); break;
      case 'widget': out += renderWidgetSlot(c, ctx); break;
      case 'quiz': break; // 퀴즈·채점 제거(chapter-format 1.2.0): 옛 :::quiz::: 는 조용히 무시
      case 'part': {
        const kind = c.arg;
        if (!PART_LABEL[kind]) { ctx.errors.push({ line: c.line, msg: `:::part 는 theory 또는 practice: ${kind}` }); out += `<div class="box box-error">줄 ${c.line}: :::part ${esc(kind)} — theory 또는 practice만 허용</div>${renderNodes(c, ctx)}`; break; }
        const pid = `part-${ctx.parts.length + 1}-${kind}`;
        ctx.parts.push({ id: pid, kind, line: c.line });
        const prev = ctx.part; ctx.part = kind;
        const inner = renderNodes(c, ctx);
        ctx.part = prev;
        const icon = kind === 'theory' ? '📖' : '🔌';
        out += `<section class="part part-${kind}" id="${pid}" data-part="${kind}" aria-label="${PART_LABEL[kind]}"><div class="part-head"><span class="part-icon" aria-hidden="true">${icon}</span><span class="part-label">${PART_LABEL[kind]}</span>${kind === 'practice' ? '<span class="part-conn" data-conn></span>' : ''}</div><div class="part-body">${inner}</div></section>`;
        break;
      }
      case 'error': out += `<div class="box box-error">${esc(c.msg)}</div>`; break;
      case 'details':
        out += `<details class="derivation"><summary><span class="box-icon" aria-hidden="true">+</span>${inline(c.arg || '자세히', ctx)} <span class="muted details-hint">(펼치기)</span></summary><div class="details-body">${renderNodes(c, ctx)}</div></details>`;
        break;
      case 'note': out += `<aside class="box box-note" role="note" aria-label="참고"><div class="box-title"><span class="box-icon" aria-hidden="true">i</span>참고</div>${renderNodes(c, ctx)}</aside>`; break;
      case 'warning': out += `<aside class="box box-warn" role="note" aria-label="주의"><div class="box-title"><span class="box-icon" aria-hidden="true">!</span>주의</div>${renderNodes(c, ctx)}</aside>`; break;
      case 'predict': {
        const slot = `p${ctx.n++}`;
        ctx.predicts.push({ slot, id: c.arg, line: c.line });
        out += `<div class="predict-box" data-pslot="${slot}" role="group" aria-label="예측"><div class="box-title"><span class="box-icon" aria-hidden="true">?</span>먼저 예측해 보세요</div>${renderNodes(c, ctx)}<div class="predict-input"></div></div>`;
        break;
      }
      default: break;
    }
    if (c.unclosed) out += `<div class="box box-error">줄 ${c.line}: :::${esc(c.type)} 가 닫히지 않았습니다</div>`;
  }
  return out;
}

function renderWidgetSlot(c, ctx) {
  const slot = `w${ctx.n++}`;
  let props = {};
  let error;
  if (c.json) {
    try {
      props = JSON.parse(c.json);
      if (!props || typeof props !== 'object' || Array.isArray(props)) throw new Error('props는 JSON 객체여야 합니다');
    } catch (e) {
      error = `줄 ${c.line}: 위젯 ${c.name} props JSON 오류 — ${e.message}`;
      ctx.errors.push({ line: c.line, msg: error });
      props = {};
    }
  }
  ctx.widgets.push({ slot, name: c.name, props, line: c.line, error });
  return `<div class="widget-slot" data-wslot="${slot}" data-widget="${esc(c.name)}"></div>`;
}

// ---------- 마크다운(블록) ----------
function renderMarkdown(lines, ctx) {
  let out = '';
  let i = 0;
  const L = lines.map((x) => x.s);
  while (i < L.length) {
    const line = L[i];
    const t = line.trim();
    if (t === '') { i++; continue; }
    // 코드 펜스
    let m = t.match(/^(```|~~~)\s*([\w-]*)/);
    if (m) {
      const fence = m[1];
      const buf = [];
      i++;
      while (i < L.length && !L[i].trim().startsWith(fence)) buf.push(L[i++]);
      i++;
      out += `<div class="code-wrap"><button type="button" class="code-copy" data-copy-code aria-label="예제 코드 복사">복사</button><pre class="code"><code${m[2] ? ` class="lang-${esc(m[2])}"` : ''}>${esc(buf.join('\n'))}</code></pre></div>`;
      continue;
    }
    // 블록 수식
    if (t.startsWith('$$')) {
      let body = t.slice(2);
      if (body.endsWith('$$') && body.length >= 2) {
        body = body.slice(0, -2); i++;
      } else {
        const buf = [body];
        i++;
        while (i < L.length && !L[i].trim().endsWith('$$')) buf.push(L[i++]);
        if (i < L.length) { buf.push(L[i].trim().slice(0, -2)); i++; }
        body = buf.join('\n');
      }
      out += `<div class="math-block">${tex(body, true, ctx)}</div>`;
      continue;
    }
    // 제목
    m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) {
      const lvl = m[1].length;
      if (lvl === 1 && ctx.title == null) ctx.title = m[2];
      const id = 'h-' + slug(m[2]);
      if (lvl === 2 || lvl === 3) ctx.headings.push({ lvl, id, part: ctx.part, text: m[2].replace(/\$[^$]*\$/g, (x) => x.slice(1, -1)).replace(/[`*_]/g, '') });
      out += `<h${lvl} id="${id}">${inline(m[2], ctx)}</h${lvl}>`;
      i++; continue;
    }
    // 수평선
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { out += '<hr>'; i++; continue; }
    // 표
    if (t.startsWith('|') && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
      const head = splitRow(t);
      const aligns = splitRow(L[i + 1].trim()).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < L.length && L[i].trim().startsWith('|')) rows.push(splitRow(L[i++].trim()));
      out += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
        head.map((c, k) => `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c, ctx)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + head.map((_, k) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(r[k] ?? '', ctx)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>';
      continue;
    }
    // 인용
    if (t.startsWith('>')) {
      const buf = [];
      while (i < L.length && L[i].trim().startsWith('>')) buf.push({ s: L[i++].trim().replace(/^>\s?/, '') });
      out += `<blockquote>${renderMarkdown(buf, ctx)}</blockquote>`;
      continue;
    }
    // 목록
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const r = parseList(L, i, ctx);
      out += r.html; i = r.next; continue;
    }
    // 단락
    const buf = [];
    while (i < L.length && L[i].trim() !== '' && !isBlockStart(L[i], L[i + 1])) buf.push(L[i++].trim());
    if (!buf.length) { buf.push(L[i++].trim()); }
    out += `<p>${inline(buf.join('\n'), ctx)}</p>`;
  }
  return out;
}

function isBlockStart(line, next) {
  const t = line.trim();
  return /^(#{1,6}\s|```|~~~|\$\$|>|(-{3,}|\*{3,})$)/.test(t) || /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    (t.startsWith('|') && next != null && /^\s*\|?\s*:?-{2,}/.test(next));
}

function indentOf(s) { return s.match(/^\s*/)[0].replace(/\t/g, '  ').length; }

function parseList(L, i, ctx) {
  const base = indentOf(L[i]);
  const ordered = /^\s*\d+[.)]/.test(L[i]);
  const startNum = ordered ? parseInt(L[i].trim(), 10) : 1;
  const items = [];
  while (i < L.length) {
    const line = L[i];
    if (line.trim() === '') {
      // 빈 줄 다음이 같은 수준 목록 항목이면 계속
      if (i + 1 < L.length && /^\s*([-*+]|\d+[.)])\s+/.test(L[i + 1]) && indentOf(L[i + 1]) >= base) { i++; continue; }
      break;
    }
    const ind = indentOf(line);
    const m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (m && ind === base) { items.push({ text: [m[2]], sub: [] }); i++; continue; }
    if (ind > base && items.length) {
      if (m) {
        // 하위 목록
        const r = parseList(L, i, ctx);
        items[items.length - 1].sub.push(r.html);
        i = r.next; continue;
      }
      items[items.length - 1].text.push(line.trim()); i++; continue;
    }
    if (!m && ind <= base && items.length && !isBlockStart(line)) { items[items.length - 1].text.push(line.trim()); i++; continue; }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const html = `<${tag}${startAttr}>` + items.map((it) => {
    let txt = it.text.join('\n');
    let cls = '';
    const cb = txt.match(/^\[( |x|X)\]\s+/);
    if (cb) { cls = ' class="task"'; txt = (cb[1] === ' ' ? '☐ ' : '☑ ') + txt.slice(cb[0].length); }
    return `<li${cls}>${inline(txt, ctx)}${it.sub.join('')}</li>`;
  }).join('') + `</${tag}>`;
  return { html, next: i };
}

function splitRow(t) {
  let s = t.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  // \| 이스케이프와 $..$ 안의 | 는 셀 구분자가 아니다
  const cells = [];
  let cur = '';
  let inMath = false;
  let inCode = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '$' && !inCode) inMath = !inMath;
    if (ch === '|' && !inMath && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function slug(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60); }

// ---------- 인라인 ----------
function tex(src, display, ctx) {
  const k = ctx.opts.katex;
  if (!k) return `<span class="math-raw">${esc(src)}</span>`;
  try {
    return k.renderToString(src, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html' });
  } catch (e) {
    ctx.errors.push({ line: 0, msg: `수식 오류: ${e.message}` });
    return `<span class="math-error" title="${esc(e.message)}">${esc(src)}</span>`;
  }
}

function safeUrl(u, ctx, isImage) {
  u = u.trim();
  if (/^(javascript|data|vbscript):/i.test(u)) return null;
  if (/^https?:\/\//i.test(u) || u.startsWith('#')) return u;
  if (/^assets\//.test(u)) return (ctx.opts.assetBase || '../curriculum/') + u;
  if (/^(\.\.\/|\.\/|[\w-]+\/)/.test(u) || /^[\w.-]+$/.test(u)) return isImage ? (ctx.opts.assetBase || '../curriculum/') + u : u;
  return u;
}

/** 인라인 마크다운: 이스케이프 후 변환. 코드·수식은 먼저 자리표시자로 빼 둔다. */
export function inline(src, ctx = { opts: {}, errors: [] }) {
  const stash = [];
  const put = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = String(src);
  s = s.replace(/`([^`]+)`/g, (_, c) => put(`<code>${esc(c)}</code>`));
  s = s.replace(/(^|[^\\$])\$([^$\n]+?)\$(?!\d)/g, (_, pre, m) => pre + put(tex(m, false, ctx)));
  s = s.replace(/\\\$/g, () => put('$'));
  // 이미지, 링크
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
    const u = safeUrl(url, ctx, true);
    if (!u) return put(esc(alt));
    if (!alt) ctx.errors && ctx.errors.push({ line: 0, msg: `그림 설명(alt)이 없습니다: ${url}` });
    // assets/ 경로: 기준(curriculum/assets/)이 없으면 curriculum/chapters/assets/로 재시도(data-fallback, 셸이 처리)
    const fb = /^assets\//.test(url.trim()) ? ` data-fallback="${esc((ctx.opts.assetBase || '../curriculum/') + 'chapters/' + url.trim())}"` : '';
    const cap = title || alt;
    return put(`<figure class="fig"><div class="fig-card"><img src="${esc(u)}" alt="${esc(alt || '그림 설명 없음')}" loading="lazy" decoding="async"${fb}${title ? ` title="${esc(title)}"` : ''}></div>${alt ? '' : '<div class="box box-warn">그림 설명(alt)이 없습니다</div>'}${cap ? `<figcaption>${captionHtml(cap)}</figcaption>` : ''}</figure>`);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => {
    const u = safeUrl(url, ctx, false);
    if (!u) return txt;
    const ext = /^https?:/i.test(u);
    return put(`<a href="${esc(u)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>`) + txt + put('</a>');
  });
  // 출처 표기 배지
  s = s.replace(SRC_RE, (m, tag, detail) => put(srcBadge(tag, detail)));
  s = subscripts(esc(s));
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/ {2,}\n|\\\n/g, '<br>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, k) => stash[+k]);
  // 자리표시자 안에 자리표시자가 남는 경우(링크 텍스트 안 코드) 한 번 더
  s = s.replace(/\u0000(\d+)\u0000/g, (_, k) => stash[+k]);
  return s;
}
