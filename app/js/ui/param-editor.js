// 제어기 파라미터 편집기(meta.params에서 동적으로 생성)와 설정값 프로파일 편집기.
// controller-panel, validation-run이 같이 쓴다. 이름 하드코딩 없음(controller-interface §3).

import { h, slider } from './dom.js';
import { describeProfile } from '../store/profile.js';

/** ParamSpec + 챕터 제한 → 실제 [min, max] */
export function rangeOf(spec, limits) {
  const lim = limits && limits[spec.key];
  let mn = spec.min ?? 0, mx = spec.max ?? 10;
  if (Array.isArray(lim)) { mn = Math.max(mn, lim[0]); mx = Math.min(mx, lim[1]); }
  return [mn, mx];
}

/** 초기 값: 기본값 < safe_defaults(같은 제어기일 때) < 주어진 값, 범위로 자름 */
export function initialParams(meta, { safe = {}, given = {}, limits = {} } = {}) {
  const out = {};
  for (const sp of meta.params || []) {
    let v = given[sp.key] ?? safe[sp.key] ?? sp.default;
    if (sp.type === 'number' || sp.type === undefined) {
      const [mn, mx] = rangeOf(sp, limits);
      if (typeof v === 'number') v = Math.min(mx, Math.max(mn, v));
    }
    out[sp.key] = v;
  }
  return out;
}

/**
 * opts: { meta, values, limits, device: bool(실기 모드), onChange(values, key) }
 * 반환 요소에 .values, .setDevice(bool), .setValues(v)
 */
export function paramEditor({ meta, values, limits = {}, device = false, onChange }) {
  const v = { ...values };
  const box = h('div', { class: 'param-editor' });
  const rows = {};
  const warn = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  const check = (dev) => {
    const msgs = [];
    for (const sp of meta.params || []) {
      if (sp.device_max != null && typeof v[sp.key] === 'number' && v[sp.key] > sp.device_max) msgs.push(`${sp.label || sp.key} ≤ ${sp.device_max} (실기 상한)`);
      if (sp.device_allowed && !sp.device_allowed.includes(v[sp.key])) msgs.push(`${sp.label || sp.key}: 실기에서는 ${sp.device_allowed.join('/')}만 허용`);
    }
    warn.textContent = dev && msgs.length ? `실기 제한 위반 — 시작이 막힙니다: ${msgs.join('; ')}` : '';
    warn.style.color = dev && msgs.length ? 'var(--bad)' : '';
    return msgs;
  };
  for (const sp of meta.params || []) {
    let row;
    if (sp.type === 'enum') {
      row = h('label', { class: 'slider-row' }, h('span', { class: 'sl-label' }, sp.label || sp.key),
        h('select', { onchange: (e) => { v[sp.key] = e.target.value; check(device); onChange && onChange({ ...v }, sp.key); } },
          (sp.options || []).map((o) => h('option', { value: o.value, selected: o.value === v[sp.key], disabled: device && sp.device_allowed && !sp.device_allowed.includes(o.value) }, o.label))));
    } else if (sp.type === 'bool') {
      row = h('label', { class: 'slider-row' }, h('span', { class: 'sl-label' }, sp.label || sp.key),
        h('input', { type: 'checkbox', checked: !!v[sp.key], onchange: (e) => { v[sp.key] = e.target.checked; onChange && onChange({ ...v }, sp.key); } }));
    } else {
      const [mn, mx] = rangeOf(sp, limits);
      row = slider({ label: sp.label || sp.key, min: mn, max: mx, step: sp.step || (mx - mn) / 200, value: v[sp.key] ?? sp.default ?? mn, unit: sp.unit || '',
        onInput: (x) => { v[sp.key] = x; check(device); onChange && onChange({ ...v }, sp.key); } });
    }
    if (sp.help) row.title = sp.help;
    rows[sp.key] = row;
    box.appendChild(row);
  }
  box.appendChild(warn);
  box.values = () => ({ ...v });
  box.setDevice = (d) => { device = d; return check(d); };
  box.violations = () => check(true);
  box.setValues = (nv) => { Object.assign(v, nv); for (const [k, x] of Object.entries(nv)) if (rows[k] && rows[k].setValue) rows[k].setValue(x); check(device); };
  check(device);
  return box;
}

const PROFILE_FIELDS = {
  step: [['from_mm', '시작 위치', 'mm'], ['to_mm', '목표 위치', 'mm'], ['pre_s', '대기', 's'], ['hold_s', '유지', 's']],
  square: [['low_mm', '아래', 'mm'], ['high_mm', '위', 'mm'], ['half_period_s', '반주기', 's'], ['cycles', '횟수', '']],
  staircase: [['levels_mm', '계단(쉼표)', 'mm'], ['hold_s', '각 유지', 's']],
  const: [['ref_mm', '설정값', 'mm'], ['duration_s', '길이(빈칸=무한)', 's']],
};
const DEFAULTS = {
  step: { type: 'step', from_mm: 150, to_mm: 200, pre_s: 2, hold_s: 8 },
  square: { type: 'square', low_mm: 150, high_mm: 200, half_period_s: 6, cycles: 2 },
  staircase: { type: 'staircase', levels_mm: [120, 170, 270, 170], hold_s: 6 },
  const: { type: 'const', ref_mm: 170, duration_s: 20 },
};

/** 설정값 프로파일 편집기. 반환 요소에 .value() */
export function profileEditor(profile, { onChange, standard, radius_mm = null } = {}) {
  let p = { ...(profile || DEFAULTS.step) };
  const box = h('div', { class: 'profile-editor' });
  const fields = h('span', { class: 'row' });
  const desc = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  const emit = () => { desc.textContent = describeProfile(p) + (standard && JSON.stringify(standard) !== JSON.stringify(p) ? ' — 챕터 표준과 다름(샘플과 "조건 상이")' : ''); onChange && onChange({ ...p }); };
  const renderFields = () => {
    fields.textContent = '';
    for (const [k, lab, unit] of PROFILE_FIELDS[p.type]) {
      const val = Array.isArray(p[k]) ? p[k].join(', ') : (p[k] ?? '');
      fields.appendChild(h('label', null, `${lab} `, h('input', { type: k === 'levels_mm' ? 'text' : 'number', value: val, class: k === 'levels_mm' ? 'num-wide' : 'num', step: 'any',
        onchange: (e) => {
          const t = e.target.value.trim();
          if (k === 'levels_mm') p[k] = t.split(/[,\s]+/).map(Number).filter(Number.isFinite);
          else if (k === 'duration_s' && t === '') p[k] = null;
          else if (Number.isFinite(Number(t))) p[k] = Number(t);
          emit();
        } }), ` ${unit}`));
    }
  };
  const sel = h('select', { onchange: (e) => { p = { ...DEFAULTS[e.target.value] }; renderFields(); emit(); } },
    Object.keys(DEFAULTS).map((t) => h('option', { value: t, selected: t === p.type }, { step: '스텝', square: '왕복(사각파)', staircase: '계단', const: '일정' }[t])));
  renderFields();
  const conv = h('div', { class: 'muted', 'data-role': 'profile-coord', style: { fontSize: '.8rem' } },
    `위치 값(mm)은 모두 측정 거리(표면): 센서 앞면 → 공의 가까운 표면${Number.isFinite(radius_mm) ? `. 공 중심 = 측정 + ${radius_mm} mm` : ''}.`);
  box.append(h('div', { class: 'row' }, h('label', null, '설정값 프로파일 ', sel), fields), desc, conv);
  box.value = () => ({ ...p });
  box.setValue = (np) => { p = { ...np }; sel.value = p.type; renderFields(); emit(); };
  emit();
  return box;
}

/** 프로파일 시작 위치(mm) — 가상 장치의 공 배치용 */
export function startPositionMm(p) {
  if (!p) return null;
  return { step: p.from_mm, square: p.low_mm, staircase: p.levels_mm && p.levels_mm[0], const: p.ref_mm }[p.type] ?? null;
}
