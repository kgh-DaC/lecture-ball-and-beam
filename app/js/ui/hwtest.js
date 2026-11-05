// 조립 전·후 하드웨어 시험 공용 모듈(위젯 아님): 판정 기준 상수와 근거, 순수 분석 함수, 벤치 모드 시험 실행기.
// 위젯: pot-mapping-test(조립 전, 벤치), servo-center-assist(조립용 90° 고정), level-trim(조립 후 수평),
//       sensor-position-test(조립 후 초음파 위치 응답), hardware-steps(점검 순서).
// 좌표: deg_servo = 90 + trim/100 + dir·cmd/100 (firmware cmdToMicros). 벤치 시험은 trim 0·dir 1 로 두므로 cmd = (서보각 − 90°)·100.

import { cmd } from '../serial/writer.js';
import { HEARTBEAT_MS } from '../config/defaults.js';
import { BENCH_HARD_LIM_CDEG } from '../serial/device.js';
import { fitPotLine, rawAtServoDeg } from '../config/servo-presets.js';
import { robustDistStats } from './widgets/signal-monitor.js';

// ------------------------------------------------------------------ 판정 기준(상수, 근거)
/**
 * 포텐쇼미터 매핑 시험(조립 전) 기준. 기준 기울기 ≈ 2.99 LSB/°(사용자 실측) → 1° ≈ 3 LSB.
 * - POT_SD_MAX_LSB 3: 같은 각도로 N회 오갈 때 평균값의 σ. 3 LSB ≈ 1° — 서보 데드밴드(수 µs ≈ 0.2~0.5°)와
 *   ADC 잡음(±1~2 LSB)을 합쳐도 1° 안이면 위치 제어(수평 ±1° 판단)에 쓸 수 있다. 넘으면 기어 백래시·전원 흔들림·와이퍼 접촉 불량 의심.
 * - POT_REF_ERR_MAX_LSB 15: 기록된 기준값(60/330/598)과의 차이. 15 LSB ≈ 5°. 와이퍼 전압은 서보 전원에 비례하므로
 *   전원이 5.0 → 4.8 V(−4 %)로만 처져도 330 근처에서 약 13 LSB 바뀐다 — 그보다 크면 전원 전압·혼 장착·배선 변경을 확인.
 * - POT_RESID_MAX_LSB 5: 3점 직선 맞춤의 최대 잔차. 5 LSB ≈ 1.7° — 선형 변환(cdeg = a·raw + b)으로 각도를 읽어도 되는 한도.
 *   사용자 실측 잔차는 0.67 LSB.
 * - 방향: 서보각이 커지면 raw 도 커져야 한다(사용자 실측 배선). 반대면 포텐쇼미터 양 끝(5V/GND) 배선이 기록과 다르다.
 */
export const POT_SD_MAX_LSB = 3;
export const POT_REF_ERR_MAX_LSB = 15;
export const POT_RESID_MAX_LSB = 5;
/** 조립용 90° 고정: 기대 raw(보정 직선의 90° 값) ± 10 LSB(≈ 3.3°, 혼 스플라인 한 칸 ≈ 14°보다 충분히 작다) */
export const CENTER_TOL_LSB = 10;
/** 수평 판정: 공 굴림 속도 |v| < 3 mm/s(level-finder 와 같은 기준) */
export const LEVEL_FLAT_MM_S = 3;
/**
 * 초음파 위치 응답(조립 후) 기준.
 * - SPT_RESID_MAX_MM 10: 기준 거리 ↔ 측정 거리 직선의 최대 잔차. 줄자 읽기·공 중심 맞춤 오차(수 mm) + HC-SR04 분해능(약 3 mm)을
 *   합쳐도 10 mm 안이어야 한다. 넘으면 반사점이 공이 아니거나(빔 끝·멈춤판) 센서가 기울었다.
 * - SPT_SD_MAX_MM 3: 한 위치 정지 공의 원측정 σ(튄 값 제외). 분해능 약 3 mm 수준이어야 필터·제어가 쓸 만하다.
 * - SPT_OUTLIER_WARN 0.02 / SPT_OUTLIER_BAD 0.1: 튄 값 비율(signal-monitor 의 '거리 이상값' 판정과 같은 문턱). 경고만 하고 불합격시키지 않는다.
 * - SPT_SLOPE_WARN 0.1: 기울기가 1 ± 0.1 밖이면 경고(음속 온도 보정·센서 각도), 판정에는 넣지 않는다.
 */
export const SPT_RESID_MAX_MM = 10;
export const SPT_SD_MAX_MM = 3;
export const SPT_OUTLIER_WARN = 0.02;
export const SPT_OUTLIER_BAD = 0.1;
export const SPT_SLOPE_WARN = 0.1;

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
/** 표본 표준편차(n−1). 1개면 0 */
const sdS = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

/** 서보각(°) → 벤치 명령(cdeg, trim 0·dir 1) */
export const servoDegToCmd = (deg) => Math.round((deg - 90) * 100);

/**
 * 측정 순서(순수): 각 점을 repeats 번, 매번 다른 점에서 이동해 와서 잰다.
 * 짝수 회차 = 오름차순, 홀수 회차 = 앞 두 점을 바꾼 순서(3점이면 90, 0, 180) → 90°는 아래·위 양쪽에서 접근한다.
 */
export function potTestPlan(angles, repeats) {
  const A = angles.slice().sort((a, b) => a - b);
  const odd = A.length >= 3 ? [A[1], A[0], ...A.slice(2)] : A.slice().reverse();
  const out = [];
  for (let r = 0; r < repeats; r++) for (const a of r % 2 ? odd : A) out.push({ repeat: r, servo_deg: a });
  return out;
}

/**
 * 포텐쇼미터 매핑 시험 분석(순수).
 * visits: [{ servo_deg, raw_mean }] (한 번 이동·정착 후 잰 평균값들)
 * ref: 보정 기록(points[{ servo_deg, raw_mean }]) 또는 null
 * 반환 { points: [{ servo_deg, mean, sd, n, ref_raw, err }], fit, checks: [{ key, ok, level, label, text }], pass }
 */
export function analyzePotTest(visits, ref = null) {
  const by = new Map();
  for (const v of visits) { if (!Number.isFinite(v.raw_mean)) continue; if (!by.has(v.servo_deg)) by.set(v.servo_deg, []); by.get(v.servo_deg).push(v.raw_mean); }
  const refPts = ref && ref.points ? ref.points : [];
  const points = [...by.keys()].sort((a, b) => a - b).map((deg) => {
    const vals = by.get(deg);
    const rp = refPts.find((p) => p.servo_deg === deg);
    const m = mean(vals);
    return { servo_deg: deg, mean: m, sd: sdS(vals), n: vals.length, ref_raw: rp ? rp.raw_mean : null, err: rp ? m - rp.raw_mean : null };
  });
  const fit = fitPotLine(points.map((p) => ({ servo_deg: p.servo_deg, raw_mean: p.mean })));
  const checks = [];
  const sdMax = points.length ? Math.max(...points.map((p) => p.sd)) : NaN;
  checks.push({ key: 'sd', ok: points.length > 0 && sdMax <= POT_SD_MAX_LSB, label: '반복 σ(점별 최대)', value: sdMax, text: `${fmtN(sdMax, 2)} LSB (기준 ≤ ${POT_SD_MAX_LSB} LSB ≈ 1°)` });
  const withRef = points.filter((p) => p.err != null);
  if (withRef.length) {
    const eMax = Math.max(...withRef.map((p) => Math.abs(p.err)));
    checks.push({ key: 'ref', ok: eMax <= POT_REF_ERR_MAX_LSB, label: '기준값 대비 평균 오차(최대)', value: eMax, text: `${fmtN(eMax, 1)} LSB (기준 ≤ ${POT_REF_ERR_MAX_LSB} LSB ≈ 5°, 기준 ${withRef.map((p) => `${p.servo_deg}°→${p.ref_raw}`).join(', ')})` });
  } else checks.push({ key: 'ref', ok: true, level: 'info', label: '기준값 대비 평균 오차', value: null, text: '비교할 기준값 없음(같은 서보각 점이 기록에 없음)' });
  checks.push({ key: 'resid', ok: !!fit && fit.residual_max_lsb <= POT_RESID_MAX_LSB, label: '직선 잔차(최대)', value: fit ? fit.residual_max_lsb : null, text: fit ? `${fmtN(fit.residual_max_lsb, 2)} LSB (기준 ≤ ${POT_RESID_MAX_LSB} LSB ≈ 1.7°)` : '점이 2개 미만' });
  checks.push({ key: 'dir', ok: !!fit && fit.monotonic === 'up', label: '방향(서보각 ↑ → raw ↑)', value: fit ? fit.monotonic : null,
    text: !fit ? '점 부족' : fit.monotonic === 'up' ? '단조 증가(기록과 같은 배선 방향)' : fit.monotonic === 'down' ? '단조 감소 — 포텐쇼미터 양 끝(5V/GND) 배선이 기록과 반대입니다(예전 슬라이드 67 장치 방향)' : '단조가 아님 — 와이퍼 접촉·배선 확인' });
  for (const c of checks) if (!c.level) c.level = c.ok ? 'ok' : 'bad';
  return { points, fit, checks, pass: checks.every((c) => c.ok) };
}

/**
 * 초음파 위치 응답 분석(순수).
 * rows: [{ ref_mm, dist: number[] (원측정 dist_mm, −1 유실 포함), filt: number[] }]
 * 반환 { rows: [{ ref_mm, n, n_lost, median, mean, sd, mad_sd, outlier_ratio, filt_mean, err }], fit: { slope, intercept, residuals, residual_max } | null, checks, pass }
 */
export function analyzeSensorPositions(rows) {
  const out = rows.filter((r) => r && r.dist && r.dist.length).map((r) => {
    const rs = robustDistStats(r.dist);
    const fv = (r.filt || []).filter((x) => x >= 0);
    return { ref_mm: r.ref_mm, n: r.dist.length, n_lost: r.dist.filter((x) => !(x >= 0)).length, median: rs.median, mean: rs.inlier_mean, sd: rs.inlier_sd, mad_sd: rs.mad_sd, outlier_ratio: rs.outlier_ratio, filt_mean: mean(fv), err: rs.inlier_mean - r.ref_mm };
  }).sort((a, b) => a.ref_mm - b.ref_mm);
  let fit = null;
  const P = out.filter((r) => Number.isFinite(r.mean));
  if (P.length >= 2) {
    const mx = mean(P.map((r) => r.ref_mm)), my = mean(P.map((r) => r.mean));
    let sxy = 0, sxx = 0;
    for (const r of P) { sxy += (r.ref_mm - mx) * (r.mean - my); sxx += (r.ref_mm - mx) ** 2; }
    if (sxx > 0) {
      const slope = sxy / sxx, intercept = my - slope * mx;
      const residuals = P.map((r) => r.mean - (intercept + slope * r.ref_mm));
      fit = { slope, intercept, residuals, residual_max: Math.max(...residuals.map(Math.abs)) };
    }
  }
  const checks = [];
  let mono = P.length >= 2;
  for (let i = 1; i < P.length; i++) if (!(P[i].mean > P[i - 1].mean)) mono = false;
  checks.push({ key: 'mono', ok: mono, label: '단조 증가(위치 ↑ → 측정 ↑)', text: P.length < 2 ? '위치 2곳 이상 측정 필요' : mono ? '단조 증가' : '측정이 위치 순서와 맞지 않습니다 — 반사점(빔 끝·멈춤판·손)·센서 각도 확인' });
  checks.push({ key: 'resid', ok: !!fit && fit.residual_max <= SPT_RESID_MAX_MM, label: '직선 잔차(최대)', value: fit ? fit.residual_max : null, text: fit ? `${fmtN(fit.residual_max, 1)} mm (기준 ≤ ${SPT_RESID_MAX_MM} mm)` : '위치 2곳 이상 필요' });
  const sdMax = P.length ? Math.max(...P.map((r) => r.sd)) : NaN;
  checks.push({ key: 'sd', ok: P.length > 0 && sdMax <= SPT_SD_MAX_MM, label: '위치별 σ(튄 값 제외, 최대)', value: sdMax, text: `${fmtN(sdMax, 2)} mm (기준 ≤ ${SPT_SD_MAX_MM} mm)` });
  const oMax = out.length ? Math.max(...out.map((r) => r.outlier_ratio)) : 0;
  checks.push({ key: 'outlier', ok: true, level: oMax >= SPT_OUTLIER_BAD ? 'bad' : oMax >= SPT_OUTLIER_WARN ? 'warn' : 'ok', label: '튄 값 비율(최대, 경고만)', value: oMax,
    text: `${fmtN(oMax * 100, 1)} % (경고 ≥ ${SPT_OUTLIER_WARN * 100} %, 심함 ≥ ${SPT_OUTLIER_BAD * 100} %)${oMax >= SPT_OUTLIER_WARN ? ' — 빔 끝·멈춤판·손 반사, 펌웨어 이상값 제거(despike) 설정 확인' : ''}` });
  if (fit) checks.push({ key: 'slope', ok: true, level: Math.abs(fit.slope - 1) > SPT_SLOPE_WARN ? 'warn' : 'ok', label: '기울기(참고)', value: fit.slope, text: `${fmtN(fit.slope, 3)} (1 ± ${SPT_SLOPE_WARN} 밖이면 경고: 센서 기울기·음속 온도), 절편 ${fmtN(fit.intercept, 1)} mm` });
  for (const c of checks) if (!c.level) c.level = c.ok ? 'ok' : 'bad';
  return { rows: out, fit, checks, pass: checks.every((c) => c.ok) };
}

/** 수평 trim 조정 방향(순수): 공이 센서에서 멀어지면(v > 0, 센서 쪽이 높음) 명령 − 쪽 = trim −dir 쪽 */
export function levelTrimHint(v_mm_s, dir = 1) {
  if (v_mm_s == null || !Number.isFinite(v_mm_s)) return null;
  if (Math.abs(v_mm_s) < LEVEL_FLAT_MM_S) return { flat: true, sign: 0 };
  return { flat: false, sign: v_mm_s > 0 ? -dir : dir };
}

/** 90° 고정 판정(순수): A0 평균과 기대값 비교 */
export function centerCheck(raw_mean, expected_raw, tol = CENTER_TOL_LSB) {
  if (!Number.isFinite(raw_mean) || !Number.isFinite(expected_raw)) return { ok: false, err: null, known: false };
  const err = raw_mean - expected_raw;
  return { ok: Math.abs(err) <= tol, err, known: true };
}

/** 보정 기록에서 서보각(°)의 기대 raw: 기록 직선(없으면 null) */
export function expectedRaw(record, deg = 90) {
  if (!record || !record.fit) return NaN;
  return rawAtServoDeg(deg, record.fit);
}

function fmtN(v, d) { return Number.isFinite(v) ? v.toFixed(d) : '–'; }

// ------------------------------------------------------------------ 장치 조작
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** D 스트림을 ms 동안 모은다(pred 로 거름). 반환 D 배열 */
export async function collectSamples(dev, ms, pred = () => true, abort = null) {
  const got = [];
  const off = dev.onSample((d) => { if (pred(d)) got.push(d); });
  const t0 = Date.now();
  try { while (Date.now() - t0 < ms) { if (abort && abort.aborted) break; await sleep(Math.min(50, ms)); } } finally { off(); }
  return got;
}

/** 시험이 중단됐음을 알리는 오류 */
export class AbortedError extends Error { constructor() { super('중단됨(비상 정지)'); this.aborted = true; } }

/**
 * 벤치 모드 포텐쇼미터 시험 실행(조립 전, 혼만 달린 서보). 펌웨어 1.2.0 P,bench 필요.
 * 순서: IDLE → P,trim,0·P,dir,1 → P,bench,1 → P,lim,9000 → M,1 → 계획대로 [램프 이동 → 정착 대기 → avg_n 개 pot 평균] →
 *       (항상) 하트비트 정지 → 명령 0(정상 종료면 램프) → M,0 → P,bench,0 → 저장된 trim·dir·lim 다시 보냄.
 * opts: { angles=[0,90,180], repeats=10, settle_ms=1000, avg_n=10, rate_deg_s=90, abort: { aborted }, onProgress(info), restore: settings.device }
 * 반환 { visits: [{ repeat, servo_deg, raw_mean, raw_sd, n }], aborted }
 */
export async function runPotBench(dev, opts = {}) {
  const angles = opts.angles || [0, 90, 180];
  const repeats = opts.repeats ?? 10;
  const settle = opts.settle_ms ?? 1000, avgN = opts.avg_n ?? 10, rate = opts.rate_deg_s ?? 90;
  const abort = opts.abort || { aborted: false };
  const prog = opts.onProgress || (() => {});
  if (!dev.connected) throw new Error('장치가 연결되어 있지 않습니다');
  if (!dev.fw.bench) { const e = new Error(`펌웨어 1.2.0 업로드 필요 — 이 장치(${dev.hello?.fw_ver ?? '알 수 없음'})는 벤치 모드(P,bench)가 없어 ±90° 시험을 할 수 없습니다`); e.needFw = true; throw e; }
  for (const a of angles) if (!(a >= 0 && a <= 180)) throw new Error(`서보각 ${a}° 는 0~180° 밖입니다`);
  const plan = potTestPlan(angles, repeats);
  const visits = [];
  let hb = null, cur = 0, aborted = false;
  const send = (c) => dev.send(cmd.servo(c)).catch(() => {});
  try {
    if (dev.devMode !== 0 && dev.devMode != null) await dev.setDeviceMode(0);
    const r0 = await dev.configure({ trim: 0, dir: 1 }, ['trim', 'dir']);
    const bad = r0.filter((x) => !x.ok);
    if (bad.length) throw new Error(`trim·dir 설정 실패: ${bad.map((b) => `${b.key}(${b.err})`).join(', ')}`);
    await dev.setBench(true);
    const rl = await dev.request(cmd.param('lim', BENCH_HARD_LIM_CDEG), (a) => a.cmd === 'P' && a.args[0] === 'lim');
    if (!rl.ok) throw new Error(`P,lim,${BENCH_HARD_LIM_CDEG} 실패`);
    await dev.setDeviceMode(1);
    hb = setInterval(() => { dev.send(cmd.beat()).catch(() => {}); }, HEARTBEAT_MS);
    await send(0);
    const tick = 40, stepMax = Math.max(1, (rate * 100 * tick) / 1000);
    for (let i = 0; i < plan.length; i++) {
      const v = plan[i];
      const tgt = servoDegToCmd(v.servo_deg);
      prog({ i, total: plan.length, phase: 'move', ...v });
      while (cur !== tgt) {
        if (abort.aborted) throw new AbortedError();
        const d = tgt - cur;
        cur = Math.abs(d) <= stepMax ? tgt : Math.round(cur + Math.sign(d) * stepMax);
        await send(cur);
        await sleep(tick);
      }
      prog({ i, total: plan.length, phase: 'settle', ...v });
      const t0 = Date.now();
      while (Date.now() - t0 < settle) { if (abort.aborted) throw new AbortedError(); await send(cur); await sleep(100); }
      prog({ i, total: plan.length, phase: 'measure', ...v });
      const got = [];
      const off = dev.onSample((d) => { if (d.mode === 1 && d.cmd_cdeg === cur) got.push(d.pot_raw); });
      const tm = Date.now();
      try {
        while (got.length < avgN) {
          if (abort.aborted) throw new AbortedError();
          if (Date.now() - tm > 10000) throw new Error('포텐쇼미터 값을 충분히 받지 못했습니다(10 s)');
          await send(cur);
          await sleep(100);
        }
      } finally { off(); }
      const vals = got.slice(0, avgN);
      visits.push({ repeat: v.repeat, servo_deg: v.servo_deg, raw_mean: mean(vals), raw_sd: sdS(vals), n: vals.length });
      prog({ i: i + 1, total: plan.length, phase: 'done', ...v, visits });
    }
    // 정상 종료: 90°로 천천히 돌아온다
    while (cur !== 0) { const d = -cur; cur = Math.abs(d) <= stepMax ? 0 : Math.round(cur + Math.sign(d) * stepMax); await send(cur); await sleep(tick); }
  } catch (e) {
    if (e.aborted) aborted = true; else throw e;
  } finally {
    clearInterval(hb);
    await safeExitBench(dev, opts.restore);
  }
  return { visits, aborted };
}

/** 벤치 시험 뒤 반드시: M,0(명령 0 = 서보 90°) → P,bench,0 → 저장된 trim·dir·lim 복원. 실패해도 계속 시도한다 */
export async function safeExitBench(dev, restore) {
  if (!dev.connected) return;
  try { await dev.setDeviceMode(0); } catch { await dev.estop(); }
  try { if (dev.fw.bench) await dev.setBench(false); } catch (e) { console.warn('P,bench,0 실패', e); }
  if (restore) {
    try { await dev.configure(restore, ['trim', 'dir', 'lim']); } catch (e) { console.warn('설정 복원 실패', e); }
  }
}
