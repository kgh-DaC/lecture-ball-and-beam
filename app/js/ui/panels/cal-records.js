// '보정 기록' 표(#/settings 하드웨어 설정): 포텐쇼미터 보정 기록(서보각 ↔ A0) 목록·적용·사용자 입력/수정·삭제와 조립 후 시험 기록.
// 저장은 settings.hw(localStorage 'ballbeam.hw_records', data-schema §4.4). 번들 기본 기록 = 사용자 실측(2026-11-04, 0/90/180°, 각 n=10).

import { h, clear, table, fmt, badge, toast, download, errorBox } from '../dom.js';
import { fitPotLine, SERVO_IDS, levelDegToTrim, TRIM_LIMIT_CDEG } from '../../config/servo-presets.js';
import { BUNDLE_POT_ID, BUNDLE_LEVEL_ID } from '../../config/hw-records.js';

const PROV = { measured: ['실측', 'b-real'], real: ['실측', 'b-real'], simulated: ['시뮬레이션', 'b-sim'], assumed: ['가정값', 'b-assumed'] };
const provBadge = (p) => { const [t, c] = PROV[p] || ['출처 불명', 'b-unknown']; return badge(t, c); };
const WNAME = { 'pot-mapping-test': '포텐쇼미터 매핑', 'servo-center-assist': '서보 90° 고정', 'level-trim': '수평 trim', 'sensor-position-test': '초음파 위치 응답', 'signal-monitor': '신호 확인', 'angle-limit-finder': '각도 제한' };
const VERD = { pass: ['합격', 'b-ok'], fail: ['불합격', 'b-bad'], warn: ['주의', 'b-assumed'] };

export function mountCalRecords(el, ctx) {
  const hw = ctx.settings.hw;
  const box = h('div');
  const form = h('div');
  const logs = h('div');
  const lvBox = h('div', { 'data-role': 'level-records' });
  const lvForm = h('div');
  el.append(h('h4', null, '보정 기록 (포텐쇼미터: 서보 혼 각도 ↔ A0)'),
    h('p', { class: 'muted' }, '직선은 서보 혼 각도 기준입니다(horn = (서보각 − 90°)·100 cdeg). 명령 좌표 각도는 펌웨어 식 서보각 = 90° + trim/100 + dir·cmd/100 을 뒤집어 θ = dir·(horn − trim) 으로 구합니다. 빔의 실제 수평은 조립 후 trim으로 맞춥니다. "적용" 표시된 기록이 A0 → 각도 변환(러너 servo_pot_cdeg, 위젯 기대값)에 쓰입니다. 값은 이 브라우저에만 저장됩니다.'),
    box, form,
    h('h4', null, '수평(trim) 기록 (조립 후: 공이 흘러가지 않는 서보각)'),
    h('p', { class: 'muted' }, `trim = (수평 서보각 − 90°) × 100 cdeg (명령 0 에서 서보각 = 90° + trim/100, dir 무관). 한계 ±${TRIM_LIMIT_CDEG / 100}° → 서보각 ${90 - TRIM_LIMIT_CDEG / 100}°~${90 + TRIM_LIMIT_CDEG / 100}°. 번들 기본 장치 설정(trim 0)은 바꾸지 않습니다 — 이 기록은 "사용자 장치 프로필"로 적용합니다(가상 장치·트윈 기구는 trim 0 이 수평).`),
    lvBox, lvForm,
    h('h4', null, '하드웨어 시험 기록(조립 전·후)'), logs);
  let editing = null; // { id|null, draft }
  let lvEditing = null; // { id|null, draft }

  const pointsText = (r) => h('div', null, r.points.map((p) => h('div', { style: { whiteSpace: 'nowrap' } }, `${p.servo_deg}° → ${fmt(p.raw_mean, 1)}`, h('span', { class: 'muted' }, ` σ ${p.raw_sd == null ? '–' : fmt(p.raw_sd, 2)} · n ${p.n ?? '–'}`))));
  const fitText = (f) => (f ? h('div', null, h('div', null, `${fmt(f.slope_lsb_per_deg, 4)} LSB/° · 90° raw ${fmt(f.raw_at_90, 1)}`), h('div', { class: 'muted' }, `a ${fmt(f.a_cdeg_per_lsb, 4)} cdeg/LSB, b ${fmt(f.b_cdeg, 1)} cdeg, 잔차 최대 ${fmt(f.residual_max_lsb, 2)} LSB${f.monotonic === 'down' ? ' · 감소 방향' : ''}`)) : h('span', { class: 'muted' }, '점 2개 이상 필요'));

  const paint = () => {
    const recs = hw.potRecords();
    clear(box).appendChild(table(['적용', '날짜', '서보 모델', '측정 방법', '점별 서보각 → raw 평균 · σ · n', '직선 계수', '출처', '작업'], recs.map((r) => {
      const active = hw.activePotId(r.servo_model) === r.id;
      return [
        active ? badge('● 적용 중', 'b-ok') : h('button', { class: 'btn small', onclick: () => { hw.setActive(r.servo_model, r.id); toast(`${r.servo_model} 보정 기록을 적용했습니다`, 'ok'); } }, '적용'),
        r.date || String(r.created_at).slice(0, 10), r.servo_model, h('div', { style: { maxWidth: '18rem' } }, r.method || '', r.source ? h('div', { class: 'muted' }, r.source) : null),
        pointsText(r), fitText(r.fit),
        h('span', null, provBadge(r.provenance), r.bundle ? badge('번들 기본', 'b-unknown') : null, r.edited ? badge('수정됨', 'b-assumed') : null, r.verdict ? badge(...(VERD[r.verdict] || ['', ''])) : null),
        h('span', null, h('button', { class: 'btn small', onclick: () => { editing = { id: r.id, draft: JSON.parse(JSON.stringify(r)) }; paintForm(); } }, '수정'),
          r.bundle && r.edited ? h('button', { class: 'btn small', onclick: () => { hw.resetBundle(); toast('번들 기본값(사용자 실측)으로 되돌렸습니다', 'ok'); } }, '수정 취소') : null,
          !r.bundle ? h('button', { class: 'btn small', onclick: () => { if (typeof globalThis.confirm !== 'function' || globalThis.confirm('이 보정 기록을 지울까요?')) hw.removePot(r.id); } }, '삭제') : null),
      ];
    }), { cls: 'cal-records' }));
    box.appendChild(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { editing = { id: null, draft: { date: new Date().toISOString().slice(0, 10), servo_model: ctx.settings.device.servo_model, method: '서보각별 A0 평균(사용자 입력)', source: '사용자 입력', provenance: 'measured', points: [{ servo_deg: 0, raw_mean: '', raw_sd: '', n: 10 }, { servo_deg: 90, raw_mean: '', raw_sd: '', n: 10 }, { servo_deg: 180, raw_mean: '', raw_sd: '', n: 10 }] } }; paintForm(); } }, '새 기록 입력(사용자 제공 값)'),
      h('button', { class: 'btn', onclick: () => download('hw_records.json', JSON.stringify({ ...hw.data, pot_records: hw.potRecords() }, null, 2), 'application/json') }, '보정·점검 기록 내려받기(JSON)')));
    paintLevels();
    paintLogs();
  };

  const paintLevels = () => {
    const L = hw.levelRecords ? hw.levelRecords() : [];
    const S = ctx.settings;
    const latest = L[L.length - 1];
    clear(lvBox).appendChild(table(['날짜', '서보 모델', '측정 방법', '수평 서보각', 'dir', 'trim', '기대 A0', '출처', '작업'], L.map((r) => [
      r.date || String(r.created_at).slice(0, 10), r.servo_model, h('div', { style: { maxWidth: '18rem' } }, r.method || '', r.source ? h('div', { class: 'muted' }, r.source) : null),
      r.level_servo_deg == null ? '–' : `${fmt(r.level_servo_deg, 2)}°`, String(r.dir), r.trim_cdeg == null ? '–' : h('span', null, `${r.trim_cdeg} cdeg`, r.in_range ? null : badge('±15° 밖', 'b-bad')),
      Number.isFinite(r.a0_expected) ? fmt(r.a0_expected, 1) : '–',
      h('span', null, provBadge(r.provenance), r.bundle ? badge('번들 기본', 'b-unknown') : null, r.edited ? badge('수정됨', 'b-assumed') : null, r === latest ? badge('프로필', 'b-ok') : null),
      h('span', null, h('button', { class: 'btn small', onclick: () => { lvEditing = { id: r.id, draft: JSON.parse(JSON.stringify(r)) }; paintLvForm(); } }, '수정'),
        r.bundle && r.edited ? h('button', { class: 'btn small', onclick: () => { hw.resetLevelBundle(); toast('번들 기본값(사용자 실측 83°)으로 되돌렸습니다', 'ok'); } }, '수정 취소') : null,
        !r.bundle ? h('button', { class: 'btn small', onclick: () => { if (typeof globalThis.confirm !== 'function' || globalThis.confirm('이 수평 기록을 지울까요?')) hw.removeLevel(r.id); } }, '삭제') : null),
    ]), { cls: 'level-records' }));
    const p = S.userProfile ? S.userProfile() : null;
    const applied = p && S.device.trim === p.trim && S.device.dir === p.dir;
    lvBox.appendChild(h('div', { class: 'row' },
      p ? h('button', { class: 'btn' + (S.shouldSuggestProfile && S.shouldSuggestProfile() ? ' primary' : ''), 'data-role': 'apply-profile', onclick: () => applyProfile() }, `사용자 장치 프로필 적용(trim ${p.trim} cdeg, dir ${p.dir})`) : null,
      p ? h('span', { class: 'muted' }, applied ? '장치 설정에 적용됨' : `현재 장치 설정: trim ${S.device.trim}, dir ${S.device.dir}${S.hasSavedDevice ? '' : ' (저장된 설정 없음 — 기본값)'}`) : null,
      h('button', { class: 'btn', onclick: () => { lvEditing = { id: null, draft: { date: new Date().toISOString().slice(0, 10), servo_model: S.device.servo_model, level_servo_deg: '', dir: S.device.dir, method: '공이 굴러가지 않는 서보각 탐색(사용자 입력)', source: '사용자 입력', provenance: 'measured' } }; paintLvForm(); } }, '새 수평 기록 입력')));
  };

  const applyProfile = async () => {
    const S = ctx.settings, dev = ctx.device;
    if (ctx.runner && ctx.runner.state === 'running') { toast('실험 중에는 설정을 바꿀 수 없습니다', 'error'); return; }
    const r = S.applyUserProfile();
    if (!r.ok) { toast(r.errors.join('; '), 'error'); return; }
    let sent = '';
    if (dev && dev.connected) {
      try {
        if (dev.devMode !== 0 && dev.devMode != null) await dev.setDeviceMode(0);
        const res = await dev.configure(S.device, ['servo_model', 'trim', 'dir']);
        sent = res.every((x) => x.ok) ? ' · 장치에 보냄' : ' · 일부 장치 전송 실패';
      } catch (e) { sent = ` · 장치 전송 실패(${e.message})`; }
    }
    toast(`사용자 장치 프로필 적용: trim ${r.profile.trim} cdeg, dir ${r.profile.dir}${sent}${dev && dev.mode !== 'device' ? ' (가상 장치·트윈 기구는 trim 0 이 수평 — 연습 때는 기본값으로 되돌리세요)' : ''}`, 'ok', 8000);
    if (ctx.runner && ctx.runner.refreshCalibration) ctx.runner.refreshCalibration();
    paint();
  };

  const paintLvForm = () => {
    clear(lvForm);
    if (!lvEditing) return;
    const d = lvEditing.draft;
    const prev = h('span', { class: 'muted' });
    const err = h('div');
    const preview = () => {
      const deg = Number(d.level_servo_deg);
      const t = String(d.level_servo_deg ?? '') !== '' && Number.isFinite(deg) ? levelDegToTrim(deg) : null;
      clear(prev).append(t == null ? '서보각을 넣으면 trim 을 계산합니다' : `trim = (${deg} − 90) × 100 = ${t} cdeg${Math.abs(t) > TRIM_LIMIT_CDEG ? ' — ±15° 밖(서보 혼을 옮겨 다시 끼우세요)' : ''}`);
    };
    const inp = (key, cls = 'num', type = 'text') => h('input', { value: d[key] ?? '', class: cls, type, step: 'any', oninput: (e) => { d[key] = e.target.value; preview(); } });
    lvForm.append(h('div', { class: 'panel-sec' }, h('h4', null, lvEditing.id ? (lvEditing.id === BUNDLE_LEVEL_ID ? '번들 기본 수평 기록 수정(덮어쓴 값으로 저장)' : '수평 기록 수정') : '새 수평 기록(사용자 제공 값)'),
      h('div', { class: 'row' }, h('label', null, '날짜 ', inp('date', 'num-wide')),
        h('label', null, ' 서보 모델 ', h('select', { onchange: (e) => { d.servo_model = e.target.value; } }, SERVO_IDS.map((m) => h('option', { value: m, selected: d.servo_model === m }, m)))),
        h('label', null, ' 출처 ', h('select', { onchange: (e) => { d.provenance = e.target.value; } }, [['measured', '실측'], ['simulated', '시뮬레이션']].map(([v, l]) => h('option', { value: v, selected: d.provenance === v }, l))))),
      h('div', { class: 'row' }, h('label', null, '수평 서보각(°) ', inp('level_servo_deg', 'num', 'number')),
        h('label', null, ' dir ', h('select', { onchange: (e) => { d.dir = Number(e.target.value); } }, [1, -1].map((v) => h('option', { value: v, selected: Number(d.dir) === v }, String(v))))), prev),
      h('div', { class: 'row' }, h('label', null, '측정 방법 ', inp('method', 'num-wide')), h('label', null, ' 출처 설명 ', inp('source', 'num-wide'))),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => {
        clear(err);
        const deg = Number(d.level_servo_deg);
        if (String(d.level_servo_deg ?? '') === '' || !Number.isFinite(deg)) { err.appendChild(errorBox('수평 서보각(°)을 넣으세요.')); return; }
        if (Math.abs(levelDegToTrim(deg)) > TRIM_LIMIT_CDEG) { err.appendChild(errorBox(`서보각 ${deg}° 는 trim ±15° 밖입니다(75°~105°). 서보 혼을 옮겨 다시 끼운 뒤 다시 재세요.`)); return; }
        const rec = { date: d.date, servo_model: d.servo_model, level_servo_deg: deg, dir: Number(d.dir) === -1 ? -1 : 1, method: d.method, source: d.source, provenance: d.provenance };
        if (lvEditing.id) hw.updateLevel(lvEditing.id, rec); else hw.addLevel(rec);
        lvEditing = null; clear(lvForm); toast('수평 기록을 저장했습니다', 'ok');
      } }, '저장'), h('button', { class: 'btn', onclick: () => { lvEditing = null; clear(lvForm); } }, '취소'))));
    preview();
  };

  const paintForm = () => {
    clear(form);
    if (!editing) return;
    const d = editing.draft;
    const inp = (obj, key, attrs = {}) => h('input', { value: obj[key] ?? '', class: attrs.cls || 'num', type: attrs.type || 'text', step: 'any', oninput: (e) => { obj[key] = e.target.value; preview(); } });
    const prev = h('div', { class: 'muted' });
    const err = h('div');
    const filled = () => d.points.filter((p) => String(p.raw_mean ?? '') !== '' && String(p.servo_deg ?? '') !== '').map((p) => ({ servo_deg: Number(p.servo_deg), raw_mean: Number(p.raw_mean) }));
    const preview = () => {
      const f = fitPotLine(filled());
      clear(prev).appendChild(f ? fitText(f) : h('span', null, '직선: 점 2개 이상 입력'));
    };
    const ptRows = h('tbody');
    const paintPts = () => {
      clear(ptRows);
      d.points.forEach((p, i) => ptRows.appendChild(h('tr', null, h('td', null, inp(p, 'servo_deg', { type: 'number' })), h('td', null, inp(p, 'raw_mean', { type: 'number' })), h('td', null, inp(p, 'raw_sd', { type: 'number' })), h('td', null, inp(p, 'n', { type: 'number' })),
        h('td', null, h('button', { class: 'btn small', onclick: () => { d.points.splice(i, 1); paintPts(); preview(); } }, '빼기')))));
    };
    paintPts();
    form.append(h('div', { class: 'panel-sec' }, h('h4', null, editing.id ? (editing.id === BUNDLE_POT_ID ? '번들 기본 기록 수정(덮어쓴 값으로 저장)' : '보정 기록 수정') : '새 보정 기록(사용자 제공 값)'),
      h('div', { class: 'row' }, h('label', null, '날짜 ', inp(d, 'date', { cls: 'num-wide' })),
        h('label', null, ' 서보 모델 ', h('select', { onchange: (e) => { d.servo_model = e.target.value; } }, SERVO_IDS.map((m) => h('option', { value: m, selected: d.servo_model === m }, m)))),
        h('label', null, ' 출처 ', h('select', { onchange: (e) => { d.provenance = e.target.value; } }, [['measured', '실측'], ['simulated', '시뮬레이션']].map(([v, l]) => h('option', { value: v, selected: d.provenance === v }, l))))),
      h('div', { class: 'row' }, h('label', null, '측정 방법 ', inp(d, 'method', { cls: 'num-wide' })), h('label', null, ' 출처 설명 ', inp(d, 'source', { cls: 'num-wide' }))),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ...['서보각(°)', 'raw 평균', 'σ (LSB)', 'n', ''].map((t) => h('th', null, t)))), ptRows),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { d.points.push({ servo_deg: '', raw_mean: '', raw_sd: '', n: '' }); paintPts(); } }, '점 추가'), prev),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => {
        clear(err);
        const pts = d.points.filter((p) => String(p.raw_mean ?? '') !== '' && String(p.servo_deg ?? '') !== '');
        if (!fitPotLine(filled())) { err.appendChild(errorBox('서보각이 다른 점이 2개 이상 있어야 직선을 맞출 수 있습니다.')); return; }
        const rec = { date: d.date, servo_model: d.servo_model, method: d.method, source: d.source, provenance: d.provenance, points: pts };
        if (editing.id) hw.updatePot(editing.id, rec); else hw.addPot(rec);
        editing = null; clear(form); toast('보정 기록을 저장했습니다', 'ok');
      } }, '저장'), h('button', { class: 'btn', onclick: () => { editing = null; clear(form); } }, '취소'))));
    preview();
  };

  const paintLogs = () => {
    const L = hw.logs().slice().reverse();
    clear(logs).appendChild(L.length ? table(['시각', '시험', '판정', '요약', '출처'], L.map((l) => [String(l.at).slice(0, 16).replace('T', ' '), WNAME[l.widget] || l.widget, badge(...(VERD[l.verdict] || ['–', 'b-unknown'])), l.summary, provBadge(l.provenance)]))
      : h('p', { class: 'muted' }, '아직 없음 — 아래 조립 전·후 시험 위젯에서 결과를 저장하면 여기에 쌓입니다.'));
  };

  const off = hw.onChange(() => paint());
  const offS = ctx.settings.onChange ? ctx.settings.onChange(() => paintLevels()) : null;
  paint();
  return { unmount() { off(); offS && offS(); }, paint, applyProfile, editLevel: (id) => { const r = hw.getLevel(id); lvEditing = { id, draft: JSON.parse(JSON.stringify(r)) }; paintLvForm(); }, get lvEditing() { return lvEditing; }, edit: (id) => { const r = hw.getPot(id); editing = { id, draft: JSON.parse(JSON.stringify(r)) }; paintForm(); }, get editing() { return editing; } };
}
