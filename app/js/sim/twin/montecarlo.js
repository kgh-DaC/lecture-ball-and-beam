// montecarlo.js — 트윈 강건성 시험: 파라미터 표본 × 제어기 반복 실행 → 분포 요약
//
// - 표본: 시나리오 param_variation(또는 opts.variation)의 범위에서 균일 표본. 상대 키는 배율 1 + U(−v, v),
//   절대 키(level_offset_deg)는 U(−v, v) 를 더한다. 표본 0 은 항상 공칭(변동 없음).
// - 공통 난수: 모든 제어기가 같은 표본 집합과 같은 센서 시드(seed·1000 + i)를 쓴다(공정 비교).
// - 지표 이름은 control/ai/evaluate.compareControllers 와 같다(success_rate, itae_mean, iae_mean, po_mean,
//   ts_mean, u_tv_mean, fallback_ratio_mean, n) + 트윈 추가(u_sat_ratio_mean, diverged_rate, end_hit_rate,
//   itae_p10/p50/p90, final_err_mm_mean).
// - 발산(diverged) 실행은 조용히 버리지 않고 diverged_cases 에 시나리오·표본·시드와 함께 남긴다.
import { runScenario, normalizeScenario } from './scenario.js';
import { VARIATION_KEYS, OFFSET_KEYS } from './twin.js';
import { makeRng, subSeed } from './sensor.js';
import { getController } from '../../control/registry.js';

/**
 * 변동 표본 n 개 (첫 번째 = 공칭)
 * @param variation { [키]: 범위 } (상대: 0.2 = ±20 %, 절대 level_offset_deg: 0.3 = ±0.3°)
 * @returns [{ index, scales, offsets }]
 */
export function sampleVariations(variation = {}, n = 20, seed = 1) {
  const keys = Object.keys(variation).sort();
  for (const k of keys) if (!(VARIATION_KEYS[k] || OFFSET_KEYS[k] || k.includes('.'))) throw new Error(`알 수 없는 변동 키: ${k}`);
  const R = makeRng(subSeed(seed, 'montecarlo.params'));
  const out = [{ index: 0, scales: {}, offsets: {} }];
  for (let i = 1; i < Math.max(1, n); i++) {
    const scales = {}, offsets = {};
    for (const k of keys) {
      const v = Math.abs(variation[k]);
      const u = 2 * R.uniform() - 1;
      if (OFFSET_KEYS[k]) offsets[k] = u * v;
      else scales[k] = Math.max(0, 1 + u * v);
    }
    out.push({ index: i, scales, offsets });
  }
  return out;
}

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => { const f = a.filter(fin); return f.length ? f.reduce((s, x) => s + x, 0) / f.length : null; };
function quantile(a, q) {
  const f = a.filter(fin).sort((x, y) => x - y);
  if (!f.length) return null;
  const pos = (f.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return f[lo] + (f[hi] - f[lo]) * (pos - lo);
}

/** 실행 목록 → 요약 */
export function summarizeRuns(runs) {
  const m = runs.map((r) => r.metrics);
  const itae = m.map((x) => x.itae);
  return {
    success_rate: runs.length ? m.filter((x) => x.success).length / runs.length : 0,
    itae_mean: mean(itae), iae_mean: mean(m.map((x) => x.iae)),
    po_mean: mean(m.map((x) => x.stepinfo.po)), ts_mean: mean(m.map((x) => x.stepinfo.ts)),
    u_tv_mean: mean(m.map((x) => x.u_tv_rad)), fallback_ratio_mean: mean(m.map((x) => x.fallback_ratio)),
    u_sat_ratio_mean: mean(m.map((x) => x.u_sat_ratio)),
    diverged_rate: runs.length ? runs.filter((r) => r.status === 'diverged').length / runs.length : 0,
    end_hit_rate: runs.length ? m.filter((x) => x.end_hit).length / runs.length : 0,
    final_err_mm_mean: mean(m.map((x) => x.final_err_mm)),
    itae_p10: quantile(itae, 0.1), itae_p50: quantile(itae, 0.5), itae_p90: quantile(itae, 0.9),
    n: runs.length,
  };
}

/**
 * 몬테카를로 강건성 시험
 * @param opts {
 *   scenario, params, controllers: [{ id, params?, label? }],
 *   n = 20, seed = scenario.seed, variation = scenario.param_variation,
 *   params_ref = 'unknown', design_servo?, keep_records = false (true면 runs[i].record 보존 — 메모리 큼),
 *   onProgress?: (done, total) => void
 * }
 * @returns MonteCarloResult (docs/spec/digital-twin.md §7)
 */
export function runMonteCarlo(opts) {
  const sc = normalizeScenario(opts.scenario);
  const seed = (opts.seed ?? sc.seed) >>> 0 || 1;
  const n = Math.max(1, opts.n ?? 20);
  const variation = opts.variation ?? sc.param_variation;
  const samples = sampleVariations(variation, n, seed);
  const total = samples.length * opts.controllers.length;
  let done = 0;
  const diverged_cases = [];
  let despikeMode = null;       // 실제로 쓴 펌웨어 despike(시나리오 loop.despike 또는 params loop.despike)
  const controllers = opts.controllers.map((c) => {
    const C = getController(c.id);
    const runs = samples.map((s) => {
      const runSeed = seed * 1000 + s.index;
      const r = runScenario({
        scenario: sc, params: opts.params, controller: { id: c.id, params: c.params || {} },
        seed: runSeed, scales: s.scales, offsets: s.offsets, design_servo: opts.design_servo || null, keep_debug: true,
      });
      done++;
      if (opts.onProgress) opts.onProgress(done, total);
      if (r.status === 'diverged') diverged_cases.push({ controller: c.id, label: c.label || C.meta.label, sample: s.index, seed: runSeed, scenario_id: sc.id, reason: r.diverged?.reason });
      if (despikeMode == null) despikeMode = r.despike.mode;
      const out = { sample: s.index, seed: runSeed, status: r.status, metrics: r.metrics };
      if (opts.keep_records) out.record = r.record;
      return out;
    });
    return {
      id: c.id, label: c.label || C.meta.label, params: { ...(c.params || {}) },
      runs: runs.map((r) => ({
        sample: r.sample, seed: r.seed, status: r.status, success: r.metrics.success,
        itae: r.metrics.itae, iae: r.metrics.iae, stepinfo: r.metrics.stepinfo, u_tv_rad: r.metrics.u_tv_rad,
        u_sat_ratio: r.metrics.u_sat_ratio, fallback_ratio: r.metrics.fallback_ratio, end_hit: r.metrics.end_hit,
        lost_ratio: r.metrics.lost_ratio, final_err_mm: r.metrics.final_err_mm, disturbances: r.metrics.disturbances,
        ...(r.record ? { record: r.record } : {}),
      })),
      summary: summarizeRuns(runs),
    };
  });
  return {
    schema_ver: 1, kind: 'twin_montecarlo', provenance: 'simulated',
    scenario_id: sc.id, seed, n: samples.length, params_ref: opts.params_ref || 'unknown',
    variation: { ...variation },
    despike: despikeMode,
    samples,
    controllers,
    diverged_cases,
  };
}
