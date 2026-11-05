// servo.js — 디지털 트윈의 서보(명령 경로 + 모터 + 링크) 모델 (순수, SI 단위)
//
// 명령 경로 (펌웨어 → 서보)
//   cmd_cdeg(정수, ±lim) → 펄스 µs = round(pmin + (90 + cdeg/100)/180·(pmax − pmin))   (pwm_quantize)
//   → 서보 전자회로가 PWM 프레임(pwm_frame_s, Servo.h 20 ms)마다 펄스를 읽는다(프레임 샘플링)
//   → 내부 지연 T_d 뒤 목표각 θ_t = K·θ_cmd,eff
// 모터 (출력축 θ_m, 포텐쇼미터가 재는 각)
//   e = θ_t − θ_m,  |e| ≤ δ/2 이면 θ̇_m = 0 (데드밴드 δ)
//   그 밖은 θ̇_m = clamp((e − sgn(e)·δ/2)/τ, ±ω_max)          (1차 + 속도 한계)
//   |θ_m| ≤ θ_lim (기계 한계)
// 링크 (출력축 → 빔 레버): 백래시 β (유격 연산자)
//   θ_b ← θ_m − β/2  (θ_m − θ_b > β/2),  θ_m + β/2  (θ_b − θ_m > β/2),  그 밖은 유지
//
// δ = β = 0, 프레임 0, 양자화 끔이면 plant.js 의 fo_slew(τθ̇ = K u(t−Td) − θ, |θ̇| ≤ vmax)와 같다.

/** 유격 연산자: 출력축 θ_m 에 대한 링크 출력 θ_b (저장값 prev 기준) */
export function play(theta_m, prev, beta) {
  if (!(beta > 0)) return theta_m;
  const h = beta / 2;
  if (theta_m - prev > h) return theta_m - h;
  if (prev - theta_m > h) return theta_m + h;
  return prev;
}

/** cdeg 명령 → 서보가 실제로 받는 각(µs 양자화) [rad] */
export function quantizeCmd(cmd_rad, servo) {
  if (!servo.pwm_quantize) return cmd_rad;
  const span = servo.pmax_us - servo.pmin_us;
  const deg = 90 + (cmd_rad * 180) / Math.PI;
  const us = Math.round(servo.pmin_us + (deg / 180) * span);
  return (((us - servo.pmin_us) / span) * 180 - 90) * (Math.PI / 180);
}

export class ServoModel {
  /** @param servo normalizeParams(...).servo */
  constructor(servo) {
    this.p = servo;
    this.reset(0, 0);
  }

  reset(theta_rad = 0, t_s = 0) {
    this.theta_m = theta_rad;
    this.theta_b = theta_rad;
    this.omega = 0;
    const u = (this.p.K || 1) !== 0 ? theta_rad / (this.p.K || 1) : 0;
    // 명령 이력 [{ t_s, u_rad }] (u_rad = 양자화 후 명령각)
    this.hist = [{ t_s: -1e9, u_rad: u }];
    this.t_last_cmd = t_s;
  }

  /** 시각 t_s 에 명령 u_rad(펌웨어가 적용한 각, 제한 후) */
  command(t_s, u_rad) {
    const q = quantizeCmd(u_rad, this.p);
    const last = this.hist[this.hist.length - 1];
    if (last.u_rad === q) return;
    if (t_s <= last.t_s) { last.u_rad = q; return; }
    this.hist.push({ t_s, u_rad: q });
  }

  /** 시각 t 의 서보 목표 출력축 각 θ_t [rad] (프레임 샘플링 + 지연 반영) */
  targetAt(t) {
    const p = this.p;
    let ts = t - p.Td_s + 1e-12;
    if (p.pwm_frame_s > 0) ts = Math.floor((ts - p.pwm_phase_s) / p.pwm_frame_s) * p.pwm_frame_s + p.pwm_phase_s + 1e-12;
    const h = this.hist;
    let u = h[0].u_rad;
    for (let i = h.length - 1; i >= 0; i--) { if (h[i].t_s <= ts) { u = h[i].u_rad; break; } }
    return (p.K ?? 1) * u;
  }

  /** 오래된 명령 정리 */
  prune(t) {
    const keep = t - this.p.Td_s - Math.max(0, this.p.pwm_frame_s) - 0.05;
    while (this.hist.length > 2 && this.hist[1].t_s <= keep) this.hist.shift();
  }

  /** 출력축 속도 θ̇_m (θ_m, 목표 θ_t 에서) */
  velocity(theta_m, target) {
    const p = this.p;
    const e = target - theta_m;
    const hd = (p.deadband_rad || 0) / 2;
    if (Math.abs(e) <= hd) return 0;
    let v = (e - Math.sign(e) * hd) / p.tau_s;
    if (p.vmax_rad_s > 0) v = Math.max(-p.vmax_rad_s, Math.min(p.vmax_rad_s, v));
    if (Number.isFinite(p.theta_lim_rad)) {
      if (theta_m >= p.theta_lim_rad && v > 0) v = 0;
      if (theta_m <= -p.theta_lim_rad && v < 0) v = 0;
    }
    return v;
  }

  /** 링크 출력각 (현재 저장된 θ_b 기준, θ_m 후보에 대해) */
  linkOut(theta_m) { return play(theta_m, this.theta_b, this.p.backlash_rad); }

  /** 적분 스텝 끝 상태 확정 */
  commit(theta_m, omega) {
    const lim = this.p.theta_lim_rad;
    this.theta_m = Number.isFinite(lim) ? Math.max(-lim, Math.min(lim, theta_m)) : theta_m;
    const nb = play(this.theta_m, this.theta_b, this.p.backlash_rad);
    this.omega_b = nb !== this.theta_b ? omega : 0;
    this.theta_b = nb;
    this.omega = omega;
  }

  /** 외란: 링크(빔)를 쳐서 출력축을 dθ 만큼 밀어낸다(서보가 다시 목표로 돌아간다) */
  knock(dtheta_rad) {
    this.theta_m += dtheta_rad;
    this.theta_b += dtheta_rad;
  }
}
