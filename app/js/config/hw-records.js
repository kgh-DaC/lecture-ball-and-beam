// 하드웨어 보정·점검 기록 (localStorage 'ballbeam.hw_records', data-schema §4.4).
// - pot: 포텐쇼미터 보정 기록(서보각 ↔ A0 raw). 번들 기본 기록 = 사용자 실측(servo-presets.js POT_MEASURED_HS5645MG).
//   번들 기본 기록은 지울 수 없고, 고치면 덮어쓴 값(override)을 저장한다.
// - results: 위젯별 마지막 판정 { verdict: 'pass'|'fail'|'warn', at, summary } — hardware-steps 위젯이 읽는다.
// - steps: 점검 순서 단계별 수동 완료 표시 { done, at }.
// - logs: 조립 후 시험 결과 기록(level-trim, sensor-position-test, servo-center-assist) — 보정 기록 화면에 표로 보인다.
// - level: 수평(trim) 실측 기록 { id, date, servo_model, level_servo_deg, dir, trim_cdeg(= (서보각 − 90)·100), method, source, provenance }.
//   번들 기본 기록 = 사용자 장치 실측(servo-presets.js LEVEL_MEASURED_USER: 수평 서보각 83° → trim −700, dir 1). 지울 수 없고 고치면 level_override.
//   이 기록은 '사용자 장치 프로필'(userDeviceProfile)로 장치 설정에 한 번 클릭으로 적용한다(번들 DEFAULT_DEVICE.trim 은 0 그대로).
// 모든 값은 이 브라우저 안에만 있다(외부 전송 없음).

import { POT_MEASURED_HS5645MG, LEVEL_MEASURED_USER, SERVO_PRESETS, fitPotLine, levelDegToTrim, rawAtServoDeg, TRIM_LIMIT_CDEG } from './servo-presets.js';

export const HW_KEY = 'ballbeam.hw_records';
export const HW_SCHEMA_VER = 1;
export const BUNDLE_POT_ID = 'bundle-hs5645mg-2026-11-04';
export const BUNDLE_LEVEL_ID = 'bundle-level-hs5645mg-2026-11-04';
const MAX_LOGS = 60;

/** 번들 기본 포텐쇼미터 기록(사용자 실측) */
export function bundlePotRecord() {
  const m = POT_MEASURED_HS5645MG;
  const points = m.points.map((p) => ({ ...p }));
  return {
    id: BUNDLE_POT_ID, bundle: true, created_at: `${m.date}T00:00:00+09:00`, date: m.date, servo_model: m.servo_model,
    method: m.method, source: m.source, provenance: m.provenance, points, fit: fitPotLine(points), notes: '번들 기본값(사용자 제공 실측). 서보 혼 각도 기준 — 빔 수평은 조립 후 trim.',
  };
}

/** 기록 점 정리 + 직선 다시 계산(순수) */
export function normalizePotRecord(r) {
  const points = (r.points || []).map((p) => ({
    servo_deg: Number(p.servo_deg), raw_mean: Number(p.raw_mean),
    raw_sd: p.raw_sd === '' || p.raw_sd == null || !Number.isFinite(Number(p.raw_sd)) ? null : Number(p.raw_sd),
    n: p.n === '' || p.n == null || !Number.isFinite(Number(p.n)) ? null : Math.round(Number(p.n)),
  })).filter((p) => Number.isFinite(p.servo_deg) && Number.isFinite(p.raw_mean));
  return { ...r, points, fit: fitPotLine(points) };
}

/** 기록의 변환식(러너·위젯용, horn_cdeg = a·raw + b, 혼 각도 기준). 직선이 없으면 null */
export function calFromRecord(r) {
  if (!r || !r.fit || !Number.isFinite(r.fit.a_cdeg_per_lsb)) return null;
  return { order: 1, a_cdeg_per_lsb: r.fit.a_cdeg_per_lsb, b_cdeg: r.fit.b_cdeg, c: 0, basis: 'servo_horn' };
}

/** 번들 기본 수평 기록(사용자 장치 실측, LEVEL_MEASURED_USER) */
export function bundleLevelRecord() {
  const m = LEVEL_MEASURED_USER;
  return normalizeLevelRecord({
    id: BUNDLE_LEVEL_ID, bundle: true, created_at: `${m.date}T00:00:00+09:00`, date: m.date, servo_model: m.servo_model,
    level_servo_deg: m.level_servo_deg, dir: m.dir, method: m.method, source: m.source, provenance: m.provenance,
    notes: '번들 기본값(사용자 제공 실측). 조립한 그 장치에만 맞는 값 — 다른 장치는 level-trim 으로 다시 찾는다.',
  });
}

/**
 * 수평 기록 정리(순수): trim = (수평 서보각 − 90)·100 다시 계산, 범위(±1500) 판정, 그 서보각의 기대 A0(보정 직선, 기본 = 번들 실측 직선).
 * potFit: { a_cdeg_per_lsb, b_cdeg } (생략하면 서보 프리셋 pot_preset)
 */
export function normalizeLevelRecord(r, potFit = null) {
  let deg = r.level_servo_deg === '' || r.level_servo_deg == null ? NaN : Number(r.level_servo_deg);
  if (!Number.isFinite(deg) && r.trim_cdeg !== '' && r.trim_cdeg != null && Number.isFinite(Number(r.trim_cdeg))) deg = 90 + Number(r.trim_cdeg) / 100;
  const dir = Number(r.dir) === -1 ? -1 : 1;
  const trim = Number.isFinite(deg) ? levelDegToTrim(deg) : NaN;
  const fit = potFit || (SERVO_PRESETS[r.servo_model] && SERVO_PRESETS[r.servo_model].pot_preset) || null;
  return {
    ...r, level_servo_deg: Number.isFinite(deg) ? deg : null, dir, trim_cdeg: Number.isFinite(trim) ? trim : null,
    in_range: Number.isFinite(trim) && Math.abs(trim) <= TRIM_LIMIT_CDEG,
    a0_expected: Number.isFinite(deg) && fit ? rawAtServoDeg(deg, fit) : null,
  };
}

/**
 * 사용자 장치 프로필(순수): 적용할 수평 기록(사용자 기록 최신 → 번들 기본 실측)에서 장치 설정 조각을 만든다.
 * 반환 { servo_model, trim, dir, record } 또는 null(범위 밖·기록 없음)
 */
export function userDeviceProfile(records) {
  const r = records && records.activeLevel ? records.activeLevel() : bundleLevelRecord();
  if (!r || !r.in_range) return null;
  return { servo_model: r.servo_model, trim: r.trim_cdeg, dir: r.dir, record: r };
}

export class HwRecords {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.listeners = new Set();
    this.data = this._load();
  }
  _load() {
    let d = null;
    try { d = JSON.parse(this.storage?.getItem(HW_KEY) || 'null'); } catch { d = null; }
    if (!d || typeof d !== 'object') d = {};
    return { schema_ver: HW_SCHEMA_VER, pot: Array.isArray(d.pot) ? d.pot : [], bundle_override: d.bundle_override || null, active_pot: d.active_pot || {}, results: d.results || {}, steps: d.steps || {}, logs: Array.isArray(d.logs) ? d.logs : [],
      level: Array.isArray(d.level) ? d.level : [], level_override: d.level_override || null };
  }
  _save() {
    try { this.storage?.setItem(HW_KEY, JSON.stringify(this.data)); } catch { /* 저장 불가(사생활 보호 모드 등) */ }
    for (const f of this.listeners) { try { f(this); } catch (e) { console.error(e); } }
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** 포텐쇼미터 기록 목록(번들 기본 + 사용자). 최신이 뒤 */
  potRecords() {
    const b = this.data.bundle_override ? normalizePotRecord({ ...bundlePotRecord(), ...this.data.bundle_override, id: BUNDLE_POT_ID, bundle: true, edited: true }) : bundlePotRecord();
    return [b, ...this.data.pot.map((r) => normalizePotRecord(r))];
  }
  getPot(id) { return this.potRecords().find((r) => r.id === id) || null; }
  /** 새 기록 추가. 반환 저장된 기록 */
  addPot(rec, { activate = false } = {}) {
    const id = rec.id && rec.id !== BUNDLE_POT_ID ? rec.id : `pot-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    const r = normalizePotRecord({ created_at: new Date().toISOString(), ...rec, id, bundle: false });
    this.data.pot.push(r);
    if (activate) this.data.active_pot[r.servo_model] = id;
    this._save();
    return r;
  }
  /** 기록 수정(번들 기본 기록이면 덮어쓴 값으로 저장) */
  updatePot(id, partial) {
    if (id === BUNDLE_POT_ID) {
      this.data.bundle_override = { ...(this.data.bundle_override || {}), ...partial, edited_at: new Date().toISOString() };
    } else {
      const i = this.data.pot.findIndex((r) => r.id === id);
      if (i < 0) return null;
      this.data.pot[i] = normalizePotRecord({ ...this.data.pot[i], ...partial, edited_at: new Date().toISOString() });
    }
    this._save();
    return this.getPot(id);
  }
  /** 번들 기본 기록의 수정 취소 */
  resetBundle() { this.data.bundle_override = null; this._save(); }
  removePot(id) {
    if (id === BUNDLE_POT_ID) return false;
    this.data.pot = this.data.pot.filter((r) => r.id !== id);
    for (const [m, a] of Object.entries(this.data.active_pot)) if (a === id) delete this.data.active_pot[m];
    this._save();
    return true;
  }
  /** 적용할 기록 지정(서보 모델별). null = 번들 기본 */
  setActive(servo_model, id) { if (id == null || id === BUNDLE_POT_ID) delete this.data.active_pot[servo_model]; else this.data.active_pot[servo_model] = id; this._save(); }
  activePotId(servo_model) { return this.data.active_pot[servo_model] || (servo_model === 'HS5645MG' ? BUNDLE_POT_ID : null); }
  /** 적용 중인 기록(서보 모델별). SG90 은 사용자가 기록을 고르기 전에는 null */
  activePot(servo_model) {
    const id = this.activePotId(servo_model);
    const r = id ? this.getPot(id) : null;
    return r && r.servo_model === servo_model ? r : null;
  }
  /** 적용 중인 기록이 '사용자가 고른/고친 값'인가(번들 기본 그대로면 false) */
  activeIsUser(servo_model) {
    const r = this.activePot(servo_model);
    return !!r && (!r.bundle || !!r.edited);
  }

  /** 수평(trim) 기록 목록(번들 기본 = 사용자 장치 실측 + 사용자 기록). 최신이 뒤 */
  levelRecords() {
    const b = this.data.level_override ? normalizeLevelRecord({ ...bundleLevelRecord(), ...this.data.level_override, id: BUNDLE_LEVEL_ID, bundle: true, edited: true }) : bundleLevelRecord();
    return [b, ...this.data.level.map((r) => normalizeLevelRecord(r))];
  }
  getLevel(id) { return this.levelRecords().find((r) => r.id === id) || null; }
  /** 프로필에 쓸 수평 기록: 사용자 기록 중 최신(없으면 번들 기본 실측, 고쳤으면 고친 값) */
  activeLevel() { const L = this.levelRecords(); return L[L.length - 1]; }
  addLevel(rec) {
    const id = rec.id && rec.id !== BUNDLE_LEVEL_ID ? rec.id : `level-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    const r = normalizeLevelRecord({ created_at: new Date().toISOString(), ...rec, id, bundle: false });
    this.data.level.push(r);
    this._save();
    return r;
  }
  /** 수평 기록 수정(번들 기본 기록이면 덮어쓴 값으로 저장) */
  updateLevel(id, partial) {
    if (id === BUNDLE_LEVEL_ID) {
      this.data.level_override = { ...(this.data.level_override || {}), ...partial, edited_at: new Date().toISOString() };
    } else {
      const i = this.data.level.findIndex((r) => r.id === id);
      if (i < 0) return null;
      this.data.level[i] = normalizeLevelRecord({ ...this.data.level[i], ...partial, edited_at: new Date().toISOString() });
    }
    this._save();
    return this.getLevel(id);
  }
  resetLevelBundle() { this.data.level_override = null; this._save(); }
  removeLevel(id) {
    if (id === BUNDLE_LEVEL_ID) return false;
    this.data.level = this.data.level.filter((r) => r.id !== id);
    this._save();
    return true;
  }

  /** 위젯 판정 기록 */
  recordResult(widget, res) {
    const r = { verdict: res.verdict, at: res.at || new Date().toISOString(), summary: res.summary || '', provenance: res.provenance || null, data: res.data ?? null };
    this.data.results[widget] = r;
    if (res.log !== false) {
      this.data.logs.push({ widget, ...r });
      if (this.data.logs.length > MAX_LOGS) this.data.logs.splice(0, this.data.logs.length - MAX_LOGS);
    }
    this._save();
    return r;
  }
  lastResult(widget) { return this.data.results[widget] || null; }
  logs(widget) { return widget ? this.data.logs.filter((l) => l.widget === widget) : this.data.logs.slice(); }

  setStep(id, done) { this.data.steps[id] = { done: !!done, at: new Date().toISOString() }; this._save(); }
  step(id) { return this.data.steps[id] || null; }
  resetSteps() { this.data.steps = {}; this._save(); }
}

/** trim·dir 정리(순수): 숫자가 아니면 trim 0, dir 1 */
export function normTrimDir(trim_cdeg, dir) {
  const t = trim_cdeg === '' || trim_cdeg == null ? NaN : Number(trim_cdeg);
  return { trim_cdeg: Number.isFinite(t) ? t : 0, dir: Number(dir) === -1 ? -1 : 1 };
}

/**
 * 러너·위젯이 쓸 포텐쇼미터 변환 결정(순수, data-schema §4.4).
 * 우선순위: (1) 디지털 트윈 모드 → 트윈 자체 변환(twinCal; 트윈 플랜트가 pot_raw 를 그 식으로 만든다)
 *           (2) 사용자가 고른/고친 보정 기록 → source 'calibration', ref = 기록 created_at
 *           (3) 07장 캘리브레이션 마법사 결과(IndexedDB calibrations 최신) → source 'calibration'
 *           (4) 프리셋(번들 기본 = 사용자 실측) → source 'preset'
 * 반환 cal 에는 변환 기준(basis)과 지금 장치의 trim_cdeg·dir 가 붙는다 — loop/runner.js potToCdeg 가 θ_cmd = dir·(horn − trim) 으로 쓴다.
 *   basis 'servo_horn': 직선이 혼 각도(서보각 − 90°)·100 을 준다(보정 기록·프리셋·트윈 PRESET_POT_CAL — 트윈 플랜트도 pot = trim + dir·cmd 를 만든다).
 *   basis 'cmd': 07장 마법사처럼 명령각에 직접 맞춘 직선. 기록에 그때의 cal_trim_cdeg·cal_dir 가 있으면 혼 각도로 되돌린 뒤 지금 trim·dir 로 다시 바꾸고,
 *                없으면(예전 기록) 그대로 쓴다(맞춘 때와 trim·dir 가 같다고 가정).
 * trim_cdeg·dir: 장치가 보고한 값(device.config) → 없으면 저장된 설정. 생략하면 trim 0·dir 1(예전 동작과 같음).
 */
export function resolveCalibration({ mode, twinCal = null, records = null, servo_model, dbList = [], preset = null, trim_cdeg = 0, dir = 1 }) {
  const td = normTrimDir(trim_cdeg, dir);
  if (mode === 'twin' && twinCal) return { source: 'preset', ref: 'twin', a_cdeg_per_lsb: twinCal.a_cdeg_per_lsb, b_cdeg: twinCal.b_cdeg, c: twinCal.c || 0, basis: 'servo_horn', ...td };
  if (records && records.activeIsUser(servo_model)) {
    const r = records.activePot(servo_model);
    const c = calFromRecord(r);
    if (c) return { source: 'calibration', ref: r.created_at, record_id: r.id, ...c, ...td };
  }
  const list = dbList.filter((c) => c.servo_model === servo_model).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (list[0]) {
    const w = list[0];
    const extra = Number.isFinite(w.cal_trim_cdeg) ? { cal_trim_cdeg: w.cal_trim_cdeg, cal_dir: w.cal_dir === -1 ? -1 : 1 } : {};
    return { source: 'calibration', ref: w.created_at, ...w.fit, basis: 'cmd', ...extra, ...td };
  }
  return preset ? { source: 'preset', ref: null, a_cdeg_per_lsb: preset.a_cdeg_per_lsb, b_cdeg: preset.b_cdeg, c: preset.c || 0, basis: 'servo_horn', ...td } : null;
}

/** cal 에 지금 장치 trim·dir 를 덮어쓴 사본(순수). 장치 config 가 바뀐 뒤 모니터 변환을 맞출 때 쓴다 */
export function withTrimDir(cal, trim_cdeg, dir) {
  if (!cal) return cal;
  const td = normTrimDir(trim_cdeg, dir);
  return cal.trim_cdeg === td.trim_cdeg && cal.dir === td.dir ? cal : { ...cal, ...td };
}
