// device-settings: 장치 설정 화면(#/settings와 같은 컴포넌트). 값은 localStorage에 두고 연결할 때마다 재전송한다.
// 화면 단위(°, s, 0~1) ↔ 프로토콜 단위(cdeg, ms, ×1000) 변환은 여기서만.

import { h, checkProps, clear, errorBox, infoBox, toast, table } from '../dom.js';
import { head } from './_util.js';
import { TRIG_PIN, ECHO_PIN, DEFAULT_DEVICE } from '../../config/settings.js';
import { DESPIKE_LABEL } from '../../sim/dist-filter.js';

export const accepts = ['fields'];

const ALL = ['servo_model', 'servo_pin', 'trim', 'dir', 'lim', 'fs', 'alpha', 'despike'];

/** configure() 결과를 적용·같음·미지원(안내)·실패로 나눈다(순수). 미지원(1.0.0 펌웨어의 despike 등)은 실패로 치지 않는다 */
export function splitResults(res) {
  return { bad: res.filter((x) => !x.ok && !x.unsupported), unsupported: res.filter((x) => !x.ok && x.unsupported) };
}

/** 화면 값 → 프로토콜 값(순수) */
export function toDevice(key, v) {
  switch (key) {
    case 'trim': case 'lim': return Math.round(Number(v) * 100);
    case 'alpha': return Math.round(Number(v) * 1000);
    case 'servo_pin': case 'dir': case 'fs': case 'pmin': case 'pmax': case 'despike': return Math.round(Number(v));
    default: return v;
  }
}
export function fromDevice(key, v) {
  switch (key) {
    case 'trim': case 'lim': return v / 100;
    case 'alpha': return v / 1000;
    default: return v;
  }
}

export function mount(el, props, ctx) {
  checkProps(el, 'device-settings', props, accepts);
  const S = ctx.settings, dev = ctx.device;
  if (!S) { el.appendChild(errorBox('설정 서비스가 없습니다')); return {}; }
  const fields = (props.fields || ALL).filter((f) => ALL.includes(f) || f === 'pmin' || f === 'pmax');
  el.appendChild(head('장치 설정', h('span', { class: 'muted' }, '이 브라우저에 저장되고, 연결할 때마다 장치로 다시 보냅니다')));
  const form = h('div');
  const out = h('div');
  el.append(form, out);
  const draft = { ...S.device };
  const input = (key) => {
    const v = fromDevice(key, draft[key]);
    const set = (x) => { draft[key] = toDevice(key, x); };
    switch (key) {
      case 'servo_model': return h('select', { onchange: (e) => { draft.servo_model = e.target.value; const p = S.servoPresets[e.target.value]; draft.pmin = p.pmin_us; draft.pmax = p.pmax_us; } },
        Object.values(S.servoPresets).map((p) => h('option', { value: p.id, selected: p.id === draft.servo_model }, p.label)));
      case 'servo_pin': return h('select', { onchange: (e) => set(e.target.value) },
        Array.from({ length: 12 }, (_, i) => i + 2).filter((p) => p !== TRIG_PIN && p !== ECHO_PIN).map((p) => h('option', { value: p, selected: p === draft.servo_pin }, `D${p}${p === 9 ? ' (기본)' : ''}`)));
      case 'despike': {
        const sel = h('select', { onchange: (e) => set(e.target.value) }, [2, 1, 0].map((d) => h('option', { value: d, selected: d === (draft.despike ?? 2) }, DESPIKE_LABEL[d])));
        if (dev && dev.connected && dev.supportsKey && !dev.supportsKey('despike')) sel.title = '연결된 펌웨어(1.0.0)는 이 설정을 지원하지 않습니다. 저장은 되며 1.1.0 업로드 후 연결하면 보냅니다';
        return sel;
      }
      case 'dir': return h('select', { onchange: (e) => set(e.target.value) }, [1, -1].map((d) => h('option', { value: d, selected: d === draft.dir }, d === 1 ? '정방향 (1)' : '역방향 (−1)')));
      case 'trim': return h('input', { type: 'number', min: -15, max: 15, step: 0.1, value: v, class: 'num', onchange: (e) => set(e.target.value) });
      case 'lim': return h('input', { type: 'number', min: 0, max: 30, step: 0.5, value: v, class: 'num', onchange: (e) => set(e.target.value) });
      case 'fs': return h('input', { type: 'number', min: 60, max: 200, step: 10, value: v, class: 'num', onchange: (e) => set(e.target.value) });
      case 'alpha': return h('input', { type: 'number', min: 0.001, max: 1, step: 0.05, value: v, class: 'num', onchange: (e) => set(e.target.value) });
      default: return h('input', { type: 'number', value: v, class: 'num', onchange: (e) => set(e.target.value) });
    }
  };
  const LABEL = { servo_model: ['서보 모델', ''], servo_pin: ['서보 신호 핀', `Trig D${TRIG_PIN}·Echo D${ECHO_PIN} 제외`], trim: ['수평 보정 trim', '°'], dir: ['서보 방향 dir', 'θ>0이면 공이 센서에서 멀어지게'], lim: ['각도 한계', '° (≤ 30)'], fs: ['데이터 주기', 'ms (60~200)'], alpha: ['센서 필터 α', '0~1, 클수록 덜 거름'], despike: ['거리 이상값 제거', '펌웨어 1.1.0 이상. 게이트: 지연 없음 · 중간값 3: 1 샘플 지연'], pmin: ['최소 펄스', 'µs'], pmax: ['최대 펄스', 'µs'] };
  let prof = null;
  const render = () => {
    clear(form);
    prof = S.userProfile ? S.userProfile() : null;
    if (prof && S.shouldSuggestProfile && S.shouldSuggestProfile()) {
      const r = prof.record;
      form.appendChild(h('div', { class: 'box box-info', 'data-role': 'profile-suggest' },
        `저장된 장치 설정이 없습니다. 사용자 장치 실측 프로필을 적용할까요? — ${r.date} ${r.method}: 수평 서보각 ${r.level_servo_deg}° → trim ${prof.trim} cdeg(${prof.trim / 100}°), dir ${prof.dir}, ${r.servo_model}. `,
        h('span', { class: 'muted' }, '조립한 그 장치에만 맞는 값입니다. 가상 장치·디지털 트윈 연습은 기본값(trim 0)이 수평입니다. '),
        h('button', { class: 'btn small primary', onclick: async () => { Object.assign(draft, { trim: prof.trim, dir: prof.dir }); if (prof.servo_model && prof.servo_model !== draft.servo_model) { draft.servo_model = prof.servo_model; draft.pmin = S.servoPresets[prof.servo_model].pmin_us; draft.pmax = S.servoPresets[prof.servo_model].pmax_us; } await save(); render(); } }, '한 번 클릭으로 적용')));
    }
    for (const k of fields) form.appendChild(h('label', { class: 'slider-row' }, h('span', { class: 'sl-label' }, LABEL[k][0]), input(k), h('span', { class: 'sl-unit' }, LABEL[k][1])));
    form.appendChild(h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => save() }, '저장' + (dev && dev.connected ? '하고 장치에 보내기' : '')),
      h('button', { class: 'btn', title: '번들 기본값(trim 0 — 가상 장치·트윈 기구의 수평)', onclick: () => { Object.assign(draft, DEFAULT_DEVICE); render(); } }, '기본값'),
      prof ? h('button', { class: 'btn', 'data-role': 'profile-draft', title: `수평 실측 기록: 서보각 ${prof.record.level_servo_deg}° → trim ${prof.trim} cdeg`, onclick: () => { Object.assign(draft, { trim: prof.trim, dir: prof.dir }, prof.servo_model && prof.servo_model !== draft.servo_model ? { servo_model: prof.servo_model, pmin: S.servoPresets[prof.servo_model].pmin_us, pmax: S.servoPresets[prof.servo_model].pmax_us } : {}); render(); } }, `사용자 장치 프로필(trim ${prof.trim / 100}°)`) : null,
      dev && dev.connected ? h('span', { class: 'muted' }, `장치 보고(fw ${dev.hello?.fw_ver ?? '?'}): ${['servo_model', 'servo_pin', 'trim', 'dir', 'lim', 'fs', 'alpha', 'despike'].map((k) => `${k}=${dev.config[k] ?? (k === 'despike' ? '없음' : '?')}`).join(' ')}`) : null));
    if (fields.includes('despike') && dev && dev.connected && dev.supportsKey && !dev.supportsKey('despike')) {
      form.appendChild(infoBox('연결된 펌웨어는 거리 이상값 제거(despike)를 지원하지 않습니다(1.0.0 — C,despike 보고 없음). 이 설정은 이 브라우저에만 저장되고, 펌웨어 1.1.0을 올린 뒤 연결하면 자동으로 보냅니다. 지금 filt_mm에는 튄 값이 그대로 들어갑니다.'));
    }
  };
  const save = async () => {
    clear(out);
    const running = ctx.runner && ctx.runner.state === 'running';
    if (running) { out.appendChild(errorBox('실험 중에는 설정을 바꿀 수 없습니다.')); return; }
    const r = S.save({ ...draft });
    if (!r.ok) { out.appendChild(errorBox('설정 오류: ' + r.errors.join('; '))); return; }
    if (dev && dev.connected) {
      if (dev.devMode !== 0 && dev.devMode != null) { try { await dev.setDeviceMode(0); } catch { /* */ } }
      const res = await dev.configure(S.device);
      const { bad, unsupported } = splitResults(res);
      out.appendChild(table(['키', '결과'], res.map((x) => [x.key, x.ok ? (x.same ? '같음' : '적용') : x.unsupported ? `건너뜀: ${x.err}` : `실패: ${x.err}`])));
      if (unsupported.length) out.appendChild(infoBox(`연결된 펌웨어(${dev.hello?.fw_ver ?? '?'})가 지원하지 않아 보내지 않은 설정: ${unsupported.map((b) => b.key).join(', ')}. 저장은 되었고 연결은 그대로입니다. 펌웨어 1.1.0을 올리면 다음 연결 때 보냅니다.`));
      if (bad.length) out.appendChild(errorBox(`일부 설정이 적용되지 않았습니다: ${bad.map((b) => b.key).join(', ')}`));
      else toast('장치에 설정을 보냈습니다', 'ok');
    } else {
      out.appendChild(infoBox('저장했습니다. 장치를 연결하면 자동으로 보냅니다.'));
    }
    if (ctx.runner && ctx.runner.refreshCalibration) ctx.runner.refreshCalibration();
  };
  render();
  const off = dev ? dev.onStatus(() => render()) : null;
  return { unmount() { off && off(); } };
}
