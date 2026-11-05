// train_env.js — 강화학습·모방학습용 가상 볼앤빔 환경 (ai-extension §2.2)
//
// 플랜트는 simulate.stepPlant 그대로(공 + 가정 서보 1차·지연·속도 한계 + 빔 끝 정지).
// 측정 경로도 simulate 와 같다: 잡음 → 양자화 → 유실 → 재귀 필터 f ← f(1−α) + x·α.
// 관측은 obs.js 의 PolicyObserver(제어기와 같은 코드).
// 빔 끝(멈춤판)에서 공은 비탄성 정지하고 에피소드는 계속된다(terminate_on_end=false 기본).
// 보상은 시뮬레이터가 아는 참값(y, ẏ)으로 계산한다(학습 신호를 잡음에서 분리; 정책 입력은 측정값만).
// 도메인 랜덤화: 에피소드마다 K_b 배율·서보 τ·추가 지연·센서 잡음을 균등 추출(심투리얼 간극 대비).
import { stepPlant, initPlantState } from '../simulate.js';
import { makeModel, ASSUMED_SERVO } from '../plant.js';
import { rng } from '../linalg.js';
import { PolicyObserver } from './obs.js';

export const DEFAULT_ENV = Object.freeze({
  Ts_s: 0.06, t_end_s: 10, substeps: 4, model: 'ball_servo',
  y0_range_m: [0.06, 0.28], y0_rel_range_m: null /* [a, b] 이면 y0 = ref + U(a, b) (시연 분포 좁히기) */, ref_range_m: [0.12, 0.23], ref_switch_prob: 0.5, ref_switch_t_s: [3, 6],
  y_min_m: 0.02, y_max_m: 0.33, terminate_on_end: false,
  noise_m: 0.001, quant_m: 0.001, lost_prob: 0.01, alpha: 0.2,
  domain: null,
});

export const DEFAULT_DOMAIN = Object.freeze({ kb_scale: [0.8, 1.2], tau_s: [0.04, 0.10], delay_s: [0, 0.04], noise_m: [0, 0.002] });

export const REWARD = Object.freeze({ w_e: 1, e_scale_m: 0.05, w_v: 0.1, v_scale_m_s: 0.2, w_u: 0.01, w_du: 0.05, end_penalty: 3 });

export const REWARD_INFO = Object.freeze({
  formula_tex: 'r_k = -\\left[ w_e\\left(\\tfrac{e}{0.05}\\right)^2 + w_v\\left(\\tfrac{\\dot y}{0.2}\\right)^2 + w_u\\left(\\tfrac{u}{u_{lim}}\\right)^2 + w_{\\Delta u}\\left(\\tfrac{\\Delta u}{u_{lim}}\\right)^2 \\right] - 3\\cdot\\mathbb{1}[\\text{공이 빔 끝 멈춤판에 닿음}]',
  terms: [
    { key: 'e', label: '위치 오차', weight: REWARD.w_e },
    { key: 'v', label: '속도', weight: REWARD.w_v },
    { key: 'u', label: '입력 크기', weight: REWARD.w_u },
    { key: 'du', label: '입력 변화', weight: REWARD.w_du },
    { key: 'end', label: '빔 끝 접촉(스텝마다)', weight: REWARD.end_penalty },
  ],
});

const uni = (R, [a, b]) => a + (b - a) * R.uniform();

/** 환경 설정에서 모델(서보 τ 변경 포함) 만들기 */
export function envModel(opts, tau_s = null) {
  const o = { ...DEFAULT_ENV, ...opts };
  if (o.model === 'ball_only') return makeModel({});
  return makeModel({ servo_tf: { ...ASSUMED_SERVO, tau_s: tau_s ?? ASSUMED_SERVO.tau_s } });
}

export class BallBeamEnv {
  constructor(opts = {}) {
    this.opts = { ...DEFAULT_ENV, ...opts };
    if (this.opts.domain === true) this.opts.domain = { ...DEFAULT_DOMAIN };
    this.R = rng(this.opts.seed ?? 12345);
    this.baseModel = envModel(this.opts);
    this.u_lim_rad = this.baseModel.u_lim_rad;
    this.nMax = Math.round(this.opts.t_end_s / this.opts.Ts_s);
    this.obsv = new PolicyObserver();
  }

  get domainSample() { return { ...this.dom }; }

  /** 에피소드 시작. seed(정수)를 주면 그 에피소드가 재현된다 → 관측 [e, v, u_prev] */
  reset(seed) {
    const o = this.opts;
    const s = Number.isInteger(seed) ? seed : Math.floor(this.R.uniform() * 2 ** 31);
    const R = rng((Math.imul(s | 0, 0x9e3779b1) + 97) >>> 0);
    this.Re = R;
    const D = o.domain;
    this.dom = {
      kb_scale: D && D.kb_scale ? uni(R, D.kb_scale) : 1,
      tau_s: D && D.tau_s ? uni(R, D.tau_s) : ASSUMED_SERVO.tau_s,
      delay_s: D && D.delay_s ? uni(R, D.delay_s) : 0,
      noise_m: D && D.noise_m ? uni(R, D.noise_m) : o.noise_m,
    };
    this.model = o.model === 'ball_only' || !D || !D.tau_s ? this.baseModel : envModel(o, this.dom.tau_s);
    let y0 = uni(R, o.y0_range_m);
    this.ref = uni(R, o.ref_range_m);
    if (o.y0_rel_range_m) y0 = this.ref + uni(R, o.y0_rel_range_m);
    this.ref2 = R.uniform() < o.ref_switch_prob ? uni(R, o.ref_range_m) : null;
    this.tSwitch = this.ref2 == null ? Infinity : uni(R, o.ref_switch_t_s);
    this.st = initPlantState(this.model, { y_m: y0, ydot_m_s: 0 });
    this.k = 0;
    this.t = 0;
    this.u = 0;
    this.filt = NaN;
    this.done = false;
    this.obsv.reset(NaN, 0);
    this.yMeas = this._measure();
    this.obs = this.obsv.update(this.ref, this.yMeas, o.Ts_s, 0);
    return this.obs.slice();
  }

  _measure() {
    const o = this.opts, R = this.Re;
    let raw = this.st.y_m;
    if (this.dom.noise_m > 0) raw += this.dom.noise_m * R.normal();
    if (o.quant_m > 0) raw = Math.round(raw / o.quant_m) * o.quant_m;
    if (o.lost_prob > 0 && R.uniform() < o.lost_prob) { this.yRaw = NaN; return NaN; }
    this.yRaw = raw;
    this.filt = Number.isNaN(this.filt) ? raw : this.filt * (1 - o.alpha) + raw * o.alpha;
    return this.filt;
  }

  refAt(t) { return t >= this.tSwitch ? this.ref2 : this.ref; }

  /** → { obs, reward, done, info } */
  step(u_rad) {
    if (this.done) throw new Error('BallBeamEnv.step: 에피소드가 끝났음 — reset() 필요');
    const o = this.opts;
    const lim = this.u_lim_rad;
    let u = Number.isFinite(u_rad) ? Math.max(-lim, Math.min(lim, u_rad)) : this.u;
    const du = u - this.u;
    const ref = this.refAt(this.t);
    stepPlant(this.st, u, o.Ts_s, this.model, { substeps: o.substeps, kb_scale: this.dom.kb_scale, delay_s: this.dom.delay_s,
      y_min_m: o.y_min_m, y_max_m: o.y_max_m });
    this.k += 1;
    this.t = this.k * o.Ts_s;
    this.u = u;
    // 보상(참값): 이번 구간의 설정값 기준
    const e = ref - this.st.y_m, v = this.st.ydot_m_s;
    const W = REWARD, sc = o.Ts_s / 0.06;
    const terms = {
      e: W.w_e * (e / W.e_scale_m) ** 2 * sc,
      v: W.w_v * (v / W.v_scale_m_s) ** 2 * sc,
      u: W.w_u * (u / lim) ** 2 * sc,
      du: W.w_du * (du / lim) ** 2 * sc,
      end: 0,
    };
    // 빔 끝 접촉: 이번 스텝 끝에 공이 멈춤판에 붙어 있으면 벌점(스텝마다). 조기 종료는 기본으로 하지 않는다 —
    // 종료하면 남은 시간의 비용이 사라져 "일부러 떨어뜨리기"가 이득이 되는 왜곡이 생긴다.
    const endHit = this.st.y_m <= o.y_min_m + 1e-9 || this.st.y_m >= o.y_max_m - 1e-9;
    if (endHit) terms.end = W.end_penalty * sc;
    const reward = -(terms.e + terms.v + terms.u + terms.du + terms.end);
    this.done = this.k >= this.nMax || (endHit && o.terminate_on_end);
    this.yMeas = this._measure();
    this.obs = this.obsv.update(this.refAt(this.t), this.yMeas, o.Ts_s, u);
    return {
      obs: this.obs.slice(), reward, done: this.done,
      info: { y_m: this.st.y_m, ydot_m_s: this.st.ydot_m_s, theta_rad: this.st.theta_rad, ref_m: this.refAt(this.t), y_meas_m: this.yMeas,
        end_hit: endHit, t_s: this.t, terms },
    };
  }
}

/**
 * 한 에피소드 실행. policyFn(obs, env) → u_rad
 * @returns {{ t_s, ref_m, y_m, y_meas_m, u_rad, reward, obs, return, end_hit, length }}
 */
export function rollout(env, policyFn, { seed, record = true } = {}) {
  let obs = env.reset(seed);
  const out = { t_s: [], ref_m: [], y_m: [], y_meas_m: [], u_rad: [], reward: [], obs: [], return: 0, end_hit: false, length: 0, domain: env.domainSample };
  let done = false;
  while (!done) {
    const u = policyFn(obs, env);
    if (record) {
      out.t_s.push(env.t); out.ref_m.push(env.refAt(env.t)); out.y_m.push(env.st.y_m); out.y_meas_m.push(env.yMeas); out.obs.push(obs);
    }
    const r = env.step(u);
    if (record) { out.u_rad.push(env.u); out.reward.push(r.reward); }
    out.return += r.reward;
    out.length += 1;
    obs = r.obs;
    done = r.done;
    if (r.info.end_hit) out.end_hit = true;
  }
  return out;
}

/** 궤적의 위치 RMSE (참값 기준) */
export function trajRmse(ro) {
  let s = 0;
  for (let k = 0; k < ro.y_m.length; k++) s += (ro.ref_m[k] - ro.y_m[k]) ** 2;
  return Math.sqrt(s / Math.max(1, ro.y_m.length));
}
