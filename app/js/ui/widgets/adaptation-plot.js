// adaptation-plot: 적응·스케줄 제어기의 게인 시계열(dbg_kp, dbg_ki, dbg_kd …) (chapter-format §6.7, 12장).
// source "live": 러너 링 버퍼를 rAF에서 읽는다(제어 루프와 분리). "session": 세션 참조(props.session, 없으면 이 챕터 최신 세션).
// 게인마다 단위가 달라 작은 그래프를 따로 그린다. 위에는 오차 |e|를 같이 그려 언제 게인이 바뀌는지 보이게 한다.

import { h, checkProps, clear, infoBox, badge, provenanceBadge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, sourceBadges } from './_util.js';
import { resolveSources } from '../sources.js';

export const accepts = ['source', 'session', 'keys'];
const LABEL = { kp: 'Kp (rad/m)', ki: 'Ki (rad/(m·s))', kd: 'Kd (rad·s/m)', w_far: '멂 가중치', y_ref_model: '기준 모델 y_m (m)', i: '적분 상태' };

/** 행 → 그릴 계열 { t, err_mm, keys: { k: [] } } (순수) */
export function gainSeries(rows, keys) {
  const t = rows.map((r) => r.t_s);
  const yk = rows.some((r) => Number.isFinite(r.y_filt_mm)) ? 'y_filt_mm' : 'y_mm';
  const err = rows.map((r) => (Number.isFinite(r.ref_mm) && Number.isFinite(r[yk]) ? Math.abs(r.ref_mm - r[yk]) : NaN));
  const out = {};
  for (const k of keys) { const col = rows.map((r) => (typeof r[`dbg_${k}`] === 'number' ? r[`dbg_${k}`] : NaN)); if (col.some(Number.isFinite)) out[k] = col; }
  return { t, err_mm: err, keys: out };
}

export function mount(el, props, ctx) {
  checkProps(el, 'adaptation-plot', props, accepts);
  const keys = props.keys || ['kp', 'ki', 'kd'];
  const source = props.source || 'live';
  const tag = h('span');
  el.appendChild(head('게인 적응 시계열', tag));
  const msg = h('div');
  const host = h('div');
  el.append(msg, host);
  const pE = new Plot(host, { height: 120, xLabel: '시간 (s)', yLabel: '|오차| (mm)' });
  const plots = {};
  for (const k of keys) plots[k] = new Plot(host, { height: 110, xLabel: '시간 (s)', yLabel: LABEL[k] || k });

  const draw = (rows, controllerId) => {
    const g = gainSeries(rows, keys);
    pE.setSeries([{ label: '|ref − y|', x: g.t, y: g.err_mm, ...styleOf(6), width: 1.2 }]);
    keys.forEach((k, i) => plots[k].setSeries(g.keys[k] ? [{ label: k, x: g.t, y: g.keys[k], ...styleOf(i), step: true }] : []));
    const missing = keys.filter((k) => !g.keys[k]);
    clear(msg);
    if (rows.length && missing.length) msg.appendChild(infoBox(`${controllerId ? `제어기 ${controllerId}: ` : ''}${missing.join(', ')} 기록이 없습니다(이 제어기가 그 게인을 바꾸지 않거나 debug_keys에 없음). 게인 스케줄링은 kp·ki·kd, MRAC는 kp·kd를 기록합니다.`));
  };

  let raf = null, alive = true, lastVer = -1, lastDraw = 0, drawn = false;
  const offs = [];
  if (source === 'live') {
    const runner = ctx.runner;
    if (!runner) { msg.appendChild(infoBox('러너 서비스가 없습니다.')); return {}; }
    const loop = () => {
      if (!alive) return;
      const ring = runner.ring;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (ring.version !== lastVer && now - lastDraw >= 100) {
        lastVer = ring.version; lastDraw = now;
        const rows = ring.meta && ring.meta.monitor ? [] : ring.toArray();
        if (rows.length || !drawn) clear(tag).append(runner.state === 'running' ? badge('실험 중', 'b-run') : badge(rows.length ? '마지막 실험' : '대기', 'b-unknown'), provenanceBadge(ring.meta && ring.meta.provenance));
        if (rows.length) { drawn = true; draw(rows, ring.meta && ring.meta.controller); }
        else if (!drawn) clear(msg).appendChild(infoBox('실습 패널에서 게인 스케줄링이나 MRAC로 실험을 시작하면 게인이 여기에 실시간으로 그려집니다.'));
        // 실험이 끝나 IDLE 모니터로 바뀌면 마지막 실험 그래프를 그대로 둔다
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  } else {
    const load = async () => {
      const ref = props.session || 'chapter';
      const list = (await resolveSources(ctx, [ref], { chapterLimit: 1 })).filter((s) => s.rows);
      if (!list.length) { clear(msg).appendChild(infoBox('그릴 세션이 없습니다. 실습 후 다시 오세요.')); return; }
      const s = list[0];
      clear(tag).append(h('span', { class: 'muted' }, s.label), ...sourceBadges(s));
      draw(s.rows, s.meta && s.meta.controller && s.meta.controller.id);
    };
    load().catch((e) => clear(msg).appendChild(infoBox(e.message)));
    if (ctx.store && ctx.store.onChange) offs.push(ctx.store.onChange((ev) => { if (ev.type === 'finish') load(); }));
  }
  return { unmount() { alive = false; if (raf) cancelAnimationFrame(raf); offs.forEach((f) => f()); pE.destroy(); Object.values(plots).forEach((p) => p.destroy()); } };
}
