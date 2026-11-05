// evaluate.js — 제어기 비교 (ai-extension §2.9, 20장 ai-compare 위젯)
//
// 같은 프로파일(기본 P1)·같은 무작위 모델 집합에서 여러 제어기를 simulate 로 돌려 지표를 모은다.
//   - 모델 집합: domain(DomainRandomization) 이 있으면 rng(seed) 로 n_domains 개를 뽑는다(모든 제어기에 같은 집합).
//     첫 번째는 항상 공칭 모델(kb 1, τ 공칭, 추가 지연 0, 잡음 공칭) — 공칭 성능과 강인성을 한 표에서 보게.
//     domain 이 null 이면 공칭 하나만.
//   - 제어기는 "공칭 모델"로 만든다(LQR 등 모델 기반 설계는 실제 플랜트 변화를 모른다 = 공정한 강인성 비교).
//   - 지표: store/metrics.stepInfo(지표 정의 한 곳)를 스텝 시각 이후 구간에 적용. ITAE·IAE 는 스텝 시각 기준, SI 단위.
//   - success = 빔 끝 충돌 없음 & 5 % 띠 안에 정착(ts_settled). 정착은 store/metrics def_ver 2 정의:
//     마지막 띠 이탈 뒤 관찰 끝까지 띠 안에 머문 시간이 min_dwell_s 이상(기본 min(1 s, 관찰 길이/4) — P1은 1 s).
//     한계 순환 중 마지막 샘플만 우연히 띠 안인 경우(거짓 성공)를 세지 않는다(ai-control.md §4.1).
//   - fallback_ratio = debug.fallback 이 참인 샘플 비율(AI 제어기만, 그 외 0).
// 시뮬레이션 결과다(가정 서보 ASSUMED_SERVO). 실측 비교가 아니다.
import { simulate, profileDuration } from '../simulate.js';
import { getController } from '../registry.js';
import { makeModel, ASSUMED_SERVO } from '../plant.js';
import { rng } from '../linalg.js';
import { stepInfo } from '../../store/metrics.js';
import { DEFAULT_DOMAIN } from './train_env.js';

export const P1 = Object.freeze({ type: 'step', from_mm: 150, to_mm: 200, pre_s: 2, hold_s: 8 });
/** 비교용 센서(가상 장치 기본값과 같음) */
export const COMPARE_SENSOR = Object.freeze({ Ts_s: 0.06, alpha: 0.2, noise_m: 0.001, quant_m: 0.001, lost_prob: 0.01 });

const uni = (R, [a, b]) => a + (b - a) * R.uniform();

/** 무작위 모델 집합 → [{ kb_scale, tau_s, delay_s, noise_m }] (첫 항목 = 공칭) */
export function sampleDomains({ domain = null, n_domains = 8, seed = 1, model = 'ball_servo' } = {}) {
  const nominal = { kb_scale: 1, tau_s: model === 'ball_servo' ? ASSUMED_SERVO.tau_s : null, delay_s: 0, noise_m: COMPARE_SENSOR.noise_m };
  if (!domain) return [nominal];
  const D = domain === true ? DEFAULT_DOMAIN : domain;
  const R = rng(seed * 7 + 3);
  const out = [nominal];
  for (let i = 1; i < Math.max(1, n_domains); i++) {
    out.push({
      kb_scale: D.kb_scale ? uni(R, D.kb_scale) : 1,
      tau_s: model === 'ball_servo' ? (D.tau_s ? uni(R, D.tau_s) : ASSUMED_SERVO.tau_s) : null,
      delay_s: D.delay_s ? uni(R, D.delay_s) : 0,
      noise_m: D.noise_m ? uni(R, D.noise_m) : COMPARE_SENSOR.noise_m,
    });
  }
  return out;
}

function modelFor(kind, dom, noise) {
  const sensor = { ...COMPARE_SENSOR, noise_m: noise ? dom.noise_m : 0, ...(noise ? {} : { quant_m: 0, lost_prob: 0 }) };
  if (kind === 'ball_only') return makeModel({ sensor });
  return makeModel({ servo_tf: { ...ASSUMED_SERVO, tau_s: dom.tau_s ?? ASSUMED_SERVO.tau_s }, sensor });
}

/**
 * 한 번 실행 + 지표.
 * @returns {{ sim, domain, stepinfo: {tr, po, ts, ess, ts_settled, ts_dwell_s, min_dwell_s}, itae, iae, u_tv_rad, end_hit, fallback_ratio, success }}
 */
export function runOne({ id, params = {} }, { profile = P1, domain: dom = null, model = 'ball_servo', noise = true, seed = 1, min_dwell_s = undefined } = {}) {
  const d = dom || sampleDomains({ model })[0];
  const plant = modelFor(model, d, noise);
  const nominal = modelFor(model, sampleDomains({ model })[0], noise);
  const C = getController(id);
  const Ts = plant.sensor.Ts_s;
  const ctrl = new C(params, { model: nominal, Ts_s: Ts, u_lim_rad: plant.u_lim_rad, mode: 'sim' });
  const y0 = profile.type === 'step' ? profile.from_mm / 1000 : undefined;
  const ref0 = profile.type === 'step' ? (profile.pre_s > 0 ? profile.from_mm : profile.to_mm) / 1000 : undefined;
  ctrl.reset({ t_s: 0, ref_m: ref0, y_m: y0, u_rad: 0, theta_rad: 0 });
  const sim = simulate(plant, ctrl, profile, { noise, seed, kb_scale: d.kb_scale, delay_s: d.delay_s, t_end_s: profileDuration(profile) });
  const t0 = profile.type === 'step' ? profile.pre_s ?? 0 : 0;
  const tt = [], yy = [];
  let itae = 0, iae = 0, utv = 0, nfb = 0;
  for (let k = 0; k < sim.t_s.length; k++) {
    if (k > 0) {
      const dt = sim.t_s[k] - sim.t_s[k - 1];
      if (sim.t_s[k] > t0 + 1e-9) {
        const ae = Math.abs(sim.ref_m[k] - sim.y_m[k]);
        iae += ae * dt;
        itae += (sim.t_s[k] - t0) * ae * dt;
      }
      utv += Math.abs(sim.u_rad[k] - sim.u_rad[k - 1]);
    }
    if (sim.debug[k] && sim.debug[k].fallback) nfb++;
    if (sim.t_s[k] >= t0 - 1e-9) { tt.push(sim.t_s[k]); yy.push(sim.y_m[k]); }
  }
  const si = stepInfo(tt, yy, sim.ref_m[sim.ref_m.length - 1], { min_dwell_s });
  const fallback_ratio = nfb / sim.t_s.length;
  return {
    sim, domain: { ...d },
    stepinfo: { tr: si.tr, po: si.po, ts: si.ts, ess: si.ess, ts_settled: !!si.ts_settled, ts_dwell_s: si.ts_dwell_s, min_dwell_s: si.min_dwell_s },
    itae, iae, u_tv_rad: utv, end_hit: !!sim.end_hit, fallback_ratio,
    success: !sim.end_hit && !!si.ts_settled,
  };
}

const mean = (a) => { const f = a.filter(Number.isFinite); return f.length ? f.reduce((s, x) => s + x, 0) / f.length : null; };

/**
 * 여러 제어기 비교.
 * @param list [{ id, params?, label? }]
 * @param opts { profile = P1, domain = null | true | DomainRandomization, n_domains = 8, seed = 1, model = 'ball_servo', noise = true,
 *               keep_sims = false (true면 runs[i].sim 을 남김 — 대표 궤적 그리기용, 메모리 큼),
 *               min_dwell_s = undefined (정착 인정 최소 유지 시간 s, 생략 = metrics 기본 규칙) }
 * @returns [{ id, label, params, runs: [{ domain, stepinfo, itae, iae, u_tv_rad, end_hit, fallback_ratio, success, sim? }],
 *            summary: { success_rate, itae_mean, iae_mean, po_mean, ts_mean, u_tv_mean, fallback_ratio_mean, n } }]
 *   단위: itae m·s², iae m·s, po %, ts s(스텝 시각 기준), u_tv rad
 */
export function compareControllers(list, { profile = P1, domain = null, n_domains = 8, seed = 1, model = 'ball_servo', noise = true, keep_sims = false, min_dwell_s = undefined } = {}) {
  const doms = sampleDomains({ domain, n_domains, seed, model });
  return list.map((c, ci) => {
    const runs = doms.map((d, di) => {
      const r = runOne(c, { profile, domain: d, model, noise, seed: seed * 1000 + di, min_dwell_s });
      if (!keep_sims) delete r.sim;
      return r;
    });
    return {
      id: c.id, label: c.label || getController(c.id).meta.label, params: { ...(c.params || {}) }, runs,
      summary: {
        success_rate: runs.filter((r) => r.success).length / runs.length,
        itae_mean: mean(runs.map((r) => r.itae)),
        iae_mean: mean(runs.map((r) => r.iae)),
        po_mean: mean(runs.map((r) => r.stepinfo.po)),
        ts_mean: mean(runs.map((r) => r.stepinfo.ts)),
        u_tv_mean: mean(runs.map((r) => r.u_tv_rad)),
        fallback_ratio_mean: mean(runs.map((r) => r.fallback_ratio)),
        n: runs.length,
      },
      _index: ci,
    };
  }).map(({ _index, ...x }) => x);
}
