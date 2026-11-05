// wiring-diagram: 현재 장치 설정(서보 핀·서보 모델)을 반영한 배선도. 부품·선을 누르면 설명 (architecture.md §3).
// 보드: props.board = "nano"(기본: Nano V3.0 호환 + I/O 확장 실드) | "uno"(이전 구성, 02장 json 하위호환).
// 전원 규칙(두 보드 공통): 보드는 USB, 서보는 별도 5.0 V(2 A 이상). 서보 전원 GND와 보드 GND만 공통,
// 서보 5 V를 보드 5V 핀에 잇지 않는다, 9 V 사각 건전지 금지, 서보 전원 5.0 V 이하 확인(와이퍼 → A0 보호).

import { h, checkProps, clear } from '../dom.js';
import { head } from './_util.js';
import { TRIG_PIN, ECHO_PIN } from '../../config/settings.js';
import { SERVO_PRESETS } from '../../config/servo-presets.js';

export const accepts = ['highlight', 'show_pot_mod', 'board', 'shield', 'show_power_warnings'];
export const BOARDS = ['nano', 'uno'];

/** 보드 이름(UI 표기). 보드를 모를 때 쓰는 중립 표기는 BOARD_NEUTRAL */
export const BOARD_NEUTRAL = 'Arduino(Uno/Nano)';
const BOARD_INFO = {
  nano: { name: 'Arduino Nano', title: 'Arduino Nano 호환', sub: 'V3.0 · CH340 · ATmega328P', usb: 'Mini-USB(CH340)' },
  uno: { name: 'Arduino Uno', title: 'Arduino Uno', sub: 'ATmega328P · USB', usb: 'USB-B' },
};

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  for (const k of kids) if (k != null) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
}

/** props → 정규화된 구성. 알 수 없는 board 값은 nano로(경고 문구는 mount에서) */
export function normalizeBoard(props = {}) {
  const board = BOARDS.includes(props.board) ? props.board : 'nano';
  const shield = board === 'nano' ? props.shield !== false : false; // 실드는 Nano 구성에서만 그린다
  return { board, shield, showPot: props.show_pot_mod !== false, warnings: props.show_power_warnings !== false };
}

/**
 * 부품·선 정의(순수: 시험용).
 * opts: { servoPin = 9, showPot = true, board = 'nano', shield = (board==='nano'), servoModel = 'HS5645MG', warnings = true }
 * (호환) parts(servoPin, showPot) 형태도 받는다 — 이때 board = 'nano'.
 * 반환 { board, shield, parts: [{id,label,sub?,x,y,w,h,desc,kind}], wires: [{id,label,pin,color,desc,from:{x,y},to:{x,y},c1?,c2?,dash?,forbidden?}], pins }
 */
export function parts(opts = {}, legacyShowPot) {
  if (typeof opts === 'number') opts = { servoPin: opts, showPot: legacyShowPot !== false };
  const servoPin = opts.servoPin ?? 9;
  const showPot = opts.showPot !== false;
  const board = BOARDS.includes(opts.board) ? opts.board : 'nano';
  const shield = board === 'nano' ? opts.shield !== false : false;
  const warnings = opts.warnings !== false;
  const B = BOARD_INFO[board];
  const preset = SERVO_PRESETS[opts.servoModel] || SERVO_PRESETS.HS5645MG;
  const servoName = preset.label || preset.id;

  // 배치(viewBox 0 0 800 470)
  const bd = board === 'nano' ? { x: 300, y: 125, w: 190, h: 235 } : { x: 285, y: 100, w: 220, h: 270 };
  const sh = shield ? { x: 255, y: 80, w: 280, h: 310 } : null;
  const left = sh ? sh.x : bd.x, right = sh ? sh.x + sh.w : bd.x + bd.w, top = sh ? sh.y : bd.y;
  // 왼쪽 핀 줄(보드 기준 y)
  const pins = {
    sonarPwr: { y: bd.y + 50, text: '5V · GND  센서 전원' },
    trig: { y: bd.y + 80, text: `D${TRIG_PIN}  Trig` },
    echo: { y: bd.y + 105, text: `D${ECHO_PIN}  Echo` },
    sig: { y: bd.y + 150, text: `D${servoPin}  서보 신호` },
    a0: { y: bd.y + 185, text: 'A0  pot 와이퍼' },
    v5: { y: bd.y + 125, text: '5V', right: true },
    gnd: { y: bd.y + 200, text: 'GND', right: true },
  };
  const hdr = shield ? ' 실드의 같은 번호 S-V-G 헤더 S핀에 꽂는다.' : '';
  const P = [
    { id: 'pc', kind: 'pc', label: 'PC (Chrome/Edge)', sub: `USB: ${board === 'nano' ? 'Nano' : 'Uno'} 전원 + 시리얼`, x: 560, y: 12, w: 220, h: 54,
      desc: `USB 케이블 하나로 보드 전원(5 V)과 시리얼 통신(115200 bps)을 함께 받는다. 펌웨어가 D 줄을 60 ms마다 보낸다.${board === 'nano' ? ' Nano 호환 보드는 CH340 USB-시리얼 칩이라 포트가 "USB-SERIAL CH340"으로 보인다(안 보이면 CH340 드라이버 설치).' : ''}` },
    { id: 'board', kind: 'board', label: B.title, sub: B.sub, x: bd.x, y: bd.y, w: bd.w, h: bd.h,
      desc: board === 'nano'
        ? 'Arduino Nano V3.0 호환 보드(CH340, ATmega328P). Uno와 같은 칩이라 핀 번호·펌웨어가 같다. 전원은 USB로만 받는다. 업로드 보드는 "Arduino Nano", 실패하면 프로세서 "ATmega328P (Old Bootloader)".'
        : 'Arduino Uno(ATmega328P). USB로 PC와 연결(115200 bps), 전원도 USB로 받는다.' },
    { id: 'hcsr04', kind: 'part', label: 'HC-SR04 초음파', sub: 'VCC · Trig · Echo · GND', x: 20, y: 40, w: 170, h: 80,
      desc: `Trig → D${TRIG_PIN}, Echo → D${ECHO_PIN}, VCC → 보드 5V, GND → GND.${shield ? ' 실드 D6·D7 헤더의 S핀을 쓰고, VCC는 실드의 5V 핀(Nano 5V)에서 받는다 — 헤더 V 레일은 실드 모델·점퍼에 따라 외부 전원일 수 있으니 멀티미터로 5 V인지 확인 후에만 쓴다.' : ''} 공까지 거리를 mm로 잰다. 핀은 펌웨어 상수(변경 불가).` },
    { id: 'servo', kind: 'part', label: `서보 ${servoName}`, sub: '신호 · V+ · GND (+ 개조 와이퍼)', x: 20, y: 235, w: 170, h: 90,
      desc: `신호 → D${servoPin} (장치 설정에서 변경 가능, IDLE에서만).${hdr} 서보 빨간 선(V+)과 갈색/검은 선(GND)은 별도 서보 전원에 잇는다${shield ? '(실드 헤더의 V핀에는 꽂지 않는다)' : ''}. 공급 전압 ${preset.supply_v || '확인 필요'}.` },
    { id: 'power', kind: 'power', label: '서보 전원 5.0 V', sub: '별도 전원 · 2 A 이상', sub2: '켜기 전 멀티미터로 5.0 V 이하 확인', x: 575, y: 330, w: 205, h: 84,
      desc: `서보 전용 5.0 V 전원(2 A 이상 어댑터·보조 배터리·5 V 강압 모듈). ${board === 'nano' ? 'Nano' : '보드'}는 USB로 따로 받는다. 이 전원의 GND만 보드 GND와 공통으로 잇고, 5 V(+)는 보드 5V 핀에 잇지 않는다(USB 5 V와 부딪힌다). 서보 안 포텐쇼미터 양 끝이 이 전압에 걸리므로 와이퍼 → A0 전압도 이 값을 따라간다 — 5.0 V를 넘으면 A0가 손상될 수 있다. 전원이 약하면 서보가 움직일 때 보드 리셋·하트비트 만료·떨림이 생긴다.` },
  ];
  if (sh) P.splice(1, 0, { id: 'shield', kind: 'shield', label: 'Nano I/O 확장 실드', sub: 'S-V-G 3핀 헤더형(모델 미확인)', x: sh.x, y: sh.y, w: sh.w, h: sh.h,
    desc: 'Nano를 꽂는 I/O 확장 실드(S-V-G 3핀 헤더형으로 가정, 정확한 모델 미확인). 핀 번호는 Nano와 같다. S = 신호, V = 헤더 전원 레일, G = GND. V 레일이 Nano 5V인지 실드 외부 전원 단자인지는 모델·점퍼마다 달라서, 서보 V+는 V핀에 꽂지 말고 별도 5.0 V 전원에 직접 잇는다.' });
  if (warnings) P.push({ id: 'no9v', kind: 'warn', label: '9 V 사각 건전지 금지', sub: '서보·보드 어느 쪽도 9 V로 구동하지 않는다', x: 590, y: 150, w: 190, h: 54,
    desc: '9 V 사각 건전지는 전류가 부족해 서보가 움직이면 전압이 무너지고(리셋·떨림), 서보 정격(4.8~6 V)을 넘는다. 강압 없이 서보에 연결하면 서보와 와이퍼 → A0가 손상될 수 있다. 서보 전원은 5.0 V 어댑터·보조 배터리·강압 모듈을 쓴다.' });

  const L = (k) => ({ x: left, y: pins[k].y }), R = (k) => ({ x: right, y: pins[k].y });
  const pw = P.find((p) => p.id === 'power');
  const TERM = { minus: pw.x + 45, plus: pw.x + pw.w - 40 }; // 전원 상자 −/+ 단자 x
  const W = [
    { id: 'w-usb', label: 'USB', pin: 'USB', color: '#5d6670', from: { x: bd.x + bd.w / 2, y: top }, to: { x: 560, y: 40 }, c1: { x: bd.x + bd.w / 2, y: 40 }, c2: { x: 500, y: 40 },
      desc: `PC ↔ ${B.name} ${B.usb}. 보드 전원과 시리얼 통신. 서보 전원은 여기서 받지 않는다.` },
    { id: 'w-sonar-pwr', label: '센서 5V/GND', pin: '5V/GND', color: '#999999', from: { x: 190, y: 108 }, to: L('sonarPwr'), desc: `HC-SR04 VCC → 보드 5V, GND → 보드 GND${shield ? '(실드 5V·GND 핀)' : ''}. 센서 전류는 작아서 USB 5 V로 충분하다.` },
    { id: 'w-trig', label: 'Trig', pin: `D${TRIG_PIN}`, color: '#0072B2', from: { x: 190, y: 62 }, to: L('trig'), desc: `초음파 트리거 출력 D${TRIG_PIN}` },
    { id: 'w-echo', label: 'Echo', pin: `D${ECHO_PIN}`, color: '#56B4E9', from: { x: 190, y: 82 }, to: L('echo'), desc: `초음파 에코 입력 D${ECHO_PIN}` },
    { id: 'w-sig', label: '서보 신호', pin: `D${servoPin}`, color: '#E69F00', from: { x: 190, y: 258 }, to: L('sig'), desc: `PWM 신호(Servo.h). 현재 설정 D${servoPin}.${hdr} Trig/Echo 핀과 겹칠 수 없다.` },
    // 전원선은 실드 아래로 직각 배선(교차 없음): 서보 GND → 전원 −(왼쪽 단자), 서보 V+ → 전원 +(오른쪽 단자)
    { id: 'w-vplus', label: '서보 V+ (5.0 V)', pin: 'V+', color: '#D55E00', width: 4, from: { x: 80, y: 325 }, to: { x: TERM.plus, y: pw.y + pw.h },
      points: [{ x: 80, y: 325 }, { x: 80, y: 452 }, { x: TERM.plus, y: 452 }, { x: TERM.plus, y: pw.y + pw.h }],
      desc: `서보 빨간 선 → 별도 서보 전원 + (5.0 V).${shield ? ' 실드 헤더 V핀이 아니라 전원에 직접.' : ''}` },
    { id: 'w-sgnd', label: '서보 GND', pin: 'GND', color: '#444444', width: 4, from: { x: 130, y: 325 }, to: { x: TERM.minus, y: pw.y + pw.h },
      points: [{ x: 130, y: 325 }, { x: 130, y: 435 }, { x: TERM.minus, y: 435 }, { x: TERM.minus, y: pw.y + pw.h }],
      desc: '서보 갈색/검은 선 → 서보 전원 GND(−).' },
    { id: 'w-gnd', label: '공통 GND', pin: 'GND', color: '#222222', width: 4, from: { x: TERM.minus, y: pw.y }, to: R('gnd'), c1: { x: TERM.minus, y: pins.gnd.y }, c2: { x: right + 20, y: pins.gnd.y },
      desc: `서보 전원 GND ↔ ${B.name} GND 공통(이 선 하나만 두 전원을 잇는다). 없으면 서보 신호의 기준이 달라 떨리고 A0 읽기가 틀어진다.` },
  ];
  if (warnings) W.push({ id: 'w-no5v', label: '연결 금지: 서보 5 V → 보드 5V', pin: '5V', color: '#C0392B', dash: '4 4', forbidden: true, from: { x: TERM.plus, y: pw.y }, to: R('v5'), points: [{ x: TERM.plus, y: pw.y }, { x: TERM.plus, y: pins.v5.y }, R('v5')], mark: { x: (TERM.plus + right) / 2 + 20, y: pins.v5.y },
    desc: `서보 전원의 5 V(+)를 ${B.name} 5V 핀에 잇지 않는다. 보드는 USB 5 V를 쓰므로 두 전원이 맞붙어 USB 포트·보드 레귤레이터가 손상되거나 PC가 포트를 끊을 수 있다.` });
  if (showPot) W.push({ id: 'w-pot', label: '포텐쇼미터 와이퍼', pin: 'A0', color: '#009E73', dash: '6 4', from: { x: 190, y: 300 }, to: L('a0'),
    desc: `개조 배선: 서보 내부 포텐쇼미터 와이퍼 → A0${shield ? '(실드 A0 헤더 S핀)' : ''}. 포텐쇼미터 양 끝이 서보 전원에 걸리므로 서보 전원이 5.0 V 이하인지 먼저 멀티미터로 확인한다(5 V를 넘으면 분압 10 kΩ+10 kΩ 또는 전원 교체).` });
  return { board, shield, parts: P, wires: W, pins, layout: { left, right, top, bd, sh, term: TERM } };
}

function pathOf(w) {
  if (w.points) return 'M' + w.points.map((q) => `${q.x},${q.y}`).join(' L');
  const a = w.from, b = w.to;
  const c1 = w.c1 || { x: (a.x + b.x) / 2, y: a.y }, c2 = w.c2 || { x: (a.x + b.x) / 2, y: b.y };
  return `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
}

export function mount(el, props, ctx) {
  checkProps(el, 'wiring-diagram', props, accepts);
  const dev = (ctx.settings && ctx.settings.device) || {};
  const pin = dev.servo_pin || 9;
  const cfg = normalizeBoard(props || {});
  const D = parts({ servoPin: pin, showPot: cfg.showPot, board: cfg.board, shield: cfg.shield, servoModel: dev.servo_model, warnings: cfg.warnings });
  const B = BOARD_INFO[cfg.board];
  // highlight: 예전 id 'uno'(및 'nano')는 보드 상자를 가리킨다
  const hl = new Set((props.highlight || []).map((x) => (x === 'uno' || x === 'nano' ? 'board' : x)));
  el.appendChild(head('배선도', h('span', { class: 'muted' }, `${B.title}${D.shield ? ' + I/O 실드' : ''} · 현재 서보 핀 D${pin} · 부품이나 선을 눌러 설명 보기`)));
  if (props.board != null && !BOARDS.includes(props.board)) el.appendChild(h('div', { class: 'box box-warn' }, `board 값 "${props.board}"를 모릅니다 — "nano" 또는 "uno". nano로 그립니다.`));
  const desc = h('div', { class: 'box box-info', 'aria-live': 'polite' }, '부품을 눌러 보세요.');
  const svg = s('svg', { viewBox: '0 0 800 470', class: 'svg-diagram', role: 'img', 'aria-label': `볼앤빔 배선도: ${B.title}${D.shield ? ' + I/O 확장 실드' : ''}, 서보 별도 5.0 V 전원, 공통 GND` });
  const select = (item, g) => {
    for (const x of svg.querySelectorAll ? svg.querySelectorAll('.hot.sel') : []) x.classList.remove('sel');
    g && g.classList.add('sel');
    clear(desc).append(h('strong', null, item.label + ': '), item.desc);
  };
  const T = (x, y, str, a = {}) => s('text', { x, y, 'font-size': 11, fill: '#1d232a', ...a }, str);
  const hot = (item, extraCls = '') => {
    const g = s('g', { class: `hot${extraCls}${hl.has(item.id) ? ' sel' : ''}`, tabindex: 0, 'data-id': item.id });
    g.addEventListener('click', () => select(item, g));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') select(item, g); });
    return g;
  };
  const FILL = { pc: '#f3f4f6', shield: '#eef5ea', board: '#e1edf7', part: '#ffffff', power: '#fff1e6', warn: '#fdecea' };
  // 1) 실드·보드·부품 상자(선보다 아래)
  for (const p of D.parts) {
    const g = hot(p);
    const stroke = hl.has(p.id) ? '#0072B2' : p.kind === 'warn' ? '#C0392B' : p.kind === 'power' ? '#D55E00' : '#5d6670';
    g.appendChild(s('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 8, fill: FILL[p.kind] || '#ffffff', stroke, 'stroke-width': hl.has(p.id) ? 3 : p.kind === 'power' || p.kind === 'warn' ? 2 : 1.5 }));
    if (p.kind === 'warn') {
      // 금지 기호(원 + 사선)
      const cx = p.x + 24, cy = p.y + p.h / 2;
      g.appendChild(s('circle', { cx, cy, r: 13, fill: 'none', stroke: '#C0392B', 'stroke-width': 3 }));
      g.appendChild(s('line', { x1: cx - 9, y1: cy + 9, x2: cx + 9, y2: cy - 9, stroke: '#C0392B', 'stroke-width': 3 }));
      g.appendChild(T(cx - 5, cy + 4, '9V', { 'font-size': 8, 'font-weight': 700, fill: '#C0392B', 'text-anchor': 'middle' }));
      g.appendChild(T(p.x + 46, p.y + 22, p.label, { 'font-size': 13, 'font-weight': 700, fill: '#C0392B' }));
      g.appendChild(T(p.x + 46, p.y + 40, '서보·보드 모두', { 'font-size': 10, fill: '#7b241c' }));
    } else if (p.kind === 'shield') {
      g.appendChild(T(p.x + p.w / 2, p.y + 18, p.label, { 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600 }));
      g.appendChild(T(p.x + p.w / 2, p.y + 33, p.sub, { 'text-anchor': 'middle', 'font-size': 10, fill: '#5d6670' }));
    } else {
      g.appendChild(T(p.x + p.w / 2, p.y + 20, p.label, { 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600 }));
      if (p.sub) g.appendChild(T(p.x + p.w / 2, p.y + 36, p.sub, { 'text-anchor': 'middle', 'font-size': 10, fill: '#5d6670' }));
      if (p.sub2) g.appendChild(T(p.x + p.w / 2, p.y + 54, p.sub2, { 'text-anchor': 'middle', 'font-size': 10, fill: '#7a3a12' }));
      if (p.kind === 'power') {
        const tm = D.layout.term;
        g.appendChild(T(tm.minus, p.y + p.h - 8, '− GND', { 'font-size': 10, 'font-weight': 700, fill: '#444444', 'text-anchor': 'middle' }));
        g.appendChild(T(tm.plus, p.y + p.h - 8, '+ 5.0 V', { 'font-size': 10, 'font-weight': 700, fill: '#D55E00', 'text-anchor': 'middle' }));
      }
    }
    if (p.kind === 'board') {
      // 핀 줄
      for (const [k, pn] of Object.entries(D.pins)) {
        if (k === 'a0' && !D.wires.some((w) => w.id === 'w-pot')) continue;
        if (pn.right) g.appendChild(T(p.x + p.w - 8, pn.y + 4, pn.text, { 'text-anchor': 'end', fill: '#5d6670' }));
        else g.appendChild(T(p.x + 8, pn.y + 4, pn.text, { fill: '#5d6670' }));
      }
      g.appendChild(T(p.x + p.w / 2, p.y + p.h - 10, 'USB 전원만 사용', { 'text-anchor': 'middle', 'font-size': 10, fill: '#5d6670' }));
    }
    svg.appendChild(g);
  }
  // 1b) 실드 S-V-G 헤더 표시(실드 왼쪽 띠)
  if (D.shield) {
    const sh = D.layout.sh;
    for (const k of ['trig', 'echo', 'sig', 'a0']) {
      if (k === 'a0' && !cfg.showPot) continue;
      const y = D.pins[k].y;
      ['S', 'V', 'G'].forEach((c, i) => {
        svg.appendChild(s('rect', { x: sh.x + 4 + i * 13, y: y - 6, width: 11, height: 12, rx: 2, fill: c === 'S' ? '#ffffff' : '#dfe6dc', stroke: '#7d8a78', 'stroke-width': 1 }));
        svg.appendChild(T(sh.x + 9.5 + i * 13, y + 3.5, c, { 'font-size': 8, 'text-anchor': 'middle', fill: c === 'V' ? '#9aa39a' : '#1d232a' }));
      });
    }
  }
  // 2) 선
  for (const w of D.wires) {
    const g = hot(w, w.forbidden ? ' forbidden' : '');
    const wd = (w.width || 3) + (hl.has(w.id) ? 2 : 0);
    g.appendChild(s('path', { d: pathOf(w), fill: 'none', stroke: w.color, 'stroke-width': wd, 'stroke-dasharray': w.dash || null, 'stroke-linecap': 'round' }));
    // 넓은 투명 히트 영역
    g.appendChild(s('path', { d: pathOf(w), fill: 'none', stroke: 'transparent', 'stroke-width': 12 }));
    g.appendChild(s('circle', { cx: w.to.x, cy: w.to.y, r: 3.5, fill: w.color }));
    if (w.forbidden) {
      // 가운데(근사)에 큰 X
      const mx = w.mark.x, my = w.mark.y;
      g.appendChild(s('circle', { cx: mx, cy: my, r: 11, fill: '#ffffff', stroke: '#C0392B', 'stroke-width': 2 }));
      g.appendChild(s('path', { d: `M${mx - 6},${my - 6} L${mx + 6},${my + 6} M${mx + 6},${my - 6} L${mx - 6},${my + 6}`, stroke: '#C0392B', 'stroke-width': 3 }));
      g.appendChild(T(mx, my + 26, '연결 금지', { 'font-size': 11, 'font-weight': 700, fill: '#C0392B', 'text-anchor': 'middle' }));
      g.appendChild(T(mx, my + 40, `서보 5 V ↛ ${cfg.board === 'nano' ? 'Nano' : 'Uno'} 5V`, { 'font-size': 10, fill: '#C0392B', 'text-anchor': 'middle' }));
    } else if (w.id === 'w-gnd') {
      g.appendChild(T(w.to.x + 6, w.to.y - 8, '공통 GND', { 'font-size': 11, 'font-weight': 700 }));
    } else if (w.id === 'w-vplus') {
      g.appendChild(T(300, 466, '서보 V+(빨강) → 서보 전원 + 5.0 V', { 'font-size': 10, fill: '#D55E00' }));
    } else if (w.id === 'w-sgnd') {
      g.appendChild(T(300, 430, '서보 GND(갈색/검정) → 서보 전원 −', { 'font-size': 10, fill: '#444444' }));
    }
    g.appendChild(s('title', {}, w.label));
    svg.appendChild(g);
  }
  el.append(svg, desc);
  return { unmount() {} };
}
