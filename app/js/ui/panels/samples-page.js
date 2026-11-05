// #/samples: 샘플 목록·미리보기·내 샘플 관리(sample-browser) + 점수 가중치(score-weights).

import { h } from '../dom.js';
import * as browser from '../widgets/sample-browser.js';
import * as weights from '../widgets/score-weights.js';

export function mount(el, query, ctx) {
  const a = h('div', { class: 'widget' }), b = h('div', { class: 'widget' });
  el.append(h('p', { class: 'muted' }, '번들 샘플(data/samples)과 내가 승격한 샘플. 시뮬레이션 샘플은 항상 시뮬레이션 배지가 붙고, 실측보다 앞서지 않습니다.'), a, b);
  const i1 = browser.mount(a, { show_score: true, allow_my_samples: true, ...(query.slot ? { filter: { slot: query.slot } } : {}), ...(query.id ? { default: query.id } : {}) }, ctx);
  const i2 = weights.mount(b, query.slot ? { slot: query.slot } : {}, ctx);
  return { unmount() { i1.unmount && i1.unmount(); i2.unmount && i2.unmount(); } };
}
