// 설정값 프로파일 (data-schema.md §2.2). 러너·가상 장치·지표가 같은 해석을 쓴다.
// 시간 0 = 실험(세션) 시작.
// step: t < pre_s → from_mm, 이후 to_mm. 길이 pre_s + hold_s
// square: low로 시작, half_period_s마다 low↔high. 길이 2·cycles·half_period_s
// staircase: levels_mm[k]를 hold_s씩. 길이 n·hold_s
// const: ref_mm. 길이 duration_s (null이면 사용자가 멈출 때까지)

export function refAt(p, t) {
  if (!p) return NaN;
  switch (p.type) {
    case 'const': return p.ref_mm;
    case 'step': return t < p.pre_s ? p.from_mm : p.to_mm;
    case 'square': return Math.floor(t / p.half_period_s) % 2 === 0 ? p.low_mm : p.high_mm;
    case 'staircase': { const k = Math.min(p.levels_mm.length - 1, Math.max(0, Math.floor(t / p.hold_s))); return p.levels_mm[k]; }
    default: return NaN;
  }
}

/** 실험 길이(s). 끝이 없으면 Infinity */
export function durationOf(p) {
  if (!p) return Infinity;
  switch (p.type) {
    case 'const': return p.duration_s == null ? Infinity : p.duration_s;
    case 'step': return p.pre_s + p.hold_s;
    case 'square': return 2 * p.cycles * p.half_period_s;
    case 'staircase': return p.levels_mm.length * p.hold_s;
    default: return Infinity;
  }
}

/** §2.2 "같은 설정값 프로파일" 판정 */
export function sameProfile(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'const') return a.ref_mm === b.ref_mm;
  const keys = { step: ['from_mm', 'to_mm', 'pre_s', 'hold_s'], square: ['low_mm', 'high_mm', 'half_period_s', 'cycles'], staircase: ['hold_s'] }[a.type];
  if (!keys) return false;
  if (a.type === 'staircase') {
    if (!Array.isArray(a.levels_mm) || !Array.isArray(b.levels_mm) || a.levels_mm.length !== b.levels_mm.length) return false;
    if (a.levels_mm.some((v, i) => v !== b.levels_mm[i])) return false;
  }
  return keys.every((k) => a[k] === b[k]);
}

export function describeProfile(p) {
  if (!p) return '없음';
  switch (p.type) {
    case 'const': return `일정 ${p.ref_mm} mm`;
    case 'step': return `스텝 ${p.from_mm}→${p.to_mm} mm (대기 ${p.pre_s} s, 유지 ${p.hold_s} s)`;
    case 'square': return `사각파 ${p.low_mm}↔${p.high_mm} mm, 반주기 ${p.half_period_s} s × ${p.cycles}`;
    case 'staircase': return `계단 [${p.levels_mm.join(', ')}] mm, ${p.hold_s} s씩`;
    default: return JSON.stringify(p);
  }
}

export const STANDARD_PROFILES = {
  P1: { type: 'step', from_mm: 150, to_mm: 200, pre_s: 2, hold_s: 8 },
  P2: { type: 'square', low_mm: 150, high_mm: 200, half_period_s: 6, cycles: 2 },
  P3: { type: 'staircase', levels_mm: [120, 170, 270, 170], hold_s: 6 },
};
