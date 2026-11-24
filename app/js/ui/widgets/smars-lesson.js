// smars-lesson: SMARS 로봇 수업 교재(lesson.html)의 모듈 카드(M1~M6)를 교재 안에 그대로 보여 준다 (chapter-format §6.11).
// app/smars-lesson/lesson.html 은 볼앤빔용 틀 페이지(동기화 안 함)이고, M1~M6 내용인 app/smars-lesson/a1/(a1.js·a1.css)과
// examples/ 만 SMARS 저장소(kgh-DaC/lecture-SMARS)의 a1/·examples/ 와 tools/sync_lesson.mjs 로 양방향 동기화된다.
// 이 위젯은 틀 페이지를 iframe 으로 열 뿐이다. 내용을 바꾸려면 a1/a1.js(예제는 examples/*.ino)를 고치고 동기화한다.

import { h, checkProps } from '../dom.js';
import { head } from './_util.js';

export const accepts = ['mods', 'start'];
export const LESSON_SRC = 'smars-lesson/lesson.html';
const DEFAULT_MODS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];

/** iframe 주소(순수 함수, 시험용) */
export function lessonUrl(props = {}) {
  const mods = Array.isArray(props.mods) && props.mods.length ? props.mods : DEFAULT_MODS;
  const safe = mods.filter((m) => /^[a-z0-9]+$/i.test(m));
  const start = typeof props.start === 'string' && /^[a-z0-9]+$/i.test(props.start) ? props.start : '';
  return `${LESSON_SRC}?embed=1&mods=${safe.join(',')}${start ? '#' + start : ''}`;
}

export function mount(el, props = {}) {
  checkProps(el, 'smars-lesson', props, accepts);
  const src = lessonUrl(props);
  el.appendChild(head('SMARS 로봇 수업 교재 (M1~M6)'));
  el.appendChild(h('div', { class: 'row' },
    h('a', { class: 'btn', href: src, target: '_blank', rel: 'noopener' }, '새 창에서 크게 열기'),
    h('span', { class: 'muted', style: { fontSize: '.85rem' } },
      '왼쪽 목차에서 모듈을 고르세요. 체크리스트는 이 브라우저에 저장됩니다. 미니 시리얼 모니터는 페이지 맨 아래에 있습니다.')));
  const height = Number(props.height_px) > 200 ? `${Number(props.height_px)}px` : '85vh';
  el.appendChild(h('iframe', {
    src,
    title: 'SMARS 로봇 수업 교재 M1~M6',
    loading: 'lazy',
    allow: 'serial; clipboard-write',
    style: { width: '100%', height, minHeight: '520px', border: '1px solid var(--border, #2a2d3e)', borderRadius: '8px', background: '#0f1117', display: 'block' },
  }));
}
