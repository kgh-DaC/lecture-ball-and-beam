// 거리 좌표 보기(화면 전용): 초음파가 재는 '측정 거리(표면)'와 '공 중심 = 측정 + 반지름'.
// 규약(data-schema §4.4 sonarConvention): 센서가 재는 거리 = 센서 앞면 → 공의 가까운 표면. 공 중심 = 측정 거리 + R(번들 실측 26 mm).
// 제어·저장 좌표는 언제나 측정 거리다(CSV y_mm·y_filt_mm·ref_mm, 가상 장치·트윈 거리도 측정 거리). 이 모듈은 표시만 바꾼다.
// 반지름은 #/settings '공 크기' 기록(settings.hw.ballRadiusMm, 고칠 수 있음). 기본값 26 은 control/plant.js 와 같은 실측이다.
// 보기 선택은 이 브라우저에만 저장('ballbeam.coord_view', 편의 설정) — 위젯끼리 같은 값을 쓴다.

import { h } from './dom.js';
import { BALL_RADIUS_MM, centerFromMeasuredMm, measuredFromCenterMm } from '../control/plant.js';

export const COORD_KEY = 'ballbeam.coord_view';
export const COORD_VIEWS = Object.freeze({ measured: '측정 거리(표면)', center: '공 중심' });
const listeners = new Set();
let memView = null;

/** 지금 반지름(mm): 공 크기 기록 → 없으면 plant.js 실측 26 */
export function radiusOf(ctx) {
  const hw = ctx && ctx.settings && ctx.settings.hw;
  const R = hw && hw.ballRadiusMm ? hw.ballRadiusMm() : BALL_RADIUS_MM;
  return Number.isFinite(R) ? R : BALL_RADIUS_MM;
}

/** 측정 거리 → 공 중심(mm, 순수). 반지름이 번들 실측과 같으면 plant.js 변환을 그대로 쓴다 */
export function centerMm(y_mm, R = BALL_RADIUS_MM) {
  if (typeof y_mm !== 'number' || !Number.isFinite(y_mm)) return NaN;
  return R === BALL_RADIUS_MM ? centerFromMeasuredMm(y_mm) : y_mm + R;
}
/** 공 중심 → 측정 거리(mm, 순수) */
export function measuredMm(c_mm, R = BALL_RADIUS_MM) {
  if (typeof c_mm !== 'number' || !Number.isFinite(c_mm)) return NaN;
  return R === BALL_RADIUS_MM ? measuredFromCenterMm(c_mm) : c_mm - R;
}
/** 보기에 맞춘 값(순수): 'center' 면 +R, 아니면 그대로 */
export function viewMm(y_mm, view, R = BALL_RADIUS_MM) {
  if (typeof y_mm !== 'number' || !Number.isFinite(y_mm)) return NaN;
  return view === 'center' ? centerMm(y_mm, R) : y_mm;
}
/** 축 이름 */
export function axisLabel(view, R = BALL_RADIUS_MM) {
  return view === 'center' ? `공 중심 위치 (mm, 측정 + ${R})` : '측정 거리(표면) (mm)';
}

export function getView() {
  if (memView) return memView;
  let v = null;
  try { v = typeof localStorage !== 'undefined' ? localStorage.getItem(COORD_KEY) : null; } catch { v = null; }
  memView = v === 'center' ? 'center' : 'measured';
  return memView;
}
export function setView(v) {
  memView = v === 'center' ? 'center' : 'measured';
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(COORD_KEY, memView); } catch { /* 저장 불가 */ }
  for (const f of listeners) { try { f(memView); } catch (e) { console.error(e); } }
}
export function onView(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * 좌표 보기 선택(select) + 규약 한 줄. onChange(view) 는 이 위젯 또는 다른 위젯에서 바꿔도 불린다.
 * 반환 { el, off() }
 */
export function coordToggle(ctx, onChange) {
  const R = () => radiusOf(ctx);
  const sel = h('select', { 'aria-label': '좌표 보기', 'data-role': 'coord-view', onchange: (e) => setView(e.target.value) },
    Object.entries(COORD_VIEWS).map(([v, l]) => h('option', { value: v, selected: getView() === v }, v === 'center' ? `${l}(측정 + ${R()} mm)` : l)));
  const off = onView((v) => { sel.value = v; onChange && onChange(v); });
  const el = h('label', { class: 'muted coord-toggle', title: '초음파는 공의 가까운 표면까지 잽니다. 제어·저장 값은 측정 거리 그대로입니다.' }, '좌표 보기 ', sel);
  return { el, off, sel };
}

/** 규약 안내 한 줄(텍스트) */
export function conventionText(R = BALL_RADIUS_MM) {
  return `초음파 측정 거리 = 센서 앞면 → 공의 가까운 표면. 공 중심 = 측정 + ${R} mm(반지름). 제어·저장 값은 측정 거리입니다.`;
}

/** 시험용: 메모리 보기 값 지우기 */
export function _resetView() { memView = null; }
