// 챕터 practice 해석 규칙(chapter-format §4, 1.1.0). 위젯·셸·출처 해석이 같이 쓴다(순수 함수).

/** 제어기별 형식인가: 키가 하나 이상이고 모두 제어기 id이며 값이 (배열 아닌) 객체 */
export function isPerController(obj, ids) {
  const keys = Object.keys(obj || {});
  return keys.length > 0 && keys.every((k) => ids.has(k) && obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]));
}

/**
 * practice의 safe_defaults / param_limits 를 제어기별로 고른다.
 *   단일 형식 { "kp": 1, ... }                     → practice.controller 에만 적용(1.0.0, 하위호환)
 *   제어기별 형식 { "relay": {...}, "pid": {...} } → 키가 모두 controller/controllers_allowed 의 id 이고 값이 객체
 * 반환 { safe, limits } (해당 없으면 빈 객체 → 제어기 meta 기본값·범위)
 */
export function practiceParamsFor(practice, ctrlId) {
  if (!practice || !ctrlId) return { safe: {}, limits: {} };
  const ids = new Set([practice.controller, ...(practice.controllers_allowed || [])].filter(Boolean));
  const pick = (obj) => {
    if (!obj || typeof obj !== 'object') return {};
    if (isPerController(obj, ids)) return { ...(obj[ctrlId] || {}) };
    return practice.controller === ctrlId ? { ...obj } : {};
  };
  return { safe: pick(practice.safe_defaults), limits: pick(practice.param_limits) };
}

/**
 * 실습 완료 판정. chapter: 챕터 json, ev: { type: 'session'|'interaction', complete?, repeat_completed?, id_saved? }
 * - practice 있음: done_when(session_saved 기본 / repeat_completed / id_saved)을 세션 종료 이벤트로만 판정
 * - practice 없음(09·15장처럼 읽기·비교 챕터): 위젯 조작(입력·버튼) 1회면 완료 (퀴즈는 1.2.0에서 제거)
 */
export function practiceDoneBy(chapter, ev) {
  const p = chapter && chapter.practice;
  if (!p) return ev.type === 'interaction';
  if (ev.type !== 'session') return false;
  const when = p.done_when || 'session_saved';
  if (when === 'session_saved') return !!ev.complete;
  if (when === 'repeat_completed') return !!ev.repeat_completed;
  if (when === 'id_saved') return !!ev.id_saved;
  return false;
}
