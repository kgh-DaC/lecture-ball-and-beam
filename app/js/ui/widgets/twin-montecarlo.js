// twin-montecarlo: 디지털 트윈 강건성 시험 (chapter-format §6.9, docs/spec/digital-twin.md §2.4·§7).
// 제어기 여러 개를 같은 시나리오·같은 파라미터 표본(공통 난수)으로 반복 실행해 성공률·ITAE·오버슈트 분포를 표·막대·점 그림으로 보인다.
// 계산은 sim/twin(montecarlo.sampleVariations·summarizeRuns, scenario.runScenario)을 ui/twin/mc-job.js 가 실행 하나씩 나눠 호출한다.
// 모듈 Worker(ui/twin/mc-worker.js)에서 돌고, 못 쓰면 주 스레드 setTimeout 청크 — 어느 쪽이든 화면·실시간 제어를 막지 않는다.
// 버튼을 눌렀을 때만 계산한다(auto_run 이 true 가 아니면).

import { h, checkProps, clear, errorBox, infoBox, badge, fmt, table, download } from '../dom.js';
import { Plot, styleOf, COLORS } from '../plot.js';
import { barChart } from '../bars.js';
import { head } from './_util.js';
import { practiceParamsFor } from '../practice.js';
import { TWIN_BADGE, twinFetchOf, loadTwinParams, loadScenarioIndex, loadScenario, resolveControllers, CONTROLLER_PRESETS, paramsProvenanceText } from '../twin/lib.js';
import { startMonteCarlo } from '../twin/mc-runner.js';

export const accepts = ['scenario', 'scenarios', 'controllers', 'n', 'seed', 'variation_scale', 'auto_run'];

const DEFAULT_CONTROLLERS = 'pd-p1,pd-servo,pid-tl,lqr,lqi,smc-sat';
const VAR_LABEL = {
  mass: '공 질량', inertia_ratio: '공 관성비 κ', friction: '구름·점성 마찰', restitution: '반발계수',
  tau_servo: '서보 시정수 τ', delay_servo: '서보 지연 T_d', servo_gain: '서보 이득', slew: '서보 최대 속도', deadband: '데드밴드', backlash: '백래시',
  sensor_noise: '센서 잡음', sensor_scale: '센서 배율', outlier_prob: '이상값 확률', lost_prob: '유실 확률', latency: '통신 지연', level_offset_deg: '수평 오차',
};

/** 변동 범위 문장(키별 ±) */
export function describeVariation(variation, scale = 1) {
  return Object.entries(variation || {}).map(([k, v]) => (k === 'level_offset_deg' ? `${VAR_LABEL[k] || k} ±${fmt(v * scale, 3)}°` : `${VAR_LABEL[k] || k} ±${fmt(v * scale * 100, 0)}%`));
}

/** 실행 목록 → 표준편차(막대 오차용) */
const sd = (a) => { const f = a.filter(Number.isFinite); if (f.length < 2) return null; const m = f.reduce((s, x) => s + x, 0) / f.length; return Math.sqrt(f.reduce((s, x) => s + (x - m) ** 2, 0) / (f.length - 1)); };

export async function mount(el, props, ctx) {
  checkProps(el, 'twin-montecarlo', props, accepts);
  const f = twinFetchOf(ctx);
  const prov = h('span', { class: 'muted' });
  el.appendChild(head('강건성 시험 (몬테카를로)', badge(TWIN_BADGE, 'b-sim b-twin'), prov));
  if (!ctx.control || !ctx.control.getController) { el.appendChild(infoBox('제어 모듈(control/registry.js)을 불러오지 못했습니다.')); return {}; }
  let tp = null, scList = [];
  try {
    [tp, scList] = await Promise.all([
      ctx.device && ctx.device.twinInfo ? ctx.device.twinInfo : loadTwinParams(f, ctx.control.idResult ? ctx.control.idResult() : null),
      loadScenarioIndex(f),
    ]);
  } catch (e) { el.appendChild(errorBox(`디지털 트윈 파일을 읽지 못했습니다: ${e.message}`)); return {}; }
  prov.textContent = ` ${paramsProvenanceText(tp)} · ${tp.ref}`;
  if (Array.isArray(props.scenarios) && props.scenarios.length) scList = scList.filter((s) => props.scenarios.includes(s.id));
  if (!scList.length) { el.appendChild(errorBox('쓸 수 있는 시나리오가 없습니다.')); return {}; }
  const practice = ctx.chapter && ctx.chapter.practice;
  const { list: ctrls, missing } = resolveControllers(props.controllers || DEFAULT_CONTROLLERS, {
    getController: ctx.control.getController, practiceSafe: (id) => practiceParamsFor(practice, id).safe,
  });
  if (missing.length) el.appendChild(infoBox(`등록되지 않은 제어기는 건너뜁니다: ${missing.join(', ')}`));
  if (!ctrls.length) { el.appendChild(errorBox('쓸 수 있는 제어기가 없습니다.')); return {}; }

  let scId = props.scenario && scList.some((s) => s.id === props.scenario) ? props.scenario : (scList.find((s) => s.id === 'step-nominal') || scList[0]).id;
  let n = Math.max(2, Math.min(100, Math.round(props.n ?? 10)));
  let vScale = props.variation_scale ?? 1;
  const seedProp = props.seed;
  const on = ctrls.map(() => true);
  let sc = null, handle = null, result = null, alive = true, charts = [];

  // ---------------------------------------------------------------- 화면
  const scSel = h('select', { 'aria-label': '시나리오' }, scList.map((s) => h('option', { value: s.id, selected: s.id === scId }, s.title)));
  const nIn = h('input', { type: 'number', min: 2, max: 100, step: 1, value: n, class: 'num', 'aria-label': '표본 수' });
  const vSel = h('select', { 'aria-label': '변동 배율' }, [0, 0.5, 1, 1.5, 2].map((v) => h('option', { value: v, selected: v === vScale }, v === 0 ? '0 (공칭만, 센서 시드만 다름)' : `${v}×`)));
  const ctlBoxes = h('div', { class: 'row' }, h('span', { class: 'muted' }, '제어기: '),
    ctrls.map((c, i) => h('label', { title: Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(', ') }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { on[i] = e.target.checked; } }), ` ${c.label}`)));
  const btnRun = h('button', { class: 'btn primary', onclick: () => run() }, '강건성 시험 실행');
  const btnStop = h('button', { class: 'btn', disabled: true, onclick: () => handle && handle.stop() }, '멈추기(지금까지 결과)');
  const btnJson = h('button', { class: 'btn small', disabled: true, onclick: () => result && download(`twin-montecarlo-${result.scenario_id}-n${result.n}-seed${result.seed}.json`, JSON.stringify(result, null, 1), 'application/json') }, '결과 JSON 내려받기');
  const prog = h('div', { class: 'muted twin-progress', role: 'status' });
  const varDesc = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  const msg = h('div');
  const tbl = h('div', { class: 'tbl-wrap' });
  const bars = h('div', { class: 'grid2' });
  const notes = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  el.append(
    h('div', { class: 'row' }, h('label', null, '시나리오 ', scSel), h('label', null, '표본 수 ', nIn), h('label', null, '변동 범위 ', vSel)),
    varDesc, ctlBoxes,
    h('div', { class: 'row' }, btnRun, btnStop, btnJson), prog, msg, tbl, bars);
  const pDist = new Plot(el, { height: props.height_px || 200, xLabel: '제어기 번호 (점 하나 = 표본 하나, ●/■ 성공 × 실패)', yLabel: 'ITAE (m·s²)', title: 'ITAE 분포' });
  el.appendChild(notes);

  const showVar = () => {
    if (!sc) return;
    const d = describeVariation(sc.param_variation, vScale);
    varDesc.textContent = `${sc.description || sc.title} — 변동(표본마다 균일 추출): ${d.length ? d.join(', ') : '없음'}. 표본 0 = 공칭. 시드 ${seedProp ?? sc.seed}.`;
  };
  const loadSc = async () => { sc = await loadScenario(f, scId); showVar(); };
  scSel.addEventListener('change', (e) => { scId = e.target.value; loadSc().catch((er) => clear(msg).appendChild(errorBox(er.message))); });
  nIn.addEventListener('change', (e) => { const v = Math.round(Number(e.target.value)); if (v >= 2 && v <= 100) n = v; else e.target.value = n; });
  vSel.addEventListener('change', (e) => { vScale = Number(e.target.value); showVar(); });
  try { await loadSc(); } catch (e) { el.appendChild(errorBox(e.message)); return {}; }

  // ---------------------------------------------------------------- 결과 그리기
  const drawPartial = (all, chosen) => {
    // 진행 중: 제어기별 지금까지 성공률·ITAE 평균
    clear(tbl);
    const rows = chosen.map((c, i) => {
      const it = all.filter((x) => x.controller === i);
      const ok = it.filter((x) => x.success).length;
      const it2 = it.map((x) => x.itae).filter(Number.isFinite);
      return [c.label, `${it.length}/${n}`, it.length ? `${fmt(ok / it.length * 100, 0)}%` : '–', it2.length ? fmt(it2.reduce((s, x) => s + x, 0) / it2.length, 3) : '–'];
    });
    tbl.appendChild(table(['제어기', '실행', '성공률(지금까지)', 'ITAE 평균(지금까지)'], rows));
  };

  const drawResult = (res, info) => {
    charts.forEach((c) => c.destroy()); charts = [];
    clear(tbl); clear(bars);
    const cs = res.controllers.filter((c) => c.summary);
    // 제어기가 많으면 막대 이름이 겹치므로 한 줄에 그래프 하나
    bars.className = cs.length > 5 ? 'twin-bars-wide' : 'grid2';
    const pct = (v) => (v == null ? '–' : `${fmt(v * 100, 0)}%`);
    tbl.appendChild(table(
      ['제어기', '성공률', 'ITAE 평균', 'ITAE p10 / p50 / p90', '오버슈트 평균 (%)', '정착시간 평균 (s)', '마지막 오차 평균 (mm)', '포화 비율', '멈춤판 충돌', '발산', 'n'],
      cs.map((c) => {
        const s = c.summary;
        return [c.label + (c.complete ? '' : ' (일부)'), pct(s.success_rate), fmt(s.itae_mean, 3), `${fmt(s.itae_p10, 3)} / ${fmt(s.itae_p50, 3)} / ${fmt(s.itae_p90, 3)}`,
          fmt(s.po_mean, 1), fmt(s.ts_mean, 2), fmt(s.final_err_mm_mean, 1), fmt(s.u_sat_ratio_mean, 3), pct(s.end_hit_rate), pct(s.diverged_rate), s.n];
      })));
    const color = (c) => COLORS[res.controllers.indexOf(c) % COLORS.length];
    const mk = (title, unit, fn, sdf) => { const cell = h('div'); bars.appendChild(cell); charts.push(barChart(cell, cs.map((c) => ({ label: c.label, mean: fn(c.summary), sd: sdf ? sdf(c) : undefined, n: c.summary.n, color: color(c), hatch: true })), { title, unit, height: 180 })); };
    mk('성공률', '%', (s) => s.success_rate * 100);
    mk('ITAE 평균 ± 표준편차', 'm·s²', (s) => s.itae_mean, (c) => sd(c.runs.map((r) => r.itae)));
    mk('오버슈트 평균 ± 표준편차', '%', (s) => s.po_mean, (c) => sd(c.runs.map((r) => (r.stepinfo ? r.stepinfo.po : NaN))));
    mk('마지막 오차 평균', 'mm', (s) => s.final_err_mm_mean);
    // 분포(점): x = 제어기 번호 + 표본별 고정 흔들림
    const ser = [];
    cs.forEach((c, i) => {
      const okRuns = c.runs.filter((r) => r.success), bad = c.runs.filter((r) => !r.success);
      const jit = (r) => i + 1 + ((r.sample * 0.6180339) % 1 - 0.5) * 0.5;
      const mk1 = res.controllers.indexOf(c) < COLORS.length ? 'dot' : 'sq'; // 색이 한 바퀴 돌면 모양으로 구분
      ser.push({ label: `${i + 1}. ${c.label}`, x: okRuns.map(jit), y: okRuns.map((r) => r.itae), color: color(c), pointsOnly: true, marker: mk1, markerSize: 3.5 });
      ser.push({ label: `${c.label} 실패`, x: bad.map(jit), y: bad.map((r) => r.itae), color: color(c), pointsOnly: true, marker: 'x', markerSize: 3.5, noLegend: true });
    });
    pDist.setOpts({ xRange: [0.4, cs.length + 0.6] });
    pDist.setSeries(ser);
    clear(notes).append(
      `[시뮬레이션] 시나리오 ${res.scenario_id}, 표본 ${res.n}개(0 = 공칭), 시드 ${res.seed}(실행 시드 = 시드·1000 + 표본 번호), 변동 배율 ${res.variation_scale ?? 1}×. `,
      '모든 제어기에 같은 표본·같은 센서 시드를 씁니다(공통 난수 — 공정 비교). 성공 = 마지막 2 s 참 위치 오차 ≤ 10 mm, 멈춤판 충돌·발산 없음. ',
      '트윈 파라미터가 [가정]이므로 이 표는 "가정한 비이상성 아래에서의 상대 비교"이며 실측 우열의 근거가 아닙니다.',
      info ? ` 계산: ${info.mode === 'worker' ? 'Worker' : '주 스레드 청크'}, ${fmt(info.elapsed_ms / 1000, 1)} s${info.stopped ? ', 중간에 멈춤' : ''}.` : '');
    if (res.diverged_cases.length) {
      notes.appendChild(h('div', null, `발산 ${res.diverged_cases.length}건: ${res.diverged_cases.slice(0, 6).map((d) => `${d.label} 표본 ${d.sample}(시드 ${d.seed}, ${d.reason || ''})`).join(', ')}`));
    }
  };

  // ---------------------------------------------------------------- 실행
  const run = () => {
    if (handle && handle.running) return;
    clear(msg);
    const chosen = ctrls.filter((_, i) => on[i]);
    if (!chosen.length) { msg.appendChild(infoBox('제어기를 하나 이상 고르세요.')); return; }
    const spec = {
      scenario: sc, params: tp.params, controllers: chosen.map((c) => ({ id: c.id, params: c.params, label: c.label })),
      n, seed: seedProp ?? sc.seed, variation_scale: vScale, params_ref: tp.ref,
    };
    const total = n * chosen.length;
    btnRun.disabled = true; btnStop.disabled = false; btnJson.disabled = true;
    prog.textContent = `계산 준비 중… (0/${total})`;
    let last = 0;
    handle = startMonteCarlo(spec, {
      onProgress: (items, all) => {
        if (!alive) return;
        prog.textContent = `${all.length}/${total} 실행 (${handle && handle.mode === 'worker' ? 'Worker' : '주 스레드'})`;
        const now = Date.now();
        if (now - last > 250 || all.length === total) { last = now; drawPartial(all, chosen); }
      },
      onDone: (res, info) => {
        if (!alive) return;
        result = res;
        btnRun.disabled = false; btnStop.disabled = true; btnJson.disabled = false;
        prog.textContent = `완료: ${res.controllers.reduce((s, c) => s + c.runs.length, 0)}/${total} 실행${info.stopped ? ' (멈춤)' : ''}`;
        drawResult(res, info);
      },
      onError: (m) => { if (!alive) return; btnRun.disabled = false; btnStop.disabled = true; prog.textContent = ''; msg.appendChild(errorBox(`강건성 시험 오류: ${m}`)); },
    });
  };
  if (props.auto_run) run();
  else clear(tbl).appendChild(h('div', { class: 'muted' }, `"강건성 시험 실행"을 누르면 제어기 ${ctrls.length}개 × 표본 ${n}개를 계산합니다(실행 하나 약 20~60 ms, 화면은 멈추지 않습니다).`));

  return {
    unmount() { alive = false; if (handle && handle.running) handle.cancel(); charts.forEach((c) => c.destroy()); pDist.destroy(); },
    run,
    get result() { return result; },
    get running() { return !!(handle && handle.running); },
  };
}

export { CONTROLLER_PRESETS };
