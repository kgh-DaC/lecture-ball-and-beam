// #/settings: 연결·하드웨어 점검 순서(조립 전 → 조립 → 조립 후 시험 위젯)·장치 설정(device-settings와 같은 컴포넌트)·서보 프리셋·보정 기록·캘리브레이션 기록.

import { h, clear, table, fmt, badge } from '../dom.js';
import * as deviceSettings from '../widgets/device-settings.js';
import * as signalMonitor from '../widgets/signal-monitor.js';
import * as angleLimit from '../widgets/angle-limit-finder.js';
import * as levelFinder from '../widgets/level-finder.js';
import * as hwSteps from '../widgets/hardware-steps.js';
import * as potTest from '../widgets/pot-mapping-test.js';
import * as centerAssist from '../widgets/servo-center-assist.js';
import * as levelTrim from '../widgets/level-trim.js';
import * as sensorPos from '../widgets/sensor-position-test.js';
import { mountCalRecords } from './cal-records.js';
import { BOARD_LABEL, CONNECT_HELP, PORT_NAMES } from '../../serial/troubleshoot.js';

/** 연결 문제 해결 안내(보드 중립). 시험·다른 화면에서도 쓴다 */
export function connectHelp(open = false) {
  return h('details', { class: 'conn-help', open: open || null },
    h('summary', null, `연결이 안 될 때 (${BOARD_LABEL} 공통)`),
    h('p', { class: 'muted' }, '포트 선택 창에 보이는 이름:'),
    h('ul', null, PORT_NAMES.map(([b, n]) => h('li', null, h('strong', null, b + ': '), n))),
    ...CONNECT_HELP.map((c) => h('div', { 'data-help': c.key }, h('h5', null, c.title), h('ul', null, c.items.map((t) => h('li', null, t))))));
}

export function mount(el, query, ctx) {
  const dev = ctx.device;
  const conn = h('div', { class: 'widget' });
  const ds = h('div', { class: 'widget' });
  const pre = h('div', { class: 'widget' });
  const cal = h('div', { class: 'widget' });
  const recs = h('div', { class: 'widget', id: 'cal-records' });
  const W = () => h('div', { class: 'widget' });
  const steps = W();
  const pre1 = [W(), W()];              // 조립 전: 포텐쇼미터 매핑, 서보 90° 고정
  const post = [W(), W(), W(), W(), W()]; // 조립 후: 수평 trim, 초음파 위치, 신호 확인, 각도 한계, 방향·수평(dir)
  el.append(conn, h('h2', null, '하드웨어 점검 순서'), steps,
    h('h2', null, 'A. 조립 전: 서보·포텐쇼미터 시험 → 서보 90° 고정'), ...pre1,
    h('h2', null, 'B. 조립 후: 수평 → 초음파 → 신호 확인 → 각도 한계'), ...post,
    h('h2', null, '보정 기록·장치 설정'), recs, ds, pre, cal);
  const renderConn = () => {
    clear(conn).appendChild(h('div', null, h('h4', null, '연결'),
      h('div', { class: 'row' },
        h('span', { class: 'muted' }, `보드: ${BOARD_LABEL} · 115200 bps `),
        h('label', null, '모드 ', h('select', { onchange: (e) => dev.setMode(e.target.value).catch((er) => ctx.ui.toast(er.message, 'error')) },
          [['device', '실제 장치'], ['virtual', '가상 장치'], ['twin', '디지털 트윈'], ['sample', '샘플 재생']].map(([v, l]) => h('option', { value: v, selected: dev.mode === v, disabled: v === 'device' && !dev.supported }, l)))),
        h('span', { class: `dot ${dev.status}` }), ` ${dev.status} `,
        dev.mode !== 'sample' ? (dev.connected ? h('button', { class: 'btn small', onclick: () => dev.disconnect() }, '연결 끊기') : h('button', { class: 'btn small primary', onclick: () => dev.connect().catch((e) => ctx.ui.toast(e.message, 'error')) }, '연결')) : null,
        dev.hello ? h('span', { class: 'muted' }, ` 펌웨어 ${dev.hello.fw_ver}, 프로토콜 ${dev.hello.proto_ver}`) : null,
        dev.parser && dev.parser.counts && dev.parser.counts.bad ? h('span', { class: 'muted' }, ` · 파싱 실패 ${dev.parser.counts.bad}줄`) : null),
      !dev.supported ? h('p', { class: 'muted' }, `Web Serial 사용 불가: ${dev.unsupportedReason}`) : null,
      dev.resetCount ? h('div', { class: 'box box-warn' }, `연결 중 보드 리셋 ${dev.resetCount}회 감지 — 서보 전원 부족 의심. 아래 "연결이 안 될 때"를 보세요.`) : null,
      dev.mode === 'device' ? connectHelp(dev.status === 'error' || !!dev.resetCount) : null,
      dev.log && dev.log.length ? h('details', null, h('summary', null, '통신 기록(최근)'), h('pre', { style: { maxHeight: '200px', overflow: 'auto', fontSize: '.75rem' } }, dev.log.slice(-60).join('\n'))) : null));
  };
  renderConn();
  const off = dev.onStatus(renderConn);
  const inst = deviceSettings.mount(ds, {}, ctx);
  const hwInst = [hwSteps.mount(steps, {}, ctx), potTest.mount(pre1[0], {}, ctx), centerAssist.mount(pre1[1], {}, ctx),
    levelTrim.mount(post[0], {}, ctx), sensorPos.mount(post[1], {}, ctx), signalMonitor.mount(post[2], {}, ctx), angleLimit.mount(post[3], {}, ctx), levelFinder.mount(post[4], {}, ctx),
    mountCalRecords(recs, ctx)];
  const P = ctx.settings.servoPresets;
  pre.append(h('h4', null, '서보 프리셋'), table(['모델', '펄스 범위(µs)', '공급 전압', '포텐쇼미터 기본 보정(혼 각도 기준)', '비고'],
    Object.values(P).map((p) => [p.label, `${p.pmin_us}~${p.pmax_us}`, p.supply_v || '–',
      p.pot_preset ? h('span', null, `a=${fmt(p.pot_preset.a_cdeg_per_lsb)}, b=${fmt(p.pot_preset.b_cdeg, 1)}${p.pot_preset.raw_at_90 != null ? `, 90° raw ${fmt(p.pot_preset.raw_at_90, 1)}` : ''} (${p.pot_preset.source}) `, p.pot_preset.provenance === 'measured' ? badge('실측', 'b-real') : badge('가정값', 'b-assumed')) : '없음(실측 필요)', p.note || ''])));
  (async () => {
    const list = ctx.db ? await ctx.db.getAll('calibrations') : [];
    cal.append(h('h4', null, '저장된 캘리브레이션'));
    if (!list.length) cal.appendChild(h('p', { class: 'muted' }, '없음 — 07장 캘리브레이션 마법사로 만듭니다. 그 전에는 프리셋(가정값)을 씁니다.'));
    else cal.appendChild(table(['시각', '서보', 'a', 'b', '잔차 최대(cdeg)', '출처'], list.map((c) => [c.created_at, c.servo_model, fmt(c.fit.a_cdeg_per_lsb), fmt(c.fit.b_cdeg, 1), fmt(c.residual_max_cdeg, 1), c.provenance === 'real' ? badge('실측', 'b-real') : badge('시뮬레이션', 'b-sim')])));
  })();
  return { unmount() { off(); inst.unmount && inst.unmount(); hwInst.forEach((i) => i.unmount && i.unmount()); } };
}
