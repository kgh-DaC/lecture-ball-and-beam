// 몬테카를로 강건성 시험을 "한 번에 실행 하나씩" 나눠 돌리는 작업(job).
// 계산은 sim/twin/montecarlo.js(sampleVariations, summarizeRuns)·scenario.js(runScenario)를 그대로 호출하고,
// 반환 형식은 runMonteCarlo 와 같다(docs/spec/digital-twin.md §7). runMonteCarlo 는 동기 함수라 화면이 멈추므로
// Worker(mc-worker.js) 또는 주 스레드 setTimeout 청크(mc-runner.js)가 step() 을 조금씩 부른다.
// 같은 입력이면 runMonteCarlo 와 같은 결과(tests/web/twin.test.mjs 에서 대조).

import { sampleVariations, summarizeRuns } from '../../sim/twin/montecarlo.js';
import { runScenario, normalizeScenario } from '../../sim/twin/scenario.js';
import { getController } from '../../control/registry.js';

/**
 * spec: { scenario, params, controllers: [{ id, params?, label? }], n=20, seed?, variation?, variation_scale=1, params_ref?, design_servo? }
 * 반환 { step(maxRuns) → 진행 항목[], done, total, finished, result() → MonteCarloResult, history }
 */
export function createMcJob(spec) {
  const sc = normalizeScenario(spec.scenario);
  const seed = (spec.seed ?? sc.seed) >>> 0 || 1;
  const n = Math.max(1, spec.n ?? 20);
  const vs = spec.variation_scale ?? 1;
  const baseVar = spec.variation ?? sc.param_variation;
  const variation = {};
  for (const [k, v] of Object.entries(baseVar || {})) variation[k] = v * vs;
  const samples = sampleVariations(variation, n, seed);
  const ctrls = spec.controllers.map((c) => {
    const C = getController(c.id);
    return { id: c.id, label: c.label || C.meta.label, params: { ...(c.params || {}) }, runs: [] };
  });
  const total = samples.length * ctrls.length;
  const diverged_cases = [];
  const history = [];
  let ci = 0, si = 0, finished = 0;
  const job = {
    total, history,
    get done() { return finished >= total; },
    get finished() { return finished; },
    step(maxRuns = 1) {
      const items = [];
      for (let k = 0; k < maxRuns && finished < total; k++) {
        const c = ctrls[ci], s = samples[si];
        const runSeed = seed * 1000 + s.index;
        const r = runScenario({
          scenario: sc, params: spec.params, controller: { id: c.id, params: c.params },
          seed: runSeed, scales: s.scales, offsets: s.offsets, design_servo: spec.design_servo || null, keep_debug: true,
        });
        if (r.status === 'diverged') diverged_cases.push({ controller: c.id, label: c.label, sample: s.index, seed: runSeed, scenario_id: sc.id, reason: r.diverged?.reason });
        c.runs.push({ sample: s.index, seed: runSeed, status: r.status, metrics: r.metrics });
        finished++;
        const it = { controller: ci, label: c.label, sample: s.index, status: r.status, success: r.metrics.success, itae: r.metrics.itae, po: r.metrics.stepinfo.po, finished, total };
        items.push(it); history.push(it);
        si++;
        if (si >= samples.length) { si = 0; ci++; }
      }
      return items;
    },
    result() {
      return {
        schema_ver: 1, kind: 'twin_montecarlo', provenance: 'simulated',
        scenario_id: sc.id, seed, n: samples.length, params_ref: spec.params_ref || 'unknown',
        variation: { ...variation }, variation_scale: vs,
        samples,
        controllers: ctrls.map((c) => ({
          id: c.id, label: c.label, params: c.params,
          runs: c.runs.map((r) => ({
            sample: r.sample, seed: r.seed, status: r.status, success: r.metrics.success,
            itae: r.metrics.itae, iae: r.metrics.iae, stepinfo: r.metrics.stepinfo, u_tv_rad: r.metrics.u_tv_rad,
            u_sat_ratio: r.metrics.u_sat_ratio, fallback_ratio: r.metrics.fallback_ratio, end_hit: r.metrics.end_hit,
            lost_ratio: r.metrics.lost_ratio, final_err_mm: r.metrics.final_err_mm, disturbances: r.metrics.disturbances,
          })),
          summary: c.runs.length ? summarizeRuns(c.runs) : null,
          complete: c.runs.length === samples.length,
        })),
        diverged_cases,
        partial: finished < total,
      };
    },
  };
  return job;
}
