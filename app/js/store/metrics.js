// 성능 지표 — 정의는 .claude/skills/experiment-curriculum/references/metrics.md, 형식은 data-schema.md §3.
// 이 파일이 지표 계산의 유일한 구현이다. 위젯·도구·검증은 모두 여기를 호출한다.
//
// 이산화 규칙(Python 대조 구현 tests/control/metrics_reference.py가 같아야 하는 부분):
//  - 유효 샘플 = lost != 1 이고 y가 유한한 샘플. 유실 샘플은 보간하지 않고 제외한다.
//  - y 열: 'y_mm'(유효값이 하나라도 있으면), 없으면 'y_filt_mm'. 결과에 y_col로 기록.
//  - 구간: ref_mm 값이 0.5 mm 넘게 바뀐 첫 샘플이 구간 시작(t0). 다음 변경 직전 샘플까지.
//    변경이 한 번도 없으면(const) 첫 샘플부터 끝까지 한 구간, ref_from = y_initial.
//    처음 변경 이전 부분(step의 pre 구간 등)은 구간이 아니다.
//  - y_initial: t0 이전의 마지막 유효 샘플(없으면 구간 첫 유효 샘플).
//  - Δ = ref_to − y_initial. |Δ| < 15 mm (분해능 3 mm × 5) → computable=false, reason 'small_step'.
//  - y_final = 구간 시간 길이의 마지막 20%(t ≥ t0 + 0.8·(t_end − t0))에 드는 유효 샘플 평균.
//  - 정규화 응답 z = sign(Δ)·(y − y_initial)/|Δ|.
//  - tr: z가 처음 0.1 이상이 되는 시각과 (그 이후) 처음 0.9 이상이 되는 시각의 차.
//        각 교차 시각은 이웃한 두 유효 샘플 사이 선형 보간. 0.9에 못 미치면 null.
//  - tp: sign(Δ)·y가 최대인 첫 유효 샘플 시각 − t0 (보간 없음).
//  - po: max(0, sign(Δ)·(C_max − y_final)/|Δ|·100).
//  - ts: |y − y_final| > ts_band·|Δ|인 마지막 유효 샘플(마지막 위반)의 다음 유효 샘플 시각 t_in − t0.
//        처음부터 띠 안이면 t_in = 첫 유효 샘플 시각.
//        정착 인정(def_ver 2): 띠 안 꼬리 길이 ts_dwell_s = t_end − t_in 이 최소 유지 시간 이상이어야 한다.
//          min_dwell_s = opts.min_dwell_s(명시하면 그 값 그대로) / 없으면 min(1.0 s, T_obs/4), T_obs = t_end − t0.
//          0을 주면 def_ver 1 정의(마지막 샘플만 띠 안이면 정착)와 같다.
//        마지막 유효 샘플이 띠 밖이거나 유지가 모자라면 미정착(ts=null, ts_settled=false).
//        한계 순환(진동)이 관찰 끝에서 우연히 띠 안에 든 경우를 거짓 정착으로 세지 않기 위한 규칙.
//  - ess = |ref_to − y_final|.
//  - IAE/ISE/ITAE: 구간 안 유효 샘플 k(두 번째부터)에 대해 dt_k = t_k − t_(직전 유효 샘플),
//        IAE=Σ|e_k|dt_k, ISE=Σe_k²dt_k, ITAE=Σ(t_k−t0)|e_k|dt_k, e_k = ref_k − y_k.
//  - u_rms = √(mean((u/100)²)) deg, u_tv = Σ|u_k − u_(k−1)|/100 deg (u가 유한한 연속 샘플 쌍),
//    u_sat_ratio = (|u| ≥ lim − 0.5 cdeg 인 샘플 수)/(u가 유한한 샘플 수). lim = meta.device.lim_cdeg, 없으면 3000.
//  - lost_ratio = (lost=1 또는 y 비유한 샘플 수)/(구간 샘플 수).
//  - 유효 샘플 < 5 → computable=false, reason 'too_short'.

export const DEF_VER = 2;
/** 정착 인정 최소 유지 시간 기본값(s). 관찰 구간이 짧으면 T_obs/4 로 줄인다(dwellFor). */
export const MIN_DWELL_S = 1.0;
const EPS_T = 1e-9;

/** 사용할 최소 유지 시간: 명시값(유한, ≥ 0)이면 그대로, 아니면 min(MIN_DWELL_S, T_obs/4) */
export function dwellFor(tObs, minDwell) {
  if (fin(minDwell) && minDwell >= 0) return minDwell;
  return Math.min(MIN_DWELL_S, Math.max(0, tObs) / 4);
}
export const MIN_STEP_MM = 15;
const REF_CHANGE_MM = 0.5;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

function crossTime(t, z, from, level) {
  // from 이후 z가 처음 level 이상이 되는 시각(선형 보간). 없으면 {t:null, idx:-1}
  for (let k = from; k < z.length; k++) {
    if (z[k] >= level) {
      if (k > 0 && z[k - 1] < level) {
        const t0 = t[k - 1], t1 = t[k], z0 = z[k - 1], z1 = z[k];
        return { t: t0 + (level - z0) * (t1 - t0) / (z1 - z0), idx: k };
      }
      return { t: t[k], idx: k };
    }
  }
  return { t: null, idx: -1 };
}

/**
 * 한 스텝 구간의 과도 지표. 배열은 유효 샘플만(시간 오름차순).
 * @param {number} [minDwell] 정착 인정 최소 유지 시간(s). 생략하면 min(1 s, T_obs/4)
 * @returns {{tr,tp,po,ts,ts_settled,ts_dwell_s,min_dwell_s,ess,y_final}}
 */
export function transient(t, y, t0, yInit, refTo, band = 0.05, minDwell = undefined) {
  const delta = refTo - yInit;
  const sgn = delta >= 0 ? 1 : -1;
  const ad = Math.abs(delta);
  const n = t.length;
  const tEnd = t[n - 1];
  const tCut = t0 + 0.8 * (tEnd - t0);
  let sum = 0, cnt = 0;
  for (let k = 0; k < n; k++) if (t[k] >= tCut) { sum += y[k]; cnt++; }
  const yFinal = cnt ? sum / cnt : y[n - 1];
  const dwellReq = dwellFor(tEnd - t0, minDwell);
  const res = { tr: null, tp: null, po: null, ts: null, ts_settled: false, ts_dwell_s: null, min_dwell_s: dwellReq, ess: Math.abs(refTo - yFinal), y_final: yFinal };
  if (ad === 0) return res;
  const z = y.map((v) => sgn * (v - yInit) / ad);
  const c10 = crossTime(t, z, 0, 0.1);
  if (c10.idx >= 0) {
    // 0.9 교차는 0.1 교차 샘플부터 찾는다(보간 구간이 겹칠 수 있음)
    const c90 = crossTime(t, z, c10.idx, 0.9);
    if (c90.t != null) res.tr = c90.t - c10.t;
  }
  let kmax = 0;
  for (let k = 1; k < n; k++) if (sgn * y[k] > sgn * y[kmax]) kmax = k;
  res.tp = t[kmax] - t0;
  res.po = Math.max(0, sgn * (y[kmax] - yFinal) / ad * 100);
  const tol = band * ad;
  let last = -1;
  for (let k = 0; k < n; k++) if (Math.abs(y[k] - yFinal) > tol) last = k;
  if (last < n - 1) {
    const tIn = t[last + 1];
    res.ts_dwell_s = tEnd - tIn;
    if (res.ts_dwell_s >= dwellReq - EPS_T) { res.ts = tIn - t0; res.ts_settled = true; }
  }
  return res;
}

function pickYCol(rows) {
  if (rows.some((r) => fin(r.y_mm))) return 'y_mm';
  if (rows.some((r) => fin(r.y_filt_mm))) return 'y_filt_mm';
  return null;
}

/**
 * 세션 지표 계산.
 * @param {Array<object>} rows CSV 행 객체(t_s, ref_mm, y_mm, y_filt_mm, u_cdeg, lost ...)
 * @param {object} meta 세션 메타(선택: setpoint_profile, device.lim_cdeg, conditions.period_assumed)
 * @param {{ ts_band?: number, min_dwell_s?: number }} opts min_dwell_s 생략 = 구간마다 min(1 s, T_obs/4)
 */
export function compute(rows, meta = {}, opts = {}) {
  const band = opts.ts_band ?? 0.05;
  const minDwell = fin(opts.min_dwell_s) && opts.min_dwell_s >= 0 ? opts.min_dwell_s : null;
  const out = { def_ver: DEF_VER, ts_band: band, min_dwell_s: minDwell, segments: [], summary: null, y_col: null, u_sat_lim_cdeg: null };
  const timeAssumed = !!(meta && meta.conditions && meta.conditions.period_assumed);
  if (timeAssumed) out.time_assumed = true;
  if (!rows || !rows.length) return out;
  if (!rows.every((r) => fin(r.t_s))) {
    out.segments.push({ computable: false, reason: 'no_time' });
    return out;
  }
  const ycol = pickYCol(rows);
  out.y_col = ycol;
  // u_sat_ratio 기준: data-schema §3의 세션 lim(없으면 하드 한계 3000). 사용한 기준을 결과에 남긴다.
  const lim = (meta && meta.device && fin(meta.device.lim_cdeg)) ? meta.device.lim_cdeg : 3000;
  out.u_sat_lim_cdeg = lim;
  const ref = rows.map((r) => r.ref_mm);
  const hasRef = ref.some(fin);
  // 구간 경계 찾기
  const starts = [];
  if (hasRef) {
    let prev = null;
    for (let k = 0; k < rows.length; k++) {
      if (!fin(ref[k])) continue;
      if (prev != null && Math.abs(ref[k] - prev) > REF_CHANGE_MM) starts.push(k);
      prev = ref[k];
    }
  }
  const isConst = starts.length === 0;
  const bounds = isConst ? [[0, rows.length]] : starts.map((s, i) => [s, i + 1 < starts.length ? starts[i + 1] : rows.length]);
  for (const [a, b] of bounds) {
    out.segments.push(segmentMetrics(rows, a, b, ycol, isConst, lim, band, timeAssumed, minDwell));
  }
  const first = out.segments.find((s) => s.computable) || out.segments[0] || null;
  out.summary = first ? { ...first } : null;
  return out;
}

function segmentMetrics(rows, a, b, ycol, isConst, lim, band, timeAssumed, minDwell) {
  const t0 = rows[a].t_s;
  const seg = { t0_s: t0, t1_s: rows[b - 1].t_s, ref_from_mm: null, ref_to_mm: null, y_initial_mm: null, computable: true, reason: null,
    tr: null, tp: null, po: null, ts: null, ts_settled: false, ts_dwell_s: null, min_dwell_s: null, ess: null, iae: null, ise: null, itae: null,
    u_rms: null, u_sat_ratio: null, u_tv: null, lost_ratio: null };
  if (timeAssumed) seg.time_assumed = true;
  const valid = (r) => r.lost !== 1 && ycol && fin(r[ycol]);
  // 유실 비율
  let nLost = 0;
  for (let k = a; k < b; k++) if (!valid(rows[k])) nLost++;
  seg.lost_ratio = (b - a) ? nLost / (b - a) : null;
  // 제어 노력
  const us = [];
  for (let k = a; k < b; k++) us.push(rows[k].u_cdeg);
  const uf = us.filter(fin);
  if (uf.length) {
    seg.u_rms = Math.sqrt(uf.reduce((s, u) => s + (u / 100) ** 2, 0) / uf.length);
    let tv = 0;
    for (let k = 1; k < us.length; k++) if (fin(us[k]) && fin(us[k - 1])) tv += Math.abs(us[k] - us[k - 1]);
    seg.u_tv = tv / 100;
    seg.u_sat_ratio = uf.filter((u) => Math.abs(u) >= lim - 0.5).length / uf.length;
  }
  // 유효 샘플
  const t = [], y = [], rf = [];
  for (let k = a; k < b; k++) if (valid(rows[k])) { t.push(rows[k].t_s); y.push(rows[k][ycol]); rf.push(rows[k].ref_mm); }
  if (t.length < 5) { seg.computable = false; seg.reason = 'too_short'; return seg; }
  let yInit = null;
  if (!isConst) for (let k = a - 1; k >= 0; k--) if (valid(rows[k])) { yInit = rows[k][ycol]; break; }
  if (yInit == null) yInit = y[0];
  let refTo = fin(rows[a].ref_mm) ? rows[a].ref_mm : rf.find(fin);
  if (!fin(refTo)) { seg.computable = false; seg.reason = 'no_ref'; return seg; }
  seg.y_initial_mm = yInit;
  seg.ref_to_mm = refTo;
  seg.ref_from_mm = isConst ? yInit : (() => { for (let k = a - 1; k >= 0; k--) if (fin(rows[k].ref_mm)) return rows[k].ref_mm; return yInit; })();
  // 적분 지표(Δ가 작아도 계산 가능하지만 과도 지표와 함께 계산 불가로 표시)
  let iae = 0, ise = 0, itae = 0;
  for (let k = 1; k < t.length; k++) {
    const dt = t[k] - t[k - 1];
    const e = (fin(rf[k]) ? rf[k] : refTo) - y[k];
    iae += Math.abs(e) * dt; ise += e * e * dt; itae += (t[k] - t0) * Math.abs(e) * dt;
  }
  const delta = refTo - yInit;
  if (Math.abs(delta) < MIN_STEP_MM) {
    seg.computable = false; seg.reason = 'small_step';
    return seg;
  }
  Object.assign(seg, { iae, ise, itae });
  const tr = transient(t, y, t0, yInit, refTo, band, minDwell ?? undefined);
  seg.tr = tr.tr; seg.tp = tr.tp; seg.po = tr.po; seg.ts = tr.ts; seg.ts_settled = tr.ts_settled; seg.ess = tr.ess;
  seg.ts_dwell_s = tr.ts_dwell_s; seg.min_dwell_s = tr.min_dwell_s;
  seg.y_final_mm = tr.y_final;
  if (!uf.length) seg.reason = 'no_u';
  return seg;
}

/**
 * 시뮬레이션·이론 응답용 과도 지표(위젯이 analysis.stepResponse 결과에 사용).
 * y_initial = y[0], 시작 시각 = t_s[0]. 크기 하한(15 mm) 검사는 하지 않는다(단위 없는 응답).
 * 정착 판정은 compute와 같다(최소 유지 시간 opts.min_dwell_s, 생략하면 min(1 s, 관찰 길이/4)).
 * @param {number[]} t_s @param {number[]} y @param {number|number[]} ref 최종 설정값(배열이면 마지막 값)
 * @param {{ ts_band?: number, y_initial?: number, min_dwell_s?: number }} opts
 */
export function stepInfo(t_s, y, ref, opts = {}) {
  const band = opts.ts_band ?? 0.05;
  const r = Array.isArray(ref) ? ref[ref.length - 1] : ref;
  const tt = [], yy = [];
  for (let k = 0; k < t_s.length; k++) if (fin(t_s[k]) && fin(y[k])) { tt.push(t_s[k]); yy.push(y[k]); }
  if (tt.length < 3 || !fin(r)) return { tr: null, tp: null, po: null, ts: null, ts_settled: false, ts_dwell_s: null, min_dwell_s: null, ess: null, y_final: null };
  return transient(tt, yy, tt[0], opts.y_initial ?? yy[0], r, band, opts.min_dwell_s);
}

export const METRIC_INFO = {
  tr: { label: '상승시간 t_r', unit: 's' },
  tp: { label: '첨두시간 t_p', unit: 's' },
  po: { label: '오버슈트 P.O.', unit: '%' },
  ts: { label: '정착시간 t_s', unit: 's' },
  ess: { label: '정상상태 오차 e_ss', unit: 'mm' },
  iae: { label: 'IAE', unit: 'mm·s' },
  ise: { label: 'ISE', unit: 'mm²·s' },
  itae: { label: 'ITAE', unit: 'mm·s²' },
  u_rms: { label: 'u_rms', unit: 'deg' },
  u_tv: { label: 'u_tv', unit: 'deg' },
  u_sat_ratio: { label: '포화 비율', unit: '' },
  lost_ratio: { label: '유실 비율', unit: '' },
};

export const REASON_LABEL = { small_step: '스텝이 너무 작음(<15 mm)', too_short: '데이터 부족', no_u: '제어 입력 없음', no_time: '시간축 없음', no_ref: '설정값 없음' };
