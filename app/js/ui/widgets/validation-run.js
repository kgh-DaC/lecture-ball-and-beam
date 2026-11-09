// validation-run: 같은 조건 N회 자동 반복 → 평균 ± 표준편차, 묶음 저장·승격(대표/평균)·보고서 내보내기 (chapter-format §6.5).

import { h, checkProps, clear, errorBox, infoBox, warnBox, fmt, download, toast, provenanceBadge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, practiceController } from './_util.js';
import { PRACTICE_CHANNEL, runOptions } from './controller-panel.js';
import { aggregate, meanSummary } from '../../store/compare.js';
import { stepTime } from '../sources.js';
import { toCSV } from '../../store/csv.js';

export const accepts = ['profile', 'repeat', 'metrics', 'controller', 'actions'];
const DEF_METRICS = ['tr', 'po', 'ts', 'ess', 'itae', 'u_rms', 'u_sat_ratio'];

export function newGroupId(d = new Date()) { return `g${d.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`; }

/**
 * N회 반복(순수 흐름: DOM 없음 — 시험에서 직접 호출).
 * deps: { runner, device, practice, chapter_id, waitNext?: (i) => Promise, onProgress?: (i, ev) => void, shouldStop?: () => bool }
 * 반환 { group, events: [finished 이벤트] }
 */
export async function runRepeats({ runner, device, practice, chapter_id, controller, profile, repeat = 3, waitNext, onProgress, shouldStop }) {
  const group = { id: newGroupId(), n: repeat };
  const events = [];
  for (let i = 0; i < repeat; i++) {
    if (shouldStop && shouldStop()) break;
    if (i > 0 && waitNext) await waitNext(i);
    const opts = runOptions(practice, { controller, profile, chapter_id, mode: device.mode, attempt: null });
    opts.run_group = { ...group, index: i + 1 };
    opts.title = `검증 ${i + 1}/${repeat}`;
    const ev = await runner.runOnce(opts);
    events.push(ev);
    onProgress && onProgress(i, ev);
    if (!ev.complete) break;
  }
  return { group, events };
}

/** 묶음 대표 회차: best.score 최저(같은 조건 묶음). 반환 session_id */
export function representative(metas, scoreFn) {
  if (!metas.length) return null;
  const sc = scoreFn(metas.map((m) => ({ id: m.session_id, controller: m.controller && m.controller.id, setpoint_profile: m.setpoint_profile, metrics: (m.metrics && m.metrics.summary) || {} })));
  const best = sc.rows.filter((r) => r.score != null).sort((a, b) => a.score - b.score)[0];
  return best ? best.id : metas[0].session_id;
}

export function mount(el, props, ctx) {
  checkProps(el, 'validation-run', props, accepts);
  const practice = (ctx.chapter && ctx.chapter.practice) || {};
  const shared = ctx.bus ? ctx.bus.channel(PRACTICE_CHANNEL) : null;
  const metrics = props.metrics || DEF_METRICS;
  const actions = props.actions || ['save', 'promote', 'export'];
  let repeat = props.repeat ?? practice.repeat ?? 3;
  el.appendChild(head('검증 도구 — 반복 실행', h('span', { class: 'muted' }, '같은 제어기·같은 프로파일을 N회 실행해 평균과 편차를 본다')));
  const cfg = h('div');
  const ctl = h('div', { class: 'row' });
  const prog = h('div');
  const plot = new Plot(el, { height: 210, xLabel: '스텝 후 시간 (s)', yLabel: '측정 거리(표면) (mm)' });
  const res = h('div');
  el.append(cfg, ctl, prog, res);
  let stop = false, running = false, current = null;

  const curController = () => props.controller || (shared && shared.get().controller) || practiceController(ctx);
  const curProfile = () => props.profile || (shared && shared.get().profile) || practice.setpoint_profile;
  const renderCfg = () => {
    const c = curController(), p = curProfile();
    clear(cfg).append(h('div', { class: 'muted', style: { fontSize: '.9rem' } },
      `제어기: ${c ? `${c.id} ${JSON.stringify(c.params)}` : '없음'} · 프로파일: ${p ? JSON.stringify(p) : '없음'}${props.controller ? '' : ' (실습 패널의 현재 선택)'}`));
  };
  renderCfg();
  const offShared = shared ? shared.subscribe(() => renderCfg()) : null;

  const nIn = h('input', { type: 'number', min: 1, max: 20, value: repeat, class: 'num', onchange: (e) => { repeat = Math.max(1, Math.min(20, +e.target.value || 1)); } });
  const runBtn = h('button', { class: 'btn primary', onclick: () => run() }, '반복 실행');
  const stopBtn = h('button', { class: 'btn', onclick: () => { stop = true; ctx.runner.stop('user'); } }, '중단');
  const groupSel = h('select', { onchange: (e) => e.target.value && showGroup(e.target.value) });
  ctl.append(h('label', null, '반복 ', nIn, ' 회'), runBtn, stopBtn, h('label', null, ' 이전 묶음 ', groupSel));

  const loadGroups = async () => {
    if (!ctx.chapter || !ctx.store) return;
    const all = (await ctx.store.sessions.list({ chapter_id: ctx.chapter.id })).filter((m) => m.run_group && m.run_group.id);
    const groups = [...new Map(all.map((m) => [m.run_group.id, m])).values()];
    clear(groupSel).append(h('option', { value: '' }, groups.length ? '선택' : '없음'), ...groups.map((m) => h('option', { value: m.run_group.id, selected: current === m.run_group.id }, `${(m.created_at || '').slice(5, 16)} ${m.controller ? m.controller.id : ''} ×${m.run_group.n}${m.provenance === 'simulated' ? ' [시뮬레이션]' : ''}`)));
  };

  const run = async () => {
    if (running) return;
    clear(prog); clear(res);
    const dev = ctx.device;
    const controller = curController(), profile = curProfile();
    if (!controller || !profile) { prog.appendChild(errorBox('제어기 또는 프로파일이 없습니다(실습 패널에서 고르세요).')); return; }
    if (dev.mode === 'sample') { prog.appendChild(infoBox('샘플 재생 모드에서는 반복 실행을 할 수 없습니다. 아래 "이전 묶음"으로 결과만 볼 수 있습니다.')); return; }
    try { if (!dev.connected) await dev.connect(); } catch (e) { prog.appendChild(errorBox(e.message)); return; }
    running = true; stop = false; runBtn.disabled = true;
    const line = h('div', { class: 'muted' });
    prog.appendChild(line);
    const waitNext = dev.mode === 'device' ? (i) => new Promise((resolve) => {
      const b = h('button', { class: 'btn primary', onclick: () => { b.remove(); resolve(); } }, `공을 시작 위치에 놓았으면 ${i + 1}회차 시작`);
      prog.appendChild(b);
    }) : null;
    try {
      const { group, events } = await runRepeats({ runner: ctx.runner, device: dev, practice, chapter_id: ctx.chapter && ctx.chapter.id, controller, profile, repeat, waitNext,
        onProgress: (i, ev) => { line.textContent = `${i + 1}/${repeat}회 완료${ev.complete ? '' : ' (중단)'}`; }, shouldStop: () => stop });
      current = group.id;
      const completed = events.filter((e) => e.complete).length;
      if (completed === repeat && ctx.events) ctx.events.emit('finished', { ...events[events.length - 1], repeat_completed: true });
      await loadGroups();
      await showGroup(group.id);
    } catch (e) { prog.appendChild(errorBox(e.message)); }
    running = false; runBtn.disabled = false;
  };

  const showGroup = async (gid) => {
    current = gid;
    clear(res);
    const metas = (await ctx.store.sessions.list({ chapter_id: ctx.chapter ? ctx.chapter.id : undefined, run_group: gid })).sort((a, b) => (a.run_group.index || 0) - (b.run_group.index || 0));
    if (!metas.length) { res.appendChild(infoBox('묶음 세션이 없습니다.')); return; }
    const sessions = await Promise.all(metas.map((m) => ctx.store.sessions.get(m.session_id)));
    plot.setSeries(sessions.filter(Boolean).map((s, i) => { const t0 = stepTime(s.rows); return { label: `${s.meta.run_group.index}회`, x: s.rows.map((r) => r.t_s - t0), y: s.rows.map((r) => r.y_filt_mm ?? r.y_mm), ...styleOf(i), width: 1.5 }; }));
    const agg = aggregate(metas, metrics);
    const info = ctx.metrics.METRIC_INFO || {};
    const pct = (k) => /ratio/.test(k);
    const show = (k, v) => (v == null ? '–' : pct(k) ? `${(v * 100).toFixed(1)}%` : fmt(v, 3));
    res.append(
      h('div', { class: 'row' }, h('b', null, `묶음 ${gid}`), provenanceBadge(metas[0].provenance), metas.some((m) => !m.complete) ? warnBox('중단된 회차가 있습니다(평균에 포함됨, 지표가 없으면 제외)') : null),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['지표', '평균 ± 표준편차', 'n', ...metas.map((m) => `${m.run_group.index}회`)].map((x) => h('th', null, x)))),
        h('tbody', null, metrics.map((k) => h('tr', null, h('td', null, info[k] ? `${info[k].label}${info[k].unit ? ` (${info[k].unit})` : ''}` : k),
          h('td', { class: 'numc' }, agg[k].mean == null ? '–' : `${show(k, agg[k].mean)} ± ${show(k, agg[k].sd)}`), h('td', { class: 'numc' }, String(agg[k].n)),
          ...metas.map((m) => h('td', { class: 'numc' }, show(k, m.metrics && m.metrics.summary ? m.metrics.summary[k] : null)))))))));
    const rep = representative(metas, ctx.best.score);
    const acts = h('div', { class: 'row' });
    res.appendChild(acts);
    if (actions.includes('save')) {
      const nm = h('input', { type: 'text', placeholder: '묶음 이름(예: Kd 1.2 검증)', class: 'num-wide', style: { width: '14rem' } });
      acts.append(nm, h('button', { class: 'btn', onclick: async () => { for (const m of metas) await ctx.store.sessions.update(m.session_id, { run_group: { ...m.run_group, label: nm.value } }); toast('묶음 이름을 저장했습니다(세션은 이미 자동 저장됨)', 'ok'); } }, '묶음 저장'));
    }
    if (actions.includes('promote')) {
      acts.append(
        h('button', { class: 'btn', onclick: () => ctx.ui.openPromote(rep, { slots: ctx.chapter && ctx.chapter.promote_slots, run_group_mode: 'representative', title: `검증 대표 (${metas.length}회 중)` }) }, '대표 회차로 승격'),
        h('button', { class: 'btn', onclick: () => ctx.ui.openPromote(rep, { slots: ctx.chapter && ctx.chapter.promote_slots, run_group_mode: 'mean', metrics_override: meanSummary(metas, [...new Set([...metrics, 'tp', 'iae', 'u_tv', 'lost_ratio', 'itae', 'ts', 'po'])]), title: `검증 평균 (${metas.length}회)` }) }, '평균 지표로 승격'));
    }
    if (actions.includes('export')) {
      acts.append(h('button', { class: 'btn', onclick: async () => {
        const cols = ['metric', 'mean', 'sd', 'n', ...metas.map((m) => `run${m.run_group.index}`)];
        const rows = metrics.map((k) => ({ metric: k, mean: agg[k].mean, sd: agg[k].sd, n: agg[k].n, ...Object.fromEntries(metas.map((m) => [`run${m.run_group.index}`, m.metrics && m.metrics.summary ? m.metrics.summary[k] : null])) }));
        const zip = await ctx.store.sessions.exportZip(metas.map((m) => m.session_id), [{ name: `report_${gid}.csv`, data: toCSV(cols, rows) }]);
        download(`validation_${gid}.zip`, zip, 'application/zip');
      } }, '보고서 내보내기(ZIP)'));
    }
    res.appendChild(h('p', { class: 'muted', style: { fontSize: '.85rem' } }, `대표 회차 = 점수(best.js) 최저 회차: ${rep}`));
  };

  loadGroups();
  return { unmount() { offShared && offShared(); plot.destroy(); } };
}
