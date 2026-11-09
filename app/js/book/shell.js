// 교재 셸: 왼쪽 목차, 해시 라우팅(#/ch/<id>, #/settings, #/sessions, #/samples), 챕터 본문·위젯 마운트, 진도.

import { renderChapter, plainHtml } from './render.js';
import { Bus } from './bus.js';
import { h, clear, badge, errorBox, infoBox, warnBox, toast } from '../ui/dom.js';
import { PATHS } from '../config/defaults.js';
import { practiceDoneBy } from '../ui/practice.js';

export const WIDGETS = [
  'step-response', 'ball-beam-sim', 'pwm-demo', 'wiring-diagram',
  'device-check', 'device-settings',
  'root-locus', 'spec-region', 'bode', 'nyquist', 'margin-readout',
  'calibration-wizard', 'identification-lab', 'model-compare', 'overlay-plot',
  'live-plot', 'controller-panel', 'attempt-log', 'validation-run', 'metrics-table', 'compare-bars',
  'sample-browser', 'score-weights', 'promote-sample', 'sample-compare',
  'relay-test', 'tuning-rules', 'convergence-plot', 'schedule-editor', 'adaptation-plot', 'qr-explorer', 'observer-lab', 'phase-plane', 'smc-lab', 'final-compare',
  'signal-monitor', 'angle-limit-finder', 'level-finder',
  'hardware-steps', 'pot-mapping-test', 'servo-center-assist', 'level-trim', 'sensor-position-test',
  'nn-trainer', 'nn-viz', 'nn-model-compare', 'rl-trainer', 'q-table-view', 'policy-map', 'reward-curve', 'imitation-lab', 'ai-compare',
  'twin-lab', 'twin-montecarlo',
];

const PAGES = {
  settings: { title: '장치 설정', module: '../ui/panels/settings-page.js' },
  sessions: { title: '내 세션', module: '../ui/panels/sessions-page.js' },
  samples: { title: '샘플 데이터', module: '../ui/panels/samples-page.js' },
};

// 평문을 이스케이프하고 t_r 같은 표기를 아래첨자로 바꿔 넣는 요소
const rich = (tag, cls, text) => { const e = h(tag, cls ? { class: cls } : null); e.innerHTML = plainHtml(text); return e; };

/** 예제 코드 블록의 [복사] 버튼: 코드 본문(<code>의 텍스트)만 클립보드로 */
function wireCodeCopy(root) {
  root.addEventListener('click', async (ev) => {
    const btn = ev.target.closest && ev.target.closest('[data-copy-code]');
    if (!btn || !root.contains(btn)) return;
    const code = btn.parentElement && btn.parentElement.querySelector('pre code');
    if (!code) return;
    const text = code.textContent;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
    } catch (_) { ok = false; }
    if (!ok) {
      // file:// 등 보안 컨텍스트가 아닐 때의 대체 경로
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove();
    }
    btn.textContent = ok ? '복사됨 ✓' : '복사 실패';
    btn.classList.toggle('done', ok);
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.textContent = '복사'; btn.classList.remove('done'); }, 1500);
  });
}

export class Shell {
  /** services: main.js가 만든 공용 ctx 조각 */
  constructor({ tocEl, mainEl, searchEl, services, katex }) {
    this.tocEl = tocEl; this.mainEl = mainEl; this.searchEl = searchEl;
    this.services = services; this.katex = katex;
    this.toc = null; this.chapters = new Map();
    this.mounted = [];
    this.current = null;
  }

  async init() {
    try {
      const r = await fetch(PATHS.toc, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.toc = await r.json();
    } catch (e) {
      this.toc = { title: '볼앤빔으로 배우는 제어공학', parts: [] };
      this.mainEl.appendChild(errorBox(`목차(curriculum/toc.json)를 읽지 못했습니다: ${e.message}. 로컬 서버(python -m http.server)를 저장소 최상위에서 실행했는지 확인하세요.`));
    }
    const ids = this.toc.parts.flatMap((p) => p.chapters);
    await Promise.all(ids.map(async (id) => {
      try {
        const r = await fetch(`${PATHS.chapters}${id}.json`, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        this.chapters.set(id, await r.json());
      } catch (e) {
        this.chapters.set(id, { id, title: id, status: 'missing', missing: true });
      }
    }));
    this.order = ids;
    document.title = this.toc.title || document.title;
    this.searchEl.addEventListener('input', () => this.renderToc());
    this.services.progress.onChange(() => this.renderToc());
    this.services.events.on('finished', (ev) => this._onSessionFinished(ev));
    await this.renderToc();
    window.addEventListener('hashchange', () => this.route());
    await this.route();
  }

  async renderToc() {
    const q = (this.searchEl.value || '').trim().toLowerCase();
    const prog = await this.services.progress.all();
    const frag = document.createDocumentFragment();
    frag.appendChild(h('div', { class: 'toc-title' }, this.toc.title));
    for (const part of this.toc.parts) {
      const items = part.chapters.map((id) => this.chapters.get(id)).filter((c) => {
        if (!q) return true;
        const hay = [c.id, c.title, ...(c.keywords || []), ...(c.objectives || [])].join(' ').toLowerCase();
        return hay.includes(q);
      });
      if (!items.length) continue;
      const ul = h('ul', { class: 'toc-list' });
      let nDone = 0;
      for (const c of items) {
        const p = prog[c.id] || {};
        const st = chapterState(c, p);
        if (st === 'done') nDone++;
        const marks = [];
        if (p.read) marks.push(h('span', { class: 'pmark read', title: '읽음' }, '✓ 읽음'));
        if (p.practice_done) marks.push(h('span', { class: 'pmark prac', title: '실습 완료' }, '✓ 실습'));
        const a = h('a', { href: `#/ch/${c.id}`, class: `${this.current === c.id ? 'active' : ''} st-${st}`, 'aria-current': this.current === c.id ? 'page' : null, title: STATE_LABEL[st] },
          h('span', { class: `toc-state st-${st}`, 'aria-label': STATE_LABEL[st] }), h('span', { class: 'toc-no' }, c.id.slice(0, 2)), h('span', { class: 'toc-name' }, c.title),
          h('span', { class: 'toc-kind', title: c.practice ? '이론 + 장비 실습' : '이론·자료 비교' }, h('span', { 'aria-hidden': 'true' }, c.practice ? '📖🔌' : '📖'), h('span', { class: 'sr-only' }, c.practice ? '이론과 실습' : '이론')),
          c.status === 'draft' ? badge('작성 중', 'b-draft') : null, c.missing ? badge('없음', 'b-unknown') : null,
          h('span', { class: 'toc-marks' }, marks));
        ul.appendChild(h('li', null, a));
      }
      frag.appendChild(h('div', { class: 'toc-part' }, h('div', { class: 'toc-part-title' }, `${part.id}. ${part.title}`, h('span', { class: 'toc-part-prog' }, ` ${nDone}/${items.length}`)),
        h('div', { class: 'toc-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': items.length, 'aria-valuenow': nDone }, h('span', { style: { width: `${items.length ? (100 * nDone) / items.length : 0}%` } })), ul));
    }
    frag.appendChild(h('div', { class: 'toc-tools' },
      h('a', { href: '#/settings' }, '장치 설정'), h('a', { href: '#/sessions' }, '내 세션'), h('a', { href: '#/samples' }, '샘플 데이터')));
    clear(this.tocEl).appendChild(frag);
  }

  _unmountAll() {
    for (const m of this.mounted) { try { m.unmount && m.unmount(); } catch (e) { console.error(e); } }
    this.mounted = [];
    if (this._scrollOff) { this._scrollOff(); this._scrollOff = null; }
  }

  async route() {
    const hash = location.hash || '#/';
    const m = hash.match(/^#\/(ch|settings|sessions|samples)(?:\/([\w-]+))?(?:\?(.*))?$/);
    this._unmountAll();
    clear(this.mainEl);
    document.body.classList.remove('toc-open');
    if (m && m[1] === 'ch' && m[2]) return this.openChapter(m[2], m[3]);
    if (m && PAGES[m[1]]) return this.openPage(m[1], m[3]);
    return this.openHome();
  }

  async openHome() {
    this.current = null;
    this.renderToc();
    const prog = await this.services.progress.all();
    const next = this.order.find((id) => !(prog[id] && prog[id].read)) || this.order[0];
    this.mainEl.append(
      h('h1', null, this.toc.title),
      h('p', null, '왼쪽 목차에서 챕터를 고르세요. 각 챕터는 이론 → 시뮬레이션 → 예측 → 실습(실제 장치 / 가상 장치 / 샘플 재생) → 비교 순서입니다. 이론(📖)과 장비 실습(🔌) 영역이 구분되어 있습니다. 하드웨어가 없어도 가상 장치와 샘플 재생으로 끝까지 학습할 수 있습니다.'),
      next ? h('p', null, h('a', { class: 'btn primary', href: `#/ch/${next}` }, `이어서 학습: ${this.chapters.get(next)?.title || next}`)) : null,
      h('h2', null, '학습 데이터 관리'),
      h('p', null, '진도·세션·샘플은 이 브라우저(IndexedDB)에만 저장되고 외부로 전송되지 않습니다. PC를 바꿀 때는 진도 내보내기와 세션 ZIP 내보내기를 쓰세요.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => this.services.exportProgress() }, '진도 내보내기'),
        h('button', { class: 'btn', onclick: () => this.services.importProgress() }, '진도 불러오기'),
        h('a', { class: 'btn', href: '#/sessions' }, '세션 관리'),
        h('a', { class: 'btn', href: '#/settings' }, '장치 설정')),
    );
  }

  async openPage(name, query) {
    this.current = null;
    this.renderToc();
    const page = PAGES[name];
    this.mainEl.appendChild(h('h1', null, page.title));
    const host = h('div');
    this.mainEl.appendChild(host);
    try {
      const mod = await import(page.module);
      const ctx = this.makeCtx(null);
      const inst = mod.mount(host, parseQuery(query), ctx);
      if (inst) this.mounted.push(inst);
    } catch (e) {
      console.error(e);
      host.appendChild(errorBox(`화면을 열지 못했습니다: ${e.message}`));
    }
  }

  makeCtx(chapter) {
    const s = this.services;
    const bus = new Bus();
    return {
      ...s.ctx,
      chapter: chapter ? { id: chapter.id, practice: chapter.practice || null, predictions: chapter.predictions || [], promote_slots: chapter.promote_slots || [], sample_sessions: chapter.sample_sessions || [], title: chapter.title } : null,
      bus,
    };
  }

  async openChapter(id, query) {
    const ch = this.chapters.get(id);
    this.current = id;
    this.renderToc();
    if (!ch || ch.missing) {
      this.mainEl.appendChild(errorBox(`챕터 ${id} 를 찾을 수 없습니다(curriculum/chapters/${id}.json).`));
      return;
    }
    let md = '';
    try {
      const r = await fetch(`${PATHS.chapters}${id}.md`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      md = await r.text();
    } catch (e) {
      this.mainEl.appendChild(errorBox(`본문(${id}.md)을 읽지 못했습니다: ${e.message}`));
      return;
    }
    const out = renderChapter(md, { katex: this.katex, chapterId: id, assetBase: PATHS.assets });
    for (const er of out.errors) console.warn(`[${id}.md] 줄 ${er.line}: ${er.msg}`);
    const prog = await this.services.progress.get(id);
    const allProg = await this.services.progress.all();
    const i = this.order.indexOf(id);
    const prev = this.order[i - 1], next = this.order[i + 1];
    const head = chapterHead(ch, out, allProg, (r) => this.chapters.get(r));
    const body = h('article', { class: 'ch-body' });
    body.innerHTML = out.html;
    const secToc = sectionToc(out);
    const page = h('div', { class: `ch-page${secToc ? ' has-sec' : ''}` }, h('div', { class: 'ch-main' }, head, body), secToc);
    this.mainEl.append(page);
    enhanceFigures(body);
    wireCodeCopy(body);
    const ctx = this.makeCtx(ch);
    // practice 없는 챕터: 위젯 조작(입력·버튼) 1회로 실습 완료 (chapter-format §8, 1.1.0)
    this._interacted = !!prog.practice_done;
    // 위젯 마운트
    const declared = new Set(ch.widgets || []);
    for (const w of out.widgets) {
      const slot = body.querySelector(`[data-wslot="${w.slot}"]`);
      if (!slot) continue;
      this.mountWidget(slot, w, ctx, declared);
    }
    // 예측
    for (const p of out.predicts) {
      const box = body.querySelector(`[data-pslot="${p.slot}"] .predict-input`);
      if (box) this.renderPrediction(box, ch, p.id, prog);
    }
    // 이전/다음
    this.mainEl.appendChild(h('nav', { class: 'ch-nav', 'aria-label': '이전·다음 챕터' },
      prev ? h('a', { class: 'btn nav-prev', href: `#/ch/${prev}` }, h('small', null, '← 이전'), h('span', null, this.chapters.get(prev).title)) : h('span'),
      next ? h('a', { class: 'btn primary nav-next', href: `#/ch/${next}` }, h('small', null, '다음 →'), h('span', null, this.chapters.get(next).title)) : h('span')));
    this._practiceBar(body, ctx);
    this._trackSections(body, secToc);
    // 제목 앵커로 스크롤(쿼리 h=...)
    const q = parseQuery(query);
    if (q.h) { const t = findHeading(body, q.h); if (t) t.scrollIntoView(); } else window.scrollTo(0, 0);
    this._trackScroll(id, prog);
  }

  async mountWidget(slot, w, ctx, declared) {
    const name = w.name;
    const wrap = h('figure', { class: `widget widget-${name}` });
    slot.appendChild(wrap);
    if (w.error) { wrap.appendChild(errorBox(w.error)); return; }
    if (!WIDGETS.includes(name)) { wrap.appendChild(errorBox(`알 수 없는 위젯 "${name}" (카탈로그 ${WIDGETS.length}개 밖, chapter-format.md §6)`)); return; }
    if (!declared.has(name)) console.warn(`[${ctx.chapter.id}] 위젯 ${name} 이 json widgets에 없습니다`);
    const host = h('div', { class: 'widget-body' });
    wrap.appendChild(host);
    if (w.props.caption) wrap.appendChild(h('figcaption', null, w.props.caption));
    const chapter = this.chapters.get(ctx.chapter && ctx.chapter.id);
    if (chapter && !chapter.practice) {
      const onUse = (e) => {
        const t = e && e.target;
        const tag = t && t.tagName;
        if (e.type === 'click' && !(tag === 'BUTTON' || (t.closest && t.closest('button')))) return;
        if (!this._interacted) { this._interacted = true; this._markDone(chapter, { type: 'interaction', widget: name }); }
      };
      for (const t of ['click', 'change', 'input']) wrap.addEventListener(t, onUse);
    }
    try {
      const mod = await import(`../ui/widgets/${name}.js`);
      const inst = await mod.mount(host, w.props, ctx);
      this.mounted.push(inst || {});
    } catch (e) {
      console.error(`위젯 ${name} 마운트 실패`, e);
      const notReady = /Failed to fetch dynamically imported module|Cannot find module|404|Importing a module script failed/.test(String(e && e.message));
      host.appendChild(notReady ? infoBox(`위젯 "${name}" 은 아직 구현되지 않았습니다(준비 중).`) : errorBox(`위젯 ${name} 오류: ${e.message}`));
    }
  }

  renderPrediction(box, ch, pid, prog) {
    const def = (ch.predictions || []).find((p) => p.id === pid);
    if (!def) { box.appendChild(errorBox(`예측 ${pid} 정의가 json predictions에 없습니다`)); return; }
    const saved = prog.predictions ? prog.predictions[pid] : undefined;
    const save = (v) => this.services.progress.set(ch.id, { predictions: { [pid]: v } }).then(() => { status.textContent = '저장됨'; });
    const status = h('span', { class: 'muted' }, saved != null ? '저장됨' : '');
    if (def.q) box.appendChild(rich('div', 'predict-q', def.q));
    if (def.type === 'choice') {
      const name = `pred-${ch.id}-${pid}`;
      box.appendChild(h('div', { class: 'predict-choices' }, def.choices.map((c, i) => h('label', null,
        h('input', { type: 'radio', name, value: i, checked: saved === i, onchange: () => save(i) }), ' ', rich('span', null, c)))));
    } else if (def.type === 'numeric') {
      box.appendChild(h('label', null, '내 예측: ', h('input', { type: 'number', step: 'any', value: saved ?? '', class: 'num-wide', onchange: (e) => save(Number(e.target.value)) }), ` ${def.unit || ''}`));
    } else {
      box.appendChild(h('textarea', { rows: 2, class: 'predict-short', value: saved ?? '', onchange: (e) => save(e.target.value) }));
    }
    box.appendChild(h('div', { class: 'predict-foot' }, status, ' 예측은 채점하지 않습니다. 실습 후 결과와 나란히 비교하세요.'));
    if (def.answer) {
      // 답은 접어 둔다: 먼저 예측을 적고 펼쳐 보도록(chapter-format 1.8.0 predictions[].answer)
      box.appendChild(h('details', { class: 'predict-answer' },
        h('summary', null, '답 확인 ', h('span', { class: 'muted' }, '(예측을 적은 뒤 펼치기)')),
        rich('div', 'predict-answer-body', def.answer)));
    }
  }

  /** 실습 영역(:::part practice)이 화면에 들어오면 연결 모드 상단 바, 각 실습 머리에 연결 배지 */
  _practiceBar(body, ctx) {
    const parts = body.querySelectorAll('section.part-practice');
    const dev = ctx.device;
    if (!parts.length || !dev) return;
    const bar = h('div', { class: 'practice-bar', role: 'status' });
    bar.hidden = true;
    this.mainEl.prepend(bar);
    const paint = () => {
      const lab = connLabel(dev);
      for (const sec of parts) { const b = sec.querySelector('.part-conn'); if (b) clear(b).append(badge(lab.text, lab.cls)); }
      clear(bar).append(h('span', { 'aria-hidden': 'true' }, '🔌 '), h('b', null, '실습 영역'), ' · ', badge(lab.text, lab.cls), h('span', { class: 'muted' }, lab.hint));
    };
    paint();
    const offs = [];
    if (dev.onStatus) offs.push(dev.onStatus(() => paint()));
    let io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      const vis = new Set();
      io = new IntersectionObserver((ents) => { for (const e of ents) { if (e.isIntersecting) vis.add(e.target); else vis.delete(e.target); } bar.hidden = vis.size === 0; paint(); });
      for (const sec of parts) io.observe(sec);
    }
    this.mounted.push({ unmount() { offs.forEach((f) => f && f()); if (io) io.disconnect(); bar.remove(); } });
  }

  /** 절 목차 스크롤 추적(현재 절 강조) */
  _trackSections(body, secToc) {
    if (!secToc || typeof IntersectionObserver === 'undefined') return;
    const links = new Map([...secToc.querySelectorAll('a')].map((a) => [a.dataset.target, a]));
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { for (const a of links.values()) a.classList.remove('cur'); const a = links.get(e.target.id); if (a) a.classList.add('cur'); }
    }, { rootMargin: '0px 0px -70% 0px' });
    for (const id of links.keys()) { const el = document.getElementById(id); if (el) io.observe(el); }
    this.mounted.push({ unmount() { io.disconnect(); } });
  }

  _trackScroll(id, prog) {
    let max = prog.scroll_max || 0;
    let saved = !!prog.read;
    const onScroll = () => {
      const doc = document.documentElement;
      const frac = (window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight);
      if (frac > max + 0.05 || (frac >= 0.9 && !saved)) {
        max = Math.max(max, Math.min(1, frac));
        const patch = { scroll_max: Number(max.toFixed(2)) };
        if (max >= 0.9 && !saved) { saved = true; patch.read = true; patch.read_at = new Date().toISOString(); }
        this.services.progress.set(id, patch);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 1500); // 짧은 챕터
    this._scrollOff = () => window.removeEventListener('scroll', onScroll);
  }

  /** 세션 저장 이벤트 → 진도 기록. 검증 도구가 여러 세션을 잇달아 저장해도 순서대로 처리한다(W2: 완료 토스트는 처음 완료될 때 한 번만) */
  _onSessionFinished(ev) {
    this._sessionQ = (this._sessionQ || Promise.resolve()).then(() => this._recordSession(ev)).catch((e) => console.warn('진도 기록 실패', e));
    return this._sessionQ;
  }

  async _recordSession(ev) {
    const meta = ev.meta;
    if (!meta || !meta.chapter_id) return;
    const ch = this.chapters.get(meta.chapter_id);
    const cur = (await this.services.progress.get(meta.chapter_id)) || {};
    const patch = { practice_sessions: [meta.session_id] };
    // practice 없는 챕터에서 저장한 세션도 기본 규칙(session_saved)으로 본다. 이미 완료된 장은 다시 표시하지 않는다
    const newlyDone = !cur.practice_done && practiceDoneBy(ch && ch.practice ? ch : { practice: {} }, { ...ev, type: 'session' });
    if (newlyDone) { patch.practice_done = true; patch.practice_done_by = 'session'; }
    await this.services.progress.set(meta.chapter_id, patch);
    if (newlyDone) toast(`${ch ? ch.title : meta.chapter_id}: 실습 완료로 기록했습니다`, 'ok');
  }

  /** 상호작용·퀴즈 이벤트로 실습 완료 판정(practice 없는 챕터만 해당, practiceDoneBy) */
  async _markDone(ch, ev) {
    if (!ch || !practiceDoneBy(ch, ev)) return;
    const cur = await this.services.progress.get(ch.id);
    if (cur.practice_done) return;
    await this.services.progress.set(ch.id, { practice_done: true, practice_done_by: ev.type });
    toast(`${ch.title}: 위젯 조작으로 실습 완료를 기록했습니다`, 'ok');
  }
}

export function parseQuery(q) {
  const o = {};
  if (!q) return o;
  for (const kv of q.split('&')) { const [k, v] = kv.split('='); if (k) o[decodeURIComponent(k)] = decodeURIComponent(v || ''); }
  return o;
}

export const STATE_LABEL = { done: '완료', progress: '진행 중', none: '시작 전' };

/**
 * 챕터 진도 상태(chapter-format §8, 1.2.0 — 퀴즈 없음).
 * 완료 = 읽음 + 실습 완료(practice 없는 챕터는 위젯 조작으로 실습 완료). 진행 중 = 읽음/실습/스크롤 10% 이상 중 하나.
 */
export function chapterState(ch, p = {}) {
  if (p.read && p.practice_done) return 'done';
  if (p.read || p.practice_done || (p.scroll_max || 0) > 0.1) return 'progress';
  return 'none';
}

/** 연결 모드 → 배지 문구 */
export function connLabel(dev) {
  if (!dev) return { text: '장치 없음', cls: 'b-unknown', hint: '' };
  if (dev.mode === 'sample') return { text: '샘플 재생', cls: 'b-unknown', hint: ' 저장된 데이터를 다시 봅니다(장치 불필요)' };
  if (dev.mode === 'virtual') return { text: dev.connected ? '가상 장치 연결됨' : '가상 장치', cls: 'b-sim', hint: ' 시뮬레이션 데이터입니다' };
  if (dev.mode === 'twin') return { text: dev.connected ? '디지털 트윈 [시뮬레이션] 연결됨' : '디지털 트윈 [시뮬레이션]', cls: 'b-sim b-twin', hint: ' 설계 모델과 다른 가상 물리 — 시뮬레이션 데이터입니다' };
  return { text: dev.connected ? '실제 장치 연결됨' : '실제 장치 연결 안 됨', cls: dev.connected ? 'b-real' : 'b-bad', hint: dev.connected ? ' 실측 데이터를 기록합니다' : ' 실습 패널에서 연결하세요' };
}

/** 챕터 머리 카드: 제목·예상 시간·구성(이론/실습)·선수 챕터·학습 목표 */
export function chapterHead(ch, out, allProg, getCh) {
  const parts = out.parts || [];
  const nTheory = parts.filter((p) => p.kind === 'theory').length, nPrac = parts.filter((p) => p.kind === 'practice').length;
  const reqs = (ch.requires || []).map((r) => ({ id: r, ch: getCh(r), done: !!(allProg[r] && allProg[r].read) }));
  const kinds = parts.length
    ? [h('span', { class: 'kind-chip theory' }, `📖 이론 ${nTheory}`), nPrac ? h('span', { class: 'kind-chip practice' }, `🔌 실습 ${nPrac}`) : null]
    : [h('span', { class: 'kind-chip theory' }, '📖 이론'), ch.practice ? h('span', { class: 'kind-chip practice' }, '🔌 실습') : null];
  const card = h('header', { class: 'ch-head' },
    h('div', { class: 'ch-meta' }, `파트 ${ch.part} · ${ch.order ?? ''}장`, ch.status === 'draft' ? badge('작성 중', 'b-draft') : null),
    h('div', { class: 'overview' },
      h('div', { class: 'ov-item' }, h('div', { class: 'ov-k' }, '예상 시간'), h('div', { class: 'ov-v' }, `약 ${ch.est_minutes ?? '?'}분`)),
      h('div', { class: 'ov-item' }, h('div', { class: 'ov-k' }, '구성'), h('div', { class: 'ov-v' }, kinds)),
      h('div', { class: 'ov-item ov-wide' }, h('div', { class: 'ov-k' }, '선수 챕터'), h('div', { class: 'ov-v' },
        reqs.length ? reqs.map((r) => h('a', { href: `#/ch/${r.id}`, class: `req ${r.done ? 'req-done' : 'req-todo'}` }, r.done ? '✓ ' : '○ ', (r.ch && r.ch.title) || r.id)) : '없음'))),
    ch.objectives && ch.objectives.length ? h('div', { class: 'objectives' }, h('div', { class: 'ov-k' }, '학습 목표'), h('ul', null, ch.objectives.map((o) => rich('li', null, o)))) : null);
  if (reqs.some((r) => !r.done)) card.appendChild(infoBox('선수 챕터를 아직 다 읽지 않았습니다 — 열람은 가능합니다.'));
  if (ch.status === 'draft') card.appendChild(warnBox('이 챕터는 작성 중입니다. 일부 위젯·제어기·샘플이 아직 준비되지 않았을 수 있습니다.'));
  return card;
}

/** 절 목차(h2·h3, 이론/실습 표시). 절이 2개 미만이면 null */
export function sectionToc(out) {
  if (!out.headings || out.headings.length < 2) return null;
  return h('nav', { class: 'sec-toc', 'aria-label': '이 챕터의 절' }, h('div', { class: 'sec-toc-title' }, '이 챕터'),
    h('ol', null, out.headings.map((x) => h('li', { class: `lv${x.lvl}${x.part ? ` in-${x.part}` : ''}` },
      h('a', { href: `#${x.id}`, dataset: { target: x.id }, onclick: (e) => { if (e.preventDefault) e.preventDefault(); const t = document.getElementById(x.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
        x.part ? h('span', { class: 'sec-kind', title: x.part === 'theory' ? '이론' : '실습' }, x.part === 'theory' ? '📖 ' : '🔌 ') : null, x.text)))));
}

/** 그림: 클릭 확대(라이트박스), 키보드 접근, 경로 대체(data-fallback) */
export function enhanceFigures(root) {
  for (const img of root.querySelectorAll('figure.fig img')) {
    const fb = img.dataset && img.dataset.fallback;
    if (fb) img.addEventListener('error', () => { if (img.getAttribute('src') !== fb) img.setAttribute('src', fb); else { const f = img.closest && img.closest('figure'); if (f) f.classList.add('fig-missing'); } });
    img.setAttribute('tabindex', '0');
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `${img.getAttribute('alt') || '그림'} — 눌러서 크게 보기`);
    const open = () => openLightbox(img.getAttribute('src'), img.getAttribute('alt'));
    img.addEventListener('click', open);
    img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { if (e.preventDefault) e.preventDefault(); open(); } });
  }
}

export function openLightbox(src, alt) {
  const back = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': alt || '그림 확대' });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  back.append(h('div', { class: 'lb-card' }, h('img', { src, alt: alt || '' })), h('div', { class: 'lb-cap' }, alt || ''), h('button', { class: 'btn-x lb-x', 'aria-label': '닫기', onclick: close }, '×'));
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  return { el: back, close };
}

/**
 * 제목 앵커 찾기: 정확한 id가 없으면(절 제목이 바뀐 경우, 예: '6. 아두이노 Uno와 배선' → '6. 아두이노(Uno/Nano)와 배선')
 * 같은 절 번호 접두사(h-6-, h-7-2-)로 시작하는 첫 제목을 쓴다.
 */
export function findHeading(root, hid) {
  const exact = typeof document !== 'undefined' && document.getElementById ? document.getElementById(hid) : null;
  if (exact) return exact;
  const m = /^(h-(?:\d+-)+)/.exec(String(hid));
  if (!m || !root) return null;
  const want = m[1];
  // 문서 순서로 훑는다(가장 앞의 같은 번호 절)
  const walk = (n) => {
    for (const e of n.children || []) {
      const id = e.id || '';
      if (/^H[2-6]$/.test(e.tagName) && id.startsWith(want) && !/^\d/.test(id.slice(want.length))) return e;
      const r = walk(e);
      if (r) return r;
    }
    return null;
  };
  return walk(root);
}
