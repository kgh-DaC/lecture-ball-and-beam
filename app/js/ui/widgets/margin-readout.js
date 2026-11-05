// margin-readout: bind 채널의 개루프 이득·위상·지연 여유 숫자판 (chapter-format §6.3).

import { h, checkProps, clear, errorBox, warnBox } from '../dom.js';
import { need, channel, head, kpi, debounceRaf } from './_util.js';
import { loopTF } from './bode.js';

export const accepts = [];

export function mount(el, props, ctx) {
  checkProps(el, 'margin-readout', props, accepts);
  if (!props.bind) { el.appendChild(warnBox('margin-readout에는 bind가 필요합니다.')); return {}; }
  if (!need(el, ctx, ['analysis', 'plant'])) return {};
  const ch = channel(ctx, props, {});
  el.appendChild(head('안정 여유'));
  const box = h('div');
  el.appendChild(box);
  const draw = () => {
    const s = ch.get();
    clear(box);
    if (!s.controller) { box.appendChild(h('div', { class: 'muted' }, '같은 채널의 위젯을 기다리는 중…')); return; }
    let lt;
    try { lt = loopTF(ctx, s); } catch (e) { box.appendChild(errorBox(e.message)); return; }
    if (!lt) { box.appendChild(errorBox('비선형 제어기')); return; }
    const m = ctx.analysis.margins(lt.L);
    box.append(
      kpi('이득 여유 GM', m.gm_db == null ? '∞' : m.gm_db, m.gm_db == null ? '' : 'dB'),
      kpi('위상 여유 PM', m.pm_deg, '°'),
      kpi('이득 교차 ωgc', m.wgc, 'rad/s'),
      kpi('위상 교차 ωpc', m.wpc, 'rad/s'),
      kpi('지연 여유', m.delay_margin_s, 's'),
      h('div', { class: 'muted', style: { fontSize: '.85rem' } },
        `폐루프 ${lt.stable ? '안정' : '불안정'}. 지연 ${s.delay_s || 0} s${s.alpha != null ? `, 필터 α ${s.alpha}` : ''}. 지연 여유 = PM(rad)/ωgc — 이만큼 지연이 더 생기면 불안정해진다.`),
    );
  };
  const redraw = debounceRaf(draw);
  draw();
  const off = ch.subscribe(() => redraw());
  return { unmount() { off(); }, update() { redraw(); } };
}
