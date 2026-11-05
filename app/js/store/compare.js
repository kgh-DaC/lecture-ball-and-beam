// 여러 세션 지표 묶음 통계(평균±표준편차), 기준선 대비 증감 %.

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export function meanSd(values) {
  const v = values.filter(fin);
  if (!v.length) return { mean: null, sd: null, n: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, sd, n: v.length };
}

/** 세션 메타 배열 → 지표별 { mean, sd, n } (summary 기준) */
export function aggregate(metas, keys) {
  const out = {};
  for (const k of keys) out[k] = meanSd(metas.map((m) => m.metrics && m.metrics.summary ? m.metrics.summary[k] : null));
  return out;
}

/** 평균 지표를 summary 형식으로(승격 '평균' 선택 시) */
export function meanSummary(metas, keys) {
  const a = aggregate(metas, keys);
  const s = {};
  for (const k of keys) s[k] = a[k].mean;
  s.computable = Object.values(s).some(fin);
  s.aggregated_n = metas.length;
  return s;
}

/** 기준선 대비 증감 % (작을수록 좋음 지표) */
export function deltaPct(value, base) {
  if (!fin(value) || !fin(base)) return null;
  if (base === 0) return value === 0 ? 0 : null;
  return ((value - base) / Math.abs(base)) * 100;
}
