// ai-compare: AI 제어기와 고전·현대 제어기를 같은 조건에서 비교(18·20장, ai-extension §3).
// 공칭 모델(서보 포함) P1 스텝 응답: control.simulate → metrics(지표 정의 한 곳). 대표 궤적을 겹쳐 그린다.
// 무작위 모델: control/ai/evaluate.compareControllers(모든 제어기에 같은 모델 표본) → 성공률·평균 ITAE·폴백 비율 표와 막대.
// 계산은 제어기 하나씩 setTimeout 청크로 나눠 화면이 멈추지 않게 한다.

import { h, checkProps, clear, infoBox, fmt, table } from '../dom.js';
import { Plot, styleOf, COLORS } from '../plot.js';
import { barChart } from '../bars.js';
import { head, kv, simRun, practiceParamsFor, P1 } from './_util.js';
import { loadAI } from '../ai/lib.js';

export const accepts = ['controllers', 'domain_rand', 'n_domains', 'seed', 'profile'];

/** 비교 기본 파라미터(20장 표의 "설정" 열과 같게): PID = 10장 안전 기본값, AI = 번들 정책 */
export const COMPARE_DEFAULTS = Object.freeze({
  pid: { kp: 1, ki: 0, kd: 1.5, n_filt: 8, d_on: 'measurement' },
  'nn-policy': { policy: 'es' },
  'q-policy': { policy: 'bundled' },
});
const DEVICE_ONLY = ['angle_limit', 'rate_limit'];

export async function mount(el, props, ctx) {
  checkProps(el, 'ai-compare', props, accepts);
  const ai = await loadAI();
  const ids = Array.isArray(props.controllers) ? props.controllers.slice() : String(props.controllers || 'pid,lqr,nn-policy,q-policy').split(',').map((s) => s.trim()).filter(Boolean);
  let domainRand = props.domain_rand !== false;
  let nDom = Math.max(1, Math.min(32, props.n_domains ?? 8));
  const seed = props.seed ?? 1;
  const profile = props.profile || P1;
  let nnPolicy = 'es';
  el.appendChild(head('AI vs 고전·현대 제어 비교', h('span', { class: 'muted' }, 'P1 스텝(150 → 200 mm), 서보 포함 가정 모델, 같은 잡음 시드 [시뮬레이션]')));
  const ctl = h('div', { class: 'row' });
  const msg = h('div');
  const tbl = h('div', { class: 'tbl-wrap' });
  const bars = h('div', { class: 'grid2' });
  el.append(ctl, msg, tbl, bars);
  const pY = new Plot(el, { height: props.height_px || 230, xLabel: '시간 (s)', yLabel: '위치 y (mm)' });
  const pU = new Plot(el, { height: 150, xLabel: '시간 (s)', yLabel: '서보 명령 u (°)' });
  let charts = [], alive = true, runId = 0;

  const reg = ctx.control && ctx.control.registry;
  const getC = (id) => { try { return ctx.control.getController(id); } catch { return null; } };
  const paramsFor = (id) => {
    const pr = ctx.chapter && ctx.chapter.practice;
    const safe = pr ? practiceParamsFor(pr, id).safe : {};
    const p = { ...(COMPARE_DEFAULTS[id] || {}), ...safe };
    for (const k of DEVICE_ONLY) delete p[k];
    if (id === 'nn-policy') p.policy = nnPolicy;
    return p;
  };

  const run = async () => {
    const my = ++runId;
    charts.forEach((c) => c.destroy()); charts = [];
    clear(msg); clear(tbl); clear(bars);
    if (!reg || !ctx.control.simulate) { msg.appendChild(infoBox('제어 모듈(registry·simulate)을 불러오지 못했습니다.')); return; }
    const list = [], missing = [];
    for (const id of ids) { const C = getC(id); if (C) list.push({ id, label: C.meta.label || id, params: paramsFor(id) }); else missing.push(id); }
    if (missing.length) msg.appendChild(infoBox(`등록되지 않은 제어기는 건너뜁니다: ${missing.join(', ')}`));
    // 1) 공칭 모델 응답: evaluate.runOne(무작위 비교의 첫 표본과 같은 공칭 모델·시드) 또는 control.simulate
    const E = ai.evaluate;
    const nom = [];
    for (const c of list) {
      try {
        if (E && E.runOne) {
          const r = E.runOne({ id: c.id, params: c.params }, { profile, model: 'ball_servo', noise: true, seed: seed * 1000 });
          const sm = r.sim;
          nom.push({ ...c, r: { t: sm.t_s, y: sm.y_m.map((v) => v * 1000), ref: sm.ref_m.map((v) => v * 1000), u: sm.u_rad.map((v) => v * 180 / Math.PI),
            po: r.stepinfo.po, ts: r.stepinfo.ts, itae: r.itae, u_tv: r.u_tv_rad } });
        } else {
          const r = simRun(ctx, { controller: { id: c.id, params: c.params }, plant: 'ball+servo', profile });
          const q = r.rows;
          nom.push({ ...c, r: { t: q.map((x) => x.t_s), y: q.map((x) => x.y_mm), ref: q.map((x) => x.ref_mm), u: q.map((x) => x.u_cdeg / 100),
            po: r.summary.po, ts: r.summary.ts, itae: r.summary.itae, u_tv: r.summary.u_tv } });
        }
      } catch (e) { nom.push({ ...c, r: null, err: e.message }); }
    }
    if (!alive || my !== runId) return;
    const ok = nom.filter((n) => n.r);
    pY.setSeries([...ok.map((n, i) => ({ label: n.label, x: n.r.t, y: n.r.y, ...styleOf(i), width: 2 })),
      ...(ok[0] ? [{ label: '설정값', x: ok[0].r.t, y: ok[0].r.ref, ...styleOf(6), width: 1, step: true }] : [])]);
    pU.setSeries(ok.map((n, i) => ({ label: n.label, x: n.r.t, y: n.r.u, ...styleOf(i), width: 1.4 })));
    for (const n of nom.filter((x) => !x.r)) msg.appendChild(infoBox(`${n.label} 시뮬레이션을 하지 못했습니다: ${n.err}`));
    // 2) 무작위 모델(같은 표본)
    const rnd = new Map();
    const ev = ai.evaluate && ai.evaluate.compareControllers;
    const dom = domainRand && ai.trainEnv ? { ...ai.trainEnv.DEFAULT_DOMAIN } : null;
    const drawTable = () => {
      clear(tbl);
      const rows = nom.map((n) => {
        const s = n.r || {};
        const q = rnd.get(n.id);
        const sm = q && q.summary;
        return [n.label, fmt(s.po, 1), s.ts == null ? '미정착' : fmt(s.ts, 2), fmt(s.itae, 4), fmt(s.u_tv, 2),
          sm ? `${fmt(sm.success_rate * 100, 0)}%` : (ev ? '계산 중…' : '–'), sm ? fmt(sm.itae_mean, 4) : '–', sm && sm.fallback_ratio_mean != null ? `${fmt(sm.fallback_ratio_mean * 100, 1)}%` : '–'];
      });
      tbl.appendChild(table(['제어기', '공칭 P.O. (%)', '공칭 ts (s)', `공칭 ITAE${E && E.runOne ? ' (m·s²)' : ''}`, 'u_tv (rad)', `${dom ? '무작위' : '공칭'} 모델 성공률`, `${dom ? '무작위' : '공칭'} 평균 ITAE`, '폴백 비율'], rows));
    };
    drawTable();
    if (!ev) { msg.appendChild(infoBox('무작위 모델 비교 모듈(control/ai/evaluate.js)이 아직 없어 공칭 모델 결과만 보여 줍니다.')); return; }
    for (const c of list) {
      await new Promise((r) => setTimeout(r, 0));
      if (!alive || my !== runId) return;
      try {
        const out = ev([{ id: c.id, params: c.params, label: c.label }], { profile, domain: dom, n_domains: dom ? nDom : 1, seed, model: 'ball_servo', noise: true });
        rnd.set(c.id, out[0]);
      } catch (e) { msg.appendChild(infoBox(`${c.label} 무작위 모델 평가를 하지 못했습니다: ${e.message}`)); }
      drawTable();
    }
    const done = list.filter((c) => rnd.get(c.id));
    if (!done.length) return;
    const mk = (title, unit, f) => { const cell = h('div'); bars.appendChild(cell); charts.push(barChart(cell, done.map((c) => ({ label: c.label, mean: f(rnd.get(c.id).summary), color: COLORS[list.indexOf(c) % COLORS.length], hatch: true })), { title, unit, height: 170 })); };
    mk('성공률', '%', (s) => s.success_rate * 100);
    mk('평균 ITAE', '', (s) => s.itae_mean);
    bars.appendChild(h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `성공 = 빔 끝 충돌 없음 + 정착. 정착 = 최종값 둘레 ±5% 띠(스텝 크기 기준) 안에 마지막 이탈 뒤 관찰 끝까지 1 s 이상 머묾(관찰이 짧으면 관찰 길이의 1/4). 끝 샘플만 우연히 띠 안인 진동은 미정착입니다. ${dom ? `무작위 모델 ${nDom}개(K_b 0.8~1.2배, 서보 τ 0.04~0.10 s, 지연 0~0.04 s, 잡음 0~2 mm), 모든 제어기에 같은 표본.` : '공칭 모델만.'} 폴백 비율이 0이 아니면 그 행은 "정책 + PD" 혼합 결과입니다.`));
  };

  ctl.append(
    h('label', null, h('input', { type: 'checkbox', checked: domainRand, onchange: (e) => { domainRand = e.target.checked; } }), ' 무작위 모델(도메인 랜덤화)'),
    h('label', null, '모델 수 ', h('input', { type: 'number', min: 1, max: 32, step: 1, value: nDom, class: 'num', onchange: (e) => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= 32) nDom = v; } })),
    ids.includes('nn-policy') ? h('label', null, '신경망 정책 ', h('select', { onchange: (e) => { nnPolicy = e.target.value; } }, [['es', '번들 ES'], ['bc', '번들 BC'], ['dagger', '번들 DAgger'], ['user', '내가 학습(없으면 ES)']].map(([v, t]) => h('option', { value: v }, t)))) : null,
    h('button', { class: 'btn primary', onclick: () => run() }, '다시 비교'),
    kv('제어기', ids.join(', ')));
  run(); // 공칭 응답은 바로, 무작위 모델 평가는 청크로 이어서
  return { unmount() { alive = false; charts.forEach((c) => c.destroy()); pY.destroy(); pU.destroy(); }, run };
}
