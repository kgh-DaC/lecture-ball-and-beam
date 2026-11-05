// 최고 사례 점수 (data-schema.md §5.4, experiment-curriculum 선정 규칙). 점수 계산은 이 파일 한 곳뿐이다.
// tools/pick_best_sample.js도 이 모듈을 import한다.
//
// 후보 객체 형식: { id, controller, setpoint_profile, metrics: <summary 객체 또는 {summary}> , conditions? }
// 반환: { group, weights, dropped, rows: [{ id, eligible, eligible_note, raw, norm, score, rank, ts_unsettled }] }

import { sameProfile } from './profile.js';

export const DEFAULT_WEIGHTS = Object.freeze({ itae: 0.4, ts: 0.3, po: 0.2, u_tv: 0.1 });
export const MAX_SAT = 0.10;
export const MAX_LOST = 0.05;
const KEYS = ['itae', 'ts', 'po', 'u_tv'];
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export function summaryOf(c) {
  const m = c.metrics_summary || c.metrics || {};
  return m.summary ? m.summary : m;
}

export function groupKey(c) {
  return `${c.controller || '?'}|${JSON.stringify(c.setpoint_profile || null)}`;
}

/** 후보를 (controller, setpoint_profile) 같은 묶음으로 나눈다 */
export function groupCandidates(cands) {
  const groups = [];
  for (const c of cands) {
    const g = groups.find((x) => x.controller === c.controller && sameProfile(x.setpoint_profile, c.setpoint_profile));
    if (g) g.items.push(c); else groups.push({ controller: c.controller, setpoint_profile: c.setpoint_profile, items: [c] });
  }
  return groups;
}

export function eligibility(sum) {
  const sat = sum.u_sat_ratio, lost = sum.lost_ratio;
  if (fin(lost) && lost > MAX_LOST) return { eligible: false, note: `유실 ${(lost * 100).toFixed(1)}% > 5%` };
  if (fin(sat) && sat > MAX_SAT) return { eligible: false, note: `포화 ${(sat * 100).toFixed(1)}% > 10%` };
  if (!fin(sat)) return { eligible: 'unknown', note: '포화 비율 확인 불가(제어 입력 기록 없음)' };
  if (!fin(lost)) return { eligible: 'unknown', note: '유실 비율 확인 불가' };
  return { eligible: true, note: null };
}

/**
 * @param {Array} candidates 같은 묶음의 후보(다른 묶음이 섞이면 첫 후보의 묶음만 점수 계산, 나머지는 'other_group')
 * @param {object} weights 기본 DEFAULT_WEIGHTS
 */
export function score(candidates, weights = DEFAULT_WEIGHTS, opts = {}) {
  const w0 = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const first = candidates[0];
  const group = opts.group || (first ? `${first.controller}:${first.setpoint_profile ? first.setpoint_profile.type : '?'}` : null);
  const rows = candidates.map((c) => {
    const s = summaryOf(c);
    const sameGroup = !first || (c.controller === first.controller && sameProfile(c.setpoint_profile, first.setpoint_profile));
    const el = sameGroup ? eligibility(s) : { eligible: false, note: '다른 묶음(제어기 또는 설정값 프로파일 다름)' };
    return {
      id: c.id, eligible: el.eligible, eligible_note: el.note,
      raw: { itae: fin(s.itae) ? s.itae : null, ts: fin(s.ts) ? s.ts : null, po: fin(s.po) ? s.po : null, u_tv: fin(s.u_tv) ? s.u_tv : null },
      ts_unsettled: s.computable !== false && s.ts == null && s.ts_settled === false,
      norm: {}, score: null, rank: null,
    };
  });
  const pool = rows.filter((r) => r.eligible !== false);
  // 지표가 후보 중 하나라도 없으면 그 항을 뺀다(미정착 ts는 '없음'이 아니라 최대값으로 취급)
  const dropped = [];
  for (const k of KEYS) {
    if (!(w0[k] > 0)) continue;
    const missing = pool.some((r) => r.raw[k] == null && !(k === 'ts' && r.ts_unsettled));
    const allUnsettled = k === 'ts' && pool.length && pool.every((r) => r.raw.ts == null);
    if (missing || allUnsettled) dropped.push(k);
  }
  const used = KEYS.filter((k) => w0[k] > 0 && !dropped.includes(k));
  const wsum = used.reduce((s, k) => s + w0[k], 0);
  const wn = {};
  for (const k of KEYS) wn[k] = used.includes(k) && wsum > 0 ? w0[k] / wsum : 0;
  for (const k of used) {
    const vals = pool.map((r) => r.raw[k]).filter((v) => v != null);
    const mx = Math.max(...vals), mn = Math.min(...vals);
    for (const r of pool) {
      // 미정착 ts → 묶음 최댓값 = 정규화 1(가장 나쁨). 정착 후보가 하나뿐(mx = mn)이어도 미정착은 1로 둔다.
      if (r.raw[k] == null) { r.norm[k] = 1; continue; }
      r.norm[k] = mx > mn ? (r.raw[k] - mn) / (mx - mn) : 0;
    }
  }
  for (const r of pool) r.score = used.length ? used.reduce((s, k) => s + wn[k] * r.norm[k], 0) : null;
  const ranked = pool.filter((r) => r.score != null).sort((a, b) => a.score - b.score);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return { group, weights: { ...w0 }, weights_used: wn, dropped, n_candidates: pool.length, rows };
}
