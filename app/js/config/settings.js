// 장치 설정 (architecture §3: localStorage 'ballbeam.device_settings', 연결 때마다 재전송).
// 값은 프로토콜 단위로 저장한다: trim·lim = cdeg, fs = ms, alpha = ×1/1000, pmin/pmax = µs.

import { SERVO_PRESETS } from './servo-presets.js';
import { HwRecords, userDeviceProfile } from './hw-records.js';

const KEY = 'ballbeam.device_settings';
export const TRIG_PIN = 6;
export const ECHO_PIN = 7;

// DEFAULT_DEVICE.trim 은 0 이다(가상 장치·디지털 트윈 기구는 trim 0 이 수평, 다른 실제 장치는 조립마다 다름).
// 사용자 장치 실측 수평(서보각 83° → trim −700, hw-records 번들 수평 기록)은 '사용자 장치 프로필'로 따로 두고,
// 저장된 설정이 없을 때 제안해 한 번 클릭으로 적용한다(Settings.userProfile / applyUserProfile).
export const DEFAULT_DEVICE = Object.freeze({
  servo_model: 'HS5645MG', pmin: 544, pmax: 2400, servo_pin: 9, trim: 0, dir: 1, lim: 3000, fs: 60, alpha: 200,
  despike: 2, // 거리 이상값 제거(protocol 1.1.0 §3.1): 0 끔, 1 median3, 2 gate(펌웨어 기본). 구 펌웨어 1.0.0 에는 보내지 않는다
});

/** protocol §4 P 전송 순서(1.1.0: despike 는 alpha 다음) */
export const SEND_ORDER = ['servo_model', 'pmin', 'pmax', 'servo_pin', 'trim', 'dir', 'lim', 'fs', 'alpha', 'despike'];

/** 값 검증(protocol §4 표). 오류 메시지 배열 */
export function validate(s) {
  const err = [];
  if (!SERVO_PRESETS[s.servo_model]) err.push('서보 모델은 HS5645MG 또는 SG90');
  const pin = s.servo_pin;
  if (!Number.isInteger(pin) || pin < 2 || pin > 13) err.push('서보 핀은 D2~D13');
  else if (pin === TRIG_PIN || pin === ECHO_PIN) err.push(`서보 핀은 초음파 Trig(D${TRIG_PIN})/Echo(D${ECHO_PIN})와 겹칠 수 없습니다`);
  if (!(s.pmin >= 400 && s.pmin <= 2600)) err.push('pmin 400~2600 µs');
  if (!(s.pmax >= 400 && s.pmax <= 2600)) err.push('pmax 400~2600 µs');
  if (!(s.pmin < s.pmax)) err.push('pmin < pmax');
  if (!(s.trim >= -1500 && s.trim <= 1500)) err.push('trim −15°~15°');
  if (s.dir !== 1 && s.dir !== -1) err.push('dir 1 또는 −1');
  if (!(s.lim >= 0 && s.lim <= 3000)) err.push('각도 한계 0~30°');
  if (!(s.fs >= 60 && s.fs <= 200)) err.push('데이터 주기 60~200 ms');
  if (!(s.alpha >= 1 && s.alpha <= 1000)) err.push('필터 α 0.001~1');
  if (s.despike != null && ![0, 1, 2].includes(s.despike)) err.push('이상값 제거는 0(꺼짐)·1(중간값 3)·2(게이트)');
  return err;
}

export class Settings {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.listeners = new Set();
    const saved = this._load();
    /** 이 브라우저에 저장된 장치 설정이 있는가(없으면 사용자 장치 프로필을 제안) */
    this.hasSavedDevice = !!saved && typeof saved === 'object' && Object.keys(saved).length > 0;
    this.device = { ...DEFAULT_DEVICE, ...saved };
    this.servoPresets = SERVO_PRESETS;
    this.ui = this._loadUi();
    /** 하드웨어 보정·점검 기록(localStorage 'ballbeam.hw_records', data-schema §4.4) */
    this.hw = new HwRecords(storage);
  }
  _load() {
    try { return JSON.parse(this.storage?.getItem(KEY) || '{}'); } catch { return {}; }
  }
  _loadUi() {
    try { return JSON.parse(this.storage?.getItem('ballbeam.ui') || '{}'); } catch { return {}; }
  }
  saveUi(partial) {
    Object.assign(this.ui, partial);
    try { this.storage?.setItem('ballbeam.ui', JSON.stringify(this.ui)); } catch { /* 저장 불가 */ }
  }
  /** 부분 저장. 서보 모델을 바꾸면 펄스 범위를 프리셋으로 되돌린다(protocol: servo_model이 프리셋 적용) */
  save(partial) {
    const next = { ...this.device, ...partial };
    if (partial.servo_model && partial.servo_model !== this.device.servo_model && partial.pmin == null && partial.pmax == null) {
      next.pmin = SERVO_PRESETS[partial.servo_model].pmin_us;
      next.pmax = SERVO_PRESETS[partial.servo_model].pmax_us;
    }
    const err = validate(next);
    if (err.length) return { ok: false, errors: err };
    this.device = next;
    this.hasSavedDevice = true;
    try { this.storage?.setItem(KEY, JSON.stringify(next)); } catch { /* 저장 불가 */ }
    for (const f of this.listeners) f(this.device);
    return { ok: true, errors: [] };
  }
  reset() { this.device = { ...DEFAULT_DEVICE }; this.hasSavedDevice = false; try { this.storage?.removeItem(KEY); } catch { /* */ } for (const f of this.listeners) f(this.device); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** 사용자 장치 프로필(수평 실측 기록에서): { servo_model, trim, dir, record } 또는 null */
  userProfile() { return userDeviceProfile(this.hw); }
  /** 저장된 설정이 없어서 프로필을 제안할 때인가 */
  shouldSuggestProfile() { const p = this.userProfile(); return !this.hasSavedDevice && !!p && (p.trim !== this.device.trim || p.dir !== this.device.dir); }
  /** 사용자 장치 프로필 적용(한 번 클릭): servo_model·trim·dir 저장. 반환 save() 결과 + profile */
  applyUserProfile() {
    const p = this.userProfile();
    if (!p) return { ok: false, errors: ['적용할 수평 기록이 없거나 trim 이 ±15° 밖입니다'] };
    const partial = { trim: p.trim, dir: p.dir };
    if (p.servo_model && p.servo_model !== this.device.servo_model) partial.servo_model = p.servo_model;
    return { ...this.save(partial), profile: p };
  }
  /** 연결 직후 보낼 P 명령 목록 */
  commands(s = this.device) { return SEND_ORDER.map((k) => `P,${k},${s[k]}`); }
}
