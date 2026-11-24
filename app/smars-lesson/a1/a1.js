/* =====================================================================
   a1 — 아두이노 기초(SMARS 수업 M1~M6) 공유 모듈
   이 폴더(a1/)와 examples/m1~m6 만 두 저장소 사이에서 동기화된다:
     SMARS 수업 교재  kgh-DaC/lecture-SMARS  : a1/, examples/
     볼앤빔 교재 a1장 kgh-DaC/ball-and-beam   : app/smars-lesson/a1/, app/smars-lesson/examples/
   고친 뒤 어느 저장소에서든  node tools/sync_lesson.mjs  를 돌리면 다른 쪽에 반영된다.
   페이지 틀(PINMAP·공통 유틸·생성기·시리얼 모니터·목차)은 각 저장소의 lesson.html 에 있고 동기화하지 않는다.
   이 파일은 틀 스크립트 다음에(DOMContentLoaded 전에) 읽혀서 MODULES·LESSON 에 M1~M6 을 채운다.
   예제 코드는 examples 폴더의 mN_이름 폴더 안 .ino 파일이 원본이다. 아래 A1_EXAMPLES 블록은 sync_lesson.mjs 가 다시 만든다(직접 고치지 않는다).
   ===================================================================== */
'use strict';

/* 1. 목차 항목: M1~M6 — 틀의 MODULES 에서 m0 바로 뒤(없으면 맨 앞)에 끼운다 */
const A1_MODULES = [
  { id:'m1',   no:'M1', title:'아두이노·브레드보드 · 바이브코딩 입문', pins:['led'] },
  { id:'m2',   no:'M2', title:'DC모터·H-bridge·PWM', pins:['motorL','motorR'] },
  { id:'m3',   no:'M3', title:'부저', pins:['buzzer'] },
  { id:'m4',   no:'M4', title:'초음파', pins:['ultra'] },
  { id:'m5',   no:'M5', title:'적외선 라인센서', pins:['line'], optional:'선택 모듈 · 시간이 부족하면 M7 라인 카드로 대체 가능' },
  { id:'m6',   no:'M6', title:'블루투스', pins:['bt'] },
];
MODULES.splice(MODULES.findIndex(m => m.id === 'm0') + 1, 0, ...A1_MODULES);

/* 2. 인터랙티브: M1 6단계 · 브레드보드 · H-bridge/PWM(M2) · 부저(M3) · 초음파(M4) · 라인(M5) · 블루투스/UART(M6) */
function m1Step1(){
  return `<div class="ia"><div>${unoSVG('s1')}<div class="status" id="s1Info">보드의 부분(헤더, USB, 칩, LED…)을 눌러 보세요.</div></div>
    <div class="explain"><ul>
      <li><b>아두이노 UNO R3</b> = AVR 마이크로컨트롤러(ATmega328P)와 주변 회로를 한 장에 묶은 보드.</li>
      <li>동작 전압 <b>5V</b>, 속도 <b>16MHz</b>, 플래시(프로그램 저장) <b>32KB</b>(그중 부트로더 0.5KB), SRAM(실행 중 변수) <b>2KB</b>, EEPROM(전원 꺼도 남는 저장) <b>1KB</b>.</li>
      <li>내장 LED는 <b>D13</b>에 연결되어 있습니다.</li>
      <li><b>쉴드</b>(shield) = 보드 위에 꽂아 기능을 더하는 보드. SMARS는 <b>L298P 모터 쉴드</b>를 꽂아 모터를 돌립니다.</li>
    </ul></div></div>`;
}

/* 2단계: 신호선과 전원선 (+ HIGH/LOW 해 보기) */
function m1Step2(){
  return `<div class="ia"><div>${unoSVG('s2')}
      <div class="row"><button class="btn" data-grp-show="dig" style="border-color:var(--cyan)">디지털 D0~D13</button><button class="btn" data-grp-show="ana" style="border-color:var(--green)">아날로그 A0~A5</button><button class="btn" data-grp-show="pwr" style="border-color:var(--red)">파워 라인</button><button class="btn" data-grp-show="all">세 그룹 모두</button></div>
      <div class="status" id="s2Info">그룹 버튼으로 색을 바꿔 보고, 보드 부분을 눌러 설명을 보세요.</div></div>
    <div class="explain">
      <div class="grp-card" style="border-color:var(--cyan)"><b style="color:var(--cyan)">디지털 신호 라인 D0~D13 (14개)</b><br>HIGH(5V)/LOW(0V) 두 값만 입출력. <code>~</code> 표시 6개(D3, D5, D6, D9, D10, D11)는 PWM 출력 가능. 핀당 20mA 권장 → LED는 저항 필수.</div>
      <div class="grp-card" style="border-color:var(--green)"><b style="color:var(--green)">아날로그 입력 라인 A0~A5 (6개)</b><br>0~5V를 10비트로 나눠 <b>0~1023</b>으로 읽음(<code>analogRead</code>). 디지털 핀(D14~D19)으로도 쓸 수 있음 — SMARS의 ${pin('bt','RXD←')}/${pin('bt','TXD→')}(블루투스), ${pin('line','DO')}(라인센서)가 그 예. UNO에는 진짜 아날로그 출력이 없고 PWM으로 흉내 냅니다.</div>
      <div class="grp-card" style="border-color:var(--red)"><b style="color:var(--red)">파워 라인 (전원 헤더)</b><br>5V, 3.3V(최대 50mA), GND(여러 개, 모두 연결됨), VIN, RESET, IOREF. <b>모든 부품의 GND는 아두이노 GND와 공통</b>으로 연결해야 신호의 기준이 맞습니다.</div>
    </div></div>
    <div class="box" style="margin-top:12px"><b>해 보기 — 디지털 출력 HIGH/LOW</b>
      <div class="row"><svg viewBox="0 0 300 70" style="width:300px;max-width:100%" aria-label="D13 LED 회로">
        <text x="6" y="40" fill="#e8eaf6" font-size="14" font-weight="700">${esc(LED_PIN)}</text>
        <line x1="40" y1="35" x2="90" y2="35" stroke="#7a7f99" stroke-width="2.5"/>
        <polyline points="90,35 96,27 104,43 112,27 120,43 128,27 134,35" stroke="#f7a64f" stroke-width="2.5" fill="none"/><text x="112" y="20" fill="#f7a64f" font-size="11" text-anchor="middle">220Ω</text>
        <line x1="134" y1="35" x2="170" y2="35" stroke="#7a7f99" stroke-width="2.5"/>
        <circle id="hlLed" cx="186" cy="35" r="14" fill="#5a1414" stroke="#f74f4f" stroke-width="2"/><text x="186" y="64" fill="#7a7f99" font-size="10" text-anchor="middle">LED</text>
        <line x1="200" y1="35" x2="240" y2="35" stroke="#7a7f99" stroke-width="2.5"/><text x="246" y="40" fill="#9fb8ff" font-size="14" font-weight="700">GND</text>
        <text id="hlVolt" x="40" y="62" fill="#7a7f99" font-size="12">0V</text></svg>
        <button class="btn" id="hlBtn"></button></div>
      <code id="hlCode"></code> → 핀이 5V가 되면 전류가 흘러 LED가 켜지고, 0V면 꺼집니다.</div>`;
}
function initStep2(sec){
  initUnoClick(sec, 's2', 's2Info');
  const svg = sec.querySelector('#s2Uno');
  sec.querySelectorAll('[data-grp-show]').forEach(b => b.onclick = () => {
    const g = b.dataset.grpShow;
    svg.classList.remove('show-dig','show-ana','show-pwr');
    if (g === 'all') svg.classList.add('show-dig','show-ana','show-pwr'); else svg.classList.add('show-' + g);
    sec.querySelectorAll('[data-grp-show]').forEach(x => x.classList.toggle('on', x === b));
  });
  svg.classList.add('show-dig','show-ana','show-pwr');
  sec.querySelector('[data-grp-show="all"]').classList.add('on');
  const led = sec.querySelector('#hlLed'), btn = sec.querySelector('#hlBtn'), code = sec.querySelector('#hlCode'), volt = sec.querySelector('#hlVolt');
  let hi = false;
  const set = v => { hi = v;
    led.setAttribute('fill', v ? '#ff5a5a' : '#5a1414'); led.style.filter = v ? 'drop-shadow(0 0 8px #ff5a5a)' : 'none';
    btn.textContent = v ? 'LOW로 바꾸기' : 'HIGH로 바꾸기'; volt.textContent = v ? '5V' : '0V'; volt.setAttribute('fill', v ? '#f74f4f' : '#7a7f99');
    code.textContent = `digitalWrite(${LED_PIN.slice(1)}, ${v ? 'HIGH' : 'LOW'});`; };
  btn.onclick = () => set(!hi); set(false);
}

/* 3단계: 전원 공급 3가지 — 1·2단계와 같은 보드 그림 위에 "어디로 들어와 어디를 지나는지" 표시 */
const PW_COL = { usb:'#4f8ef7', dc:'#f7a64f', vin:'#b48cf7', out:'#f7d94f' };
const PW_OUT = 'L215,184 L215,236 L270,236 L270,286';   // 앞 경로에 이어 그린다(M 아님)   // 공통: 보드 5V 핀까지
function pwOverlay(){
  const c = PW_COL, tag = (x, y, w, col, t) => `<rect x="${x}" y="${y}" width="${w}" height="18" rx="9" fill="#0b0d14" stroke="${col}" stroke-width="1.5"/><text x="${x + w / 2}" y="${y + 13}" fill="${col}" font-size="11" font-weight="700" text-anchor="middle">${t}</text>`;
  return `<g class="pw-ov">
    <g class="pw-g" data-src="usb">
      <rect class="pw-ring" x="3" y="41" width="102" height="82" rx="6" stroke="${c.usb}"/>
      <path class="pw-flow" stroke="${c.usb}" d="M52,113 L52,126 M60,131 L70,131 L70,184 ${PW_OUT}"/>
      <rect x="36" y="126" width="24" height="10" rx="2" fill="#e0b040"/><text x="48" y="148" fill="#e0b040" font-size="9" text-anchor="middle">폴리퓨즈</text>
      ${tag(8, 21, 92, c.usb, '① USB 5V')}</g>
    <g class="pw-g" data-src="dc">
      <rect class="pw-ring" x="3" y="219" width="96" height="80" rx="6" stroke="${c.dc}"/>
      <path class="pw-flow" stroke="${c.dc}" d="M49,230 L49,207 L88,207 M110,194 L110,184 ${PW_OUT}"/>
      <rect class="pw-ring" x="86" y="192" width="48" height="30" rx="4" stroke="${c.dc}"/>
      <rect class="pw-ring thin" x="320" y="288" width="20" height="20" rx="3" stroke="${c.vin}"/>
      ${tag(8, 168, 96, c.dc, '② DC 잭 7~12V')}</g>
    <g class="pw-g" data-src="vin">
      <rect class="pw-ring" x="320" y="288" width="20" height="20" rx="3" stroke="${c.vin}"/>
      <path class="pw-flow" stroke="${c.vin}" d="M330,288 L330,228 L150,228 L150,207 L136,207 M110,194 L110,184 ${PW_OUT}"/>
      <rect class="pw-ring" x="86" y="192" width="48" height="30" rx="4" stroke="${c.vin}"/>
      ${tag(300, 314, 104, c.vin, '③ VIN 핀 7~12V')}</g>
    <g class="pw-g pw-out">
      <circle class="pw-ring" cx="270" cy="298" r="10" stroke="${c.out}"/>
      ${tag(226, 314, 70, c.out, '보드 5V')}</g>
  </g>`;
}
function m1Step3(){
  const svg = unoSVG('s3').replace('viewBox="0 0 540 330"', 'viewBox="0 0 540 336"').replace(/<\/svg>\s*$/, pwOverlay() + '</svg>');
  return `<div class="ia"><div>${svg}
      <div class="row"><button class="btn" data-pw="usb" style="border-color:${PW_COL.usb}">① USB</button><button class="btn" data-pw="dc" style="border-color:${PW_COL.dc}">② DC 잭</button><button class="btn" data-pw="vin" style="border-color:${PW_COL.vin}">③ VIN 핀</button></div>
      <div class="status" id="pwInfo"></div></div>
    <div class="explain"><p style="margin-top:0">버튼(또는 보드의 USB·DC 잭)을 누르면 <b>전원이 들어오는 곳</b>에 테두리가, <b>지나가는 길</b>에 움직이는 선이 보입니다. 세 길 모두 마지막에는 <b style="color:${PW_COL.out}">보드 5V</b>(MCU·5V 핀)로 모입니다.</p><ul>
      <li><b style="color:${PW_COL.usb}">① USB</b> (보드 왼쪽 위 네모 단자): PC의 5V. 업로드·시리얼 통신과 동시에 전원도 줍니다(약 500mA까지, 폴리퓨즈 보호).</li>
      <li><b style="color:${PW_COL.dc}">② DC 잭</b> (보드 왼쪽 아래 둥근 단자): 7~12V 권장(한계 6~20V). <b>레귤레이터</b>가 5V로 낮춥니다. 배터리·어댑터를 꽂습니다.</li>
      <li><b style="color:${PW_COL.vin}">③ VIN 핀</b> (전원 헤더 맨 오른쪽): DC 잭과 같은 레귤레이터를 지나 7~12V를 핀으로 넣습니다. DC 잭으로 전원을 넣으면 VIN에서 그 전압을 꺼내 쓸 수도 있습니다.</li>
    </ul>
    <p class="muted" style="font-size:.85rem">그림의 퓨즈·레귤레이터 위치는 이해를 돕기 위해 단순화했습니다. 실제 보드에서는 USB 단자와 DC 잭 근처의 작은 부품입니다.</p>
    <div class="warn"><b>5V 핀에 외부 전원을 직접 넣지 않습니다.</b> 레귤레이터를 거치지 않아 위험합니다(이 수업에서는 쓰지 않음).</div>
    <div class="box"><b>모터는 전류를 많이 씁니다.</b> USB 전원만으로는 부족해서 모터가 '웅' 소리만 내고 안 돌 수 있습니다(M2). SMARS는 모터용 배터리를 따로 씁니다.</div></div></div>`;
}
const PW_INFO = {
  usb: '<b>① USB</b> 5V → 폴리퓨즈(과전류 보호) → 보드 5V. 업로드·시리얼과 전원이 한 선으로 들어옵니다.',
  dc:  '<b>② DC 잭</b> 7~12V → 레귤레이터(5V로 낮춤) → 보드 5V. 이때 <b>VIN 핀</b>(점선 테두리)에서도 같은 전압이 나옵니다.',
  vin: '<b>③ VIN 핀</b> 7~12V → 레귤레이터(DC 잭과 같은 길) → 보드 5V.',
};
function initStep3(sec){
  const svg = sec.querySelector('#s3Uno'), info = sec.querySelector('#pwInfo');
  const pick = k => {
    svg.querySelectorAll('.pw-g[data-src]').forEach(g => g.classList.toggle('on', g.dataset.src === k));
    svg.querySelector('.pw-out').classList.add('on');
    svg.querySelectorAll('.uno-part').forEach(x => x.classList.remove('sel'));
    sec.querySelectorAll('[data-pw]').forEach(b => b.classList.toggle('on', b.dataset.pw === k));
    info.innerHTML = PW_INFO[k];
  };
  sec.querySelectorAll('[data-pw]').forEach(b => b.onclick = () => pick(b.dataset.pw));
  svg.addEventListener('click', e => {       // 보드의 USB·DC 잭을 누르면 해당 전원, 다른 부분은 부품 설명
    const g = e.target.closest('.uno-part'); if (!g) return;
    const p = g.dataset.part;
    if (p === 'usb' || p === 'dc') return pick(p);
    svg.querySelectorAll('.uno-part').forEach(x => x.classList.toggle('sel', x === g));
    info.innerHTML = UNO_INFO[p];
  });
  pick('usb');
}

/* 4단계: 시리얼 통신 2경로 — 1~3단계와 같은 보드 그림 위에 표시
   ① USB ↔ CH340 ↔ D0/D1  ② 외부 장치 ↔ D0/D1  ③ 둘 다 → 충돌  ④ SoftwareSerial(블루투스 핀)로 해결 */
const SR_COL = { usb:'#4fd1e0', ext:'#b48cf7', clash:'#f74f4f', soft:'#4fcf83' };
function srModule(x, y, col, pinsOnTop, title){
  const py = pinsOnTop ? y : y + 56, ly = pinsOnTop ? y + 15 : y + 50, ty = pinsOnTop ? y + 38 : y + 26;
  return `<rect x="${x}" y="${y}" width="96" height="56" rx="6" fill="#1d2a4a" stroke="${col}" stroke-width="2"/>
    <text x="${x + 60}" y="${ty}" fill="#e8eaf6" font-size="12" font-weight="700" text-anchor="middle">${title}</text>
    <circle cx="${x + 16}" cy="${py}" r="4" fill="${col}"/><circle cx="${x + 36}" cy="${py}" r="4" fill="${col}"/>
    <text x="${x + 16}" y="${ly}" fill="${col}" font-size="9" text-anchor="middle">TXD</text><text x="${x + 36}" y="${ly}" fill="${col}" font-size="9" text-anchor="middle">RXD</text>`;
}
function srOverlay(){
  const c = SR_COL, d0 = 162 + 18 * 17.5, d1 = 162 + 17 * 17.5;          // unoSVG 디지털 헤더의 RX←0, TX→1 위치
  const a0 = 380, a1 = 400;                                                  // 아날로그 헤더 A0, A1 위치
  const ring = (x, y, w, h, cls = '') => `<rect class="pw-ring ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`;
  return `<g class="pw-ov sr-ov">
    <g class="sr-g" data-g="usb">
      ${ring(3, 41, 102, 82)}${ring(108, 114, 72, 64)}
      <path class="pw-flow sr-usb" d="M105,92 L144,92 L144,114 M180,146 L190,146 L190,18 L${(d0 + d1) / 2},18 L${(d0 + d1) / 2},26"/></g>
    <g class="sr-g" data-g="ext">
      <path class="pw-flow sr-ext" d="M${d0},27 L${d0},12 L556,12 L556,40 M${d1},27 L${d1},4 L576,4 L576,40"/>
      ${srModule(540, 40, c.ext, true, 'HC-05 등')}</g>
    <g class="sr-g" data-g="d01">${ring(d1 - 9, 24, d0 - d1 + 18, 20, 'sr-d01')}</g>
    <g class="sr-g" data-g="clash"><rect x="500" y="132" width="120" height="26" rx="13" fill="#3a0d0d" stroke="${c.clash}" stroke-width="2"/>
      <text x="560" y="150" fill="${c.clash}" font-size="13" font-weight="800" text-anchor="middle">D0/D1 충돌!</text></g>
    <g class="sr-g" data-g="soft">
      ${ring(a0 - 9, 288, a1 - a0 + 18, 20, 'sr-a01')}
      <path class="pw-flow sr-soft" d="M${a1},306 L${a1},328 L556,328 L556,300 M${a0},306 L${a0},346 L576,346 L576,300"/>
      ${srModule(540, 244, c.soft, false, 'HC-05')}</g>
  </g>`;
}
function m1Step4(){
  const RX = pin('bt','TXD→'), TX = pin('bt','RXD←'), ub = PINMAP.usb.baud, bb = PINMAP.bt.baud;
  const svg = unoSVG('s4').replace('viewBox="0 0 540 330"', 'viewBox="0 0 650 360"').replace(/<\/svg>\s*$/, srOverlay() + '</svg>');
  const code = `#include <SoftwareSerial.h>   // 1. 라이브러리

// 2. (RX, TX) = 아두이노 쪽 기준
//    HC-05 TXD -> ${RX},  HC-05 RXD <- ${TX}
SoftwareSerial BT(${RX}, ${TX});

void setup() {
  Serial.begin(${ub});  // USB(D0/D1)
  BT.begin(${bb});       // 3. 블루투스
}

void loop() {
  // 4. 사용법은 Serial과 같다
  if (BT.available() > 0) {      // 폰 -> 모니터
    Serial.write(BT.read());
  }
  if (Serial.available() > 0) {  // 모니터 -> 폰
    BT.write(Serial.read());
  }
}`;
  return `<div class="sr-top">${svg}
      <div class="row"><button class="btn" data-sr="usb" style="border-color:${SR_COL.usb}">① USB 시리얼</button><button class="btn" data-sr="ext" style="border-color:${SR_COL.ext}">② 외부 장치 → D0/D1</button><button class="btn" data-sr="clash" style="border-color:${SR_COL.clash}">①+② 같이 쓰면?</button><button class="btn" data-sr="soft" style="border-color:${SR_COL.soft}">해결: SoftwareSerial</button></div>
      <div class="status" id="srInfo"></div></div>
    <div class="sr-cards">
      <div class="grp-card" style="border-color:${SR_COL.usb}"><b style="color:${SR_COL.usb}">① USB 시리얼</b> (보드: USB 단자 → USB-시리얼 칩 → D0/D1)<br>PC ↔ USB 케이블 ↔ <b>CH340</b>(호환 보드, 정품은 ATmega16U2) ↔ <b>D0(RX)·D1(TX)</b> ↔ MCU. <b>업로드</b>와 <b>시리얼 모니터</b>가 이 길을 씁니다. 데이터가 오가면 보드의 <b>TX/RX LED</b>가 깜빡입니다.</div>
      <div class="grp-card" style="border-color:${SR_COL.ext}"><b style="color:${SR_COL.ext}">② 외부 장치 → D0/D1</b> (보드: 디지털 헤더 오른쪽 끝 두 핀)<br>블루투스 모듈 같은 장치를 D0/D1에 직접 꽂는 방법. <b>교차 연결</b>: 장치 TXD → 아두이노 RX(D0), 장치 RXD ← 아두이노 TX(D1). UNO의 <b>하드웨어 UART는 D0/D1 한 쌍뿐</b>입니다.</div>
    </div>
    <h4 class="sub-h">①과 ②를 같이 쓰면 생기는 문제</h4>
    <div class="warn"><b>한 UART(D0/D1)를 두 곳이 함께 씁니다.</b>
      <ul style="margin:.3em 0 0">
        <li><b>업로드 실패</b>: PC가 보내는 프로그램과 외부 장치의 신호가 D0(RX)에서 섞여 <code>avrdude: stk500 … not in sync</code> 같은 오류가 납니다.</li>
        <li><b>글자 섞임·깨짐</b>: 시리얼 모니터의 글자와 외부 장치의 글자가 한 줄로 들어와 어느 쪽이 보낸 것인지 구분할 수 없습니다.</li>
        <li><b>보낸 글자가 양쪽으로</b>: 아두이노가 D1(TX)로 보내면 PC와 외부 장치가 <b>둘 다</b> 받습니다(한쪽에만 보낼 수 없음).</li>
        <li><b>두 출력이 맞붙음</b>: CH340의 TX와 외부 장치의 TXD가 같은 D0에 연결되어 서로 다른 값을 내보냅니다.</li>
      </ul>
      → D0/D1을 쓰려면 <b>업로드할 때마다 외부 장치를 뽑아야</b> 합니다. 수업에서는 불편하고 실수하기 쉽습니다.</div>
    <h4 class="sub-h">해결: SoftwareSerial — 다른 핀으로 시리얼을 하나 더 만든다</h4>
    <div class="ia"><div class="explain"><ol>
        <li><b>배선</b>: HC-05 <b>TXD → ${RX}</b>(아두이노 RX 역할), HC-05 <b>RXD ← ${TX}</b>(아두이노 TX 역할), VCC → 5V, GND → GND. D0/D1은 USB 전용으로 비워 둡니다. <span class="muted">(HC-05 RXD는 3.3V 입력이라 분압 저항 권장)</span></li>
        <li><b>객체 만들기</b>: <code>SoftwareSerial BT(${RX}, ${TX});</code> — 괄호 순서는 <b>(RX, TX)</b>, 즉 <b>아두이노 쪽</b> 기준입니다.</li>
        <li><b>시작</b>: <code>BT.begin(${bb});</code> — HC-05 기본 속도. USB는 <code>Serial.begin(${ub})</code>로 따로 시작합니다.</li>
        <li><b>사용</b>: <code>BT.available()</code>, <code>BT.read()</code>, <code>BT.print()</code> — <code>Serial</code>과 똑같이 씁니다.</li>
      </ol>
      <div class="box"><b>주의할 점</b><ul style="margin:.3em 0 0">
        <li>소프트웨어로 신호를 만들어서 <b>느린 속도(${bb})</b>가 안전합니다. 너무 빠르면 글자가 깨집니다.</li>
        <li>글자를 보내는 동안 아두이노가 잠깐 다른 일을 멈춥니다. 긴 문장을 자주 보내지 않습니다.</li>
        <li>SoftwareSerial은 한 번에 <b>하나만</b> 받을 수 있습니다(여러 개 만들면 <code>listen()</code>으로 바꿔 가며 받음).</li>
      </ul></div></div>
      <div><div class="codebox"><span class="file">SoftwareSerial 기본 틀</span><button class="btn small copy" data-copy="ssCode">복사</button><pre id="ssCode">${esc(code)}</pre></div>
        <p class="muted" style="font-size:.85rem">SMARS 블루투스 실습은 <a href="#m6">M6</a>에서 이 방법으로 합니다.</p></div></div>
    <h4 class="sub-h">하드웨어 시리얼 vs 소프트웨어 시리얼</h4>
    <div class="sr-tbl"><table>
      <tr><th style="width:16%">비교</th><th style="width:42%">하드웨어 시리얼 (<code>Serial</code>)</th><th>소프트웨어 시리얼 (<code>SoftwareSerial</code>)</th></tr>
      <tr><td>만드는 방법</td><td>MCU 칩 안의 <b>UART 회로</b>가 신호를 만들고 받음</td><td><b>프로그램</b>이 핀을 직접 HIGH/LOW로 바꿔 신호를 흉내 냄</td></tr>
      <tr><td>사용 핀</td><td><b>D0(RX)·D1(TX) 고정</b>. UNO는 1쌍뿐</td><td>원하는 디지털 핀 2개를 고름(A0~A5도 가능). SMARS: <b>${RX}/${TX}</b></td></tr>
      <tr><td>속도</td><td>빠르고 안정적. 57600·115200도 문제없음</td><td><b>느린 속도 권장</b>(${bb}). 빠르면 글자가 깨지기 쉬움</td></tr>
      <tr><td>보내기·받기 동시</td><td>동시에 가능</td><td>보내는 동안에는 받지 못함</td></tr>
      <tr><td>아두이노 부담</td><td>칩이 알아서 처리 → 그동안 다른 일을 계속함</td><td>글자를 보내는 동안 <b>다른 일이 잠깐 멈춤</b>(시간 맞추는 다른 기능에 영향)</td></tr>
      <tr><td>여러 개 사용</td><td>UNO는 1개(Mega는 4개)</td><td>여러 개 만들 수 있지만 <b>한 번에 하나만</b> 받음(<code>listen()</code>)</td></tr>
      <tr><td>코드 준비</td><td>바로 <code>Serial.begin()</code></td><td><code>#include</code> + <code>SoftwareSerial BT(RX, TX);</code> 선언 필요</td></tr>
      <tr><td>주의</td><td>USB(업로드·시리얼 모니터)와 <b>같은 핀</b> → 다른 장치를 꽂으면 충돌</td><td>RX 핀에 들어오는 신호를 놓칠 수 있어 짧은 명령 위주로 씀</td></tr>
      <tr><td>SMARS에서</td><td><b>USB ${ub}</b>: 업로드, 시리얼 모니터, 웹 콘솔</td><td><b>HC-05 블루투스 ${bb}</b>: 휴대폰·무선 조종</td></tr>
    </table></div>
    <div class="box"><b>정리</b>: 빠르고 안정적인 <b>하드웨어 시리얼은 USB</b>에 양보하고, 느려도 되는 <b>블루투스는 소프트웨어 시리얼</b>로 다른 핀에 연결합니다.</div>`;
}
const SR_INFO = {
  usb:   '<b>① USB 시리얼</b>: USB 단자 → CH340 → D0/D1 → MCU. 업로드·시리얼 모니터가 이 길을 씁니다. TX/RX LED가 깜빡입니다.',
  ext:   '<b>② 외부 장치 → D0/D1</b>: 장치 TXD → D0(RX), 장치 RXD ← D1(TX). USB를 쓰지 않을 때만 문제없이 동작합니다.',
  clash: '<b style="color:#f74f4f">충돌!</b> USB(CH340)와 외부 장치가 <b>같은 D0/D1</b>에 동시에 연결되었습니다. 업로드 실패, 글자 섞임이 생깁니다.',
  soft:  () => `<b>해결</b>: USB는 D0/D1을 그대로 쓰고, 블루투스는 <code>SoftwareSerial</code>로 <b>${pin('bt','TXD→')}/${pin('bt','RXD←')}</b>에 따로 연결합니다. 두 길이 겹치지 않아 <b>동시에</b> 쓸 수 있습니다.`,
};
function initStep4(sec){
  const svg = sec.querySelector('#s4Uno'), info = sec.querySelector('#srInfo');
  const show = { usb:['usb','d01'], ext:['ext','d01'], clash:['usb','ext','d01','clash'], soft:['usb','d01','soft'] };
  const leds = [...svg.querySelectorAll('[data-part="txrx"] rect:not(.hl)')];
  let mode = 'usb', t = 0;
  setInterval(() => { t++; const on = mode !== 'ext';
    leds.forEach((l,i) => l.setAttribute('fill', on && ((t + i) % 2) ? '#fff6a8' : '#f7d94f')); }, 260);
  const pick = m => { mode = m;
    svg.querySelectorAll('.sr-g').forEach(g => g.classList.toggle('on', show[m].includes(g.dataset.g)));
    svg.classList.toggle('sr-clash', m === 'clash');
    sec.querySelectorAll('[data-sr]').forEach(b => b.classList.toggle('on', b.dataset.sr === m));
    const v = SR_INFO[m]; info.innerHTML = typeof v === 'function' ? v() : v;
  };
  sec.querySelectorAll('[data-sr]').forEach(b => b.onclick = () => pick(b.dataset.sr));
  svg.addEventListener('click', e => {
    const g = e.target.closest('.uno-part'); if (!g) return;
    svg.querySelectorAll('.uno-part').forEach(x => x.classList.toggle('sel', x === g));
    info.innerHTML = UNO_INFO[g.dataset.part];
  });
  pick('usb');
}

/* 5단계: 브레드보드 (구멍 클릭 + M1 실습 회로) + 올바른/잘못된 꽂기 비교 */
const BB = { cols:16, x: c => 34 + c * 24,
  rows: { tp:60, tm:78, a:110, b:130, c:150, d:170, e:190, f:220, g:240, h:260, i:280, j:300, bp:332, bm:350 } };
function bbNet(row, col){
  if (row === 'tp') return 'R+t'; if (row === 'tm') return 'R-t';
  if (row === 'bp') return 'R+b'; if (row === 'bm') return 'R-b';
  return ('abcde'.includes(row) ? 'T' : 'B') + col;
}
function breadboardSVG(){
  const X = BB.x, R = BB.rows, xr = X(BB.cols) + 18;
  const LED = pin('led','+(저항 거쳐)'), GND = pin('led','−');
  let s = `<svg viewBox="0 0 470 372" id="bbSvg" role="img" aria-label="브레드보드">`;
  s += `<rect x="14" y="44" width="${xr - 4}" height="320" rx="8" fill="#d9d6cc" opacity=".12"/>`;
  [['tp','#f74f4f','+'],['tm','#4f8ef7','−'],['bp','#f74f4f','+'],['bm','#4f8ef7','−']].forEach(([r,c,t]) => {
    s += `<line x1="${X(1)-12}" x2="${X(BB.cols)+12}" y1="${R[r]}" y2="${R[r]}" stroke="${c}" stroke-width="1.5" opacity=".7"/>`;
    s += `<text x="22" y="${R[r]+5}" fill="${c}" font-size="14" font-weight="700">${t}</text>`;
  });
  s += `<rect x="${X(1)-12}" y="198" width="${X(BB.cols)-X(1)+24}" height="14" fill="#06070b"/>`;
  s += `<text x="${xr + 2}" y="209" fill="#7a7f99" font-size="11">홈</text>`;
  'abcdefghij'.split('').forEach(r => s += `<text x="22" y="${R[r]+4}" fill="#7a7f99" font-size="12">${r}</text>`);
  for (let c = 1; c <= BB.cols; c += 2) s += `<text x="${X(c)}" y="101" fill="#7a7f99" font-size="10" text-anchor="middle">${c}</text>`;
  Object.keys(R).forEach(r => { for (let c = 1; c <= BB.cols; c++){
    s += `<circle class="hole" cx="${X(c)}" cy="${R[r]}" r="5.5" data-net="${bbNet(r,c)}"/>`;
  }});
  // M1 실습 회로: D13 → 3열 → 220Ω → 7열 → LED(+ 긴 다리 → − 짧은 다리) → 9열 → − 레일 → GND
  s += `<g id="bbEx">
    <text x="${X(3)}" y="18" fill="#f7d94f" font-size="13" font-weight="700" text-anchor="middle">${esc(LED)}</text>
    <path d="M${X(3)},24 L${X(3)},${R.a}" stroke="#f7d94f" stroke-width="3.5"/>
    <text x="${X(12)}" y="18" fill="#9fb8ff" font-size="13" font-weight="700" text-anchor="middle">${esc(GND)}</text>
    <path d="M${X(12)},24 L${X(12)},${R.tm}" stroke="#9fb8ff" stroke-width="3.5"/>
    <path d="M${X(9)},${R.a} C${X(9)+10},${R.a-14} ${X(9)+10},${R.tm+10} ${X(9)},${R.tm}" stroke="#9fb8ff" stroke-width="3.5" fill="none"/>
    <line x1="${X(3)}" y1="${R.c}" x2="${X(7)}" y2="${R.c}" stroke="#c8b27a" stroke-width="2.5"/>
    <rect x="${X(4)}" y="${R.c-7}" width="${X(6)-X(4)}" height="14" rx="5" fill="#c8a46a" stroke="#6b4d1e"/>
    <text x="${X(5)}" y="${R.c-12}" fill="#f7a64f" font-size="12" text-anchor="middle">220Ω</text>
    <line x1="${X(7)}" y1="${R.e}" x2="${X(8)-6}" y2="${R.d-4}" stroke="#ccc" stroke-width="2.5"/>
    <line x1="${X(9)}" y1="${R.e}" x2="${X(8)+6}" y2="${R.d-4}" stroke="#ccc" stroke-width="2"/>
    <circle cx="${X(8)}" cy="${R.d-12}" r="10" fill="#c33" stroke="#f74f4f" stroke-width="2"/>
    <text x="${X(7)-4}" y="${R.e+18}" fill="#f7a64f" font-size="12" text-anchor="middle">+</text>
    <text x="${X(9)+4}" y="${R.e+18}" fill="#9fb8ff" font-size="12" text-anchor="middle">−</text>
  </g></svg>`;
  return s;
}
function initBreadboard(sec){
  const svg = sec.querySelector('#bbSvg'), info = sec.querySelector('#bbInfo');
  const LED = pin('led','+(저항 거쳐)');
  const holes = [...svg.querySelectorAll('.hole')];
  const clear = () => holes.forEach(h => h.classList.remove('on','ex1','ex2','ex3','ex4'));
  svg.addEventListener('click', e => {
    const h = e.target.closest('.hole'); if (!h) return;
    clear();
    const net = h.dataset.net;
    holes.filter(x => x.dataset.net === net).forEach(x => x.classList.add('on'));
    const c = net.slice(1);
    let msg;
    if (net[0] === 'R') msg = `<b>${net.includes('+') ? '+(빨강)' : '−(파랑)'} 전원 레일</b>: 가로로 길게 연결되어 있습니다. 5V나 GND를 여러 곳에 나눠 줄 때 씁니다. (긴 보드는 레일이 가운데서 끊긴 것도 있습니다)`;
    else msg = `<b>${c}열 ${net[0] === 'T' ? 'a~e' : 'f~j'}</b>: 세로 5칸이 한 묶음으로 연결됩니다. 가운데 홈 건너편과는 <b>끊겨 있습니다</b>.`;
    info.innerHTML = msg;
  });
  const ex = svg.querySelector('#bbEx'), btnEx = sec.querySelector('#bbBtnEx');
  btnEx.onclick = () => {
    const show = !ex.classList.contains('show');
    ex.classList.toggle('show', show); btnEx.classList.toggle('on', show);
    clear();
    if (show){
      [['T3','ex1'],['T7','ex2'],['T9','ex3'],['R-t','ex4']].forEach(([n,cl]) => holes.filter(x => x.dataset.net === n).forEach(x => x.classList.add(cl)));
      info.innerHTML = `✔ <b>M1 실습 회로</b>: <b>${LED}</b> → 3열 → 220Ω 저항 → 7열 → LED(+ 긴 다리 → − 짧은 다리) → 9열 → − 레일 → <b>GND</b>. 같은 색 구멍끼리 연결되어 있습니다.`;
    } else info.textContent = '구멍을 눌러 보세요.';
  };
}
/* 작은 브레드보드 조각(비교 그림용): 8열, 위 a~e(+아래 f~j 선택), 레일 선택 */
function miniBB(opt){
  const X = c => 16 + c * 20, Y = r => 24 + r * 14;      // r: 0~4 = a~e, 6~10 = f~j (5 = 홈)
  const H = opt.bottom ? 178 : (opt.rails ? 140 : 100);
  let s = `<svg viewBox="0 0 196 ${H}" class="mini">`;
  s += `<rect x="4" y="8" width="188" height="${H - 12}" rx="6" fill="#d9d6cc" opacity=".1"/>`;
  (opt.tint || []).forEach(([c, top, col]) => { const y0 = top ? Y(0) - 7 : Y(6) - 7; s += `<rect x="${X(c) - 7}" y="${y0}" width="14" height="70" rx="4" fill="${col}" opacity=".28"/>`; });
  const rows = opt.bottom ? [0,1,2,3,4,6,7,8,9,10] : [0,1,2,3,4];
  if (opt.bottom) s += `<rect x="12" y="${Y(5) - 5}" width="172" height="10" fill="#06070b"/>`;
  rows.forEach(r => { for (let c = 1; c <= 8; c++) s += `<circle cx="${X(c)}" cy="${Y(r)}" r="3.2" fill="#2a2d3e" stroke="#3a3e55"/>`; });
  if (opt.rails){ s += `<line x1="16" x2="184" y1="${Y(6)}" y2="${Y(6)}" stroke="#f74f4f" stroke-width="1.5"/><line x1="16" x2="184" y1="${Y(7.4)}" y2="${Y(7.4)}" stroke="#4f8ef7" stroke-width="1.5"/>`;
    for (let c = 1; c <= 8; c++){ s += `<circle cx="${X(c)}" cy="${Y(6)}" r="3" fill="#3a2020"/><circle cx="${X(c)}" cy="${Y(7.4)}" r="3" fill="#202a3a"/>`; } }
  return { s, X, Y, end: '</svg>' };
}
function partCompare(){
  const items = [];
  const card = (title, ok, bad, okTxt, badTxt) => items.push({ title, ok, bad, okTxt, badTxt });
  const res = (b, x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c8b27a" stroke-width="2"/>` +
    (y1 === y2 ? `<rect x="${(x1 + x2) / 2 - 16}" y="${y1 - 6}" width="32" height="12" rx="4" fill="#c8a46a" stroke="#6b4d1e"/>`
               : `<rect x="${x1 - 6}" y="${(y1 + y2) / 2 - 14}" width="12" height="28" rx="4" fill="#c8a46a" stroke="#6b4d1e"/>`);
  // 점퍼선
  { const a = miniBB({ tint:[[2,1,'#4fd1e0'],[6,1,'#4fd1e0']] }), b = miniBB({ tint:[[4,1,'#f74f4f']] });
    card('점퍼선',
      a.s + `<path d="M${a.X(2)},${a.Y(1)} L${a.X(2)},${a.Y(1) - 8} L${a.X(6)},${a.Y(1) - 8} L${a.X(6)},${a.Y(1)}" stroke="#4fcf83" stroke-width="3" fill="none"/>` + a.end,
      b.s + `<path d="M${b.X(4)},${b.Y(0)} C${b.X(9)},${b.Y(0) - 30} ${b.X(9)},${b.Y(4) + 20} ${b.X(4)},${b.Y(4)}" stroke="#4fcf83" stroke-width="3" fill="none"/>` + b.end,
      '필요한 길이로 잘라 90° 꺾어 바짝 붙임. 양 끝은 서로 다른 묶음', '양 끝이 같은 묶음 → 연결 의미 없음, 길게 붕 뜸'); }
  // 저항
  { const a = miniBB({ tint:[[2,1,'#4fd1e0'],[6,1,'#4fd1e0']] }), b = miniBB({ tint:[[4,1,'#f74f4f']] });
    card('저항', a.s + res(0, a.X(2), a.Y(2), a.X(6), a.Y(2)) + a.end, b.s + res(0, b.X(4), b.Y(0), b.X(4), b.Y(4)) + b.end,
      '다리를 꺾어 서로 다른 5칸 묶음에', '두 다리가 같은 5칸 묶음 → 저항이 없는 것과 같음(합선)'); }
  // 다이오드
  { const di = (m, x1, x2, y, bandRight) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#bbb" stroke-width="2"/><rect x="${(x1 + x2) / 2 - 16}" y="${y - 6}" width="32" height="12" rx="3" fill="#3a3a3a" stroke="#aaa"/>` +
      `<rect x="${bandRight ? (x1 + x2) / 2 + 9 : (x1 + x2) / 2 - 13}" y="${y - 6}" width="4" height="12" fill="#ddd"/>`;
    const lab = (m) => `<text x="${m.X(2)}" y="${m.Y(4) + 18}" fill="#f7a64f" font-size="10" text-anchor="middle">+쪽</text><text x="${m.X(6)}" y="${m.Y(4) + 18}" fill="#9fb8ff" font-size="10" text-anchor="middle">GND쪽</text>`;
    const a = miniBB({}), b = miniBB({});
    card('다이오드', a.s + di(a, a.X(2), a.X(6), a.Y(2), true) + lab(a) + a.end, b.s + di(b, b.X(2), b.X(6), b.Y(2), false) + lab(b) + b.end,
      '띠(캐소드, −)가 GND 쪽을 향함', '띠 방향이 반대 → 전류가 흐르지 않음'); }
  // LED
  { const led = (m, plusCol, minusCol) => { const xp = m.X(plusCol), xm = m.X(minusCol), cx = (xp + xm) / 2;
      return `<line x1="${xp}" y1="${m.Y(3)}" x2="${cx - 4}" y2="${m.Y(0) - 2}" stroke="#ccc" stroke-width="2.5"/><line x1="${xm}" y1="${m.Y(3)}" x2="${cx + 4}" y2="${m.Y(1) - 4}" stroke="#ccc" stroke-width="2"/>` +
        `<circle cx="${cx}" cy="${m.Y(0) - 8}" r="9" fill="#c33" stroke="#f74f4f"/><text x="${xp}" y="${m.Y(4) + 16}" fill="#f7a64f" font-size="10" text-anchor="middle">긴(+)</text><text x="${xm}" y="${m.Y(4) + 16}" fill="#9fb8ff" font-size="10" text-anchor="middle">짧은(−)</text>`; };
    const lab = m => `<text x="${m.X(1)}" y="12" fill="#f7d94f" font-size="9">← 저항·${esc(LED_PIN)}</text><text x="${m.X(8)}" y="12" fill="#9fb8ff" font-size="9" text-anchor="end">GND →</text>`;
    const a = miniBB({}), b = miniBB({});
    card('LED', a.s + led(a, 3, 5) + lab(a) + a.end, b.s + led(b, 5, 3) + lab(b) + b.end,
      `긴 다리(+) → 신호 쪽(저항 거쳐 ${LED_PIN}), 짧은 다리·납작한 면(−) → GND. 두 다리는 다른 묶음`, '+와 −를 반대로 꽂음 → 켜지지 않음'); }
  // 트랜지스터
  { const a = miniBB({ tint:[[3,1,'#4fd1e0'],[4,1,'#4fcf83'],[5,1,'#b48cf7']] }), b = miniBB({ tint:[[4,1,'#f74f4f']] });
    const to92 = (cx, cy) => `<path d="M${cx - 14},${cy} A14,14 0 0 1 ${cx + 14},${cy} Z" fill="#222" stroke="#888"/><text x="${cx}" y="${cy + 10}" fill="#7a7f99" font-size="8" text-anchor="middle">납작한 면</text>`;
    card('트랜지스터',
      a.s + [3,4,5].map(c => `<line x1="${a.X(c)}" y1="${a.Y(2)}" x2="${a.X(4) + (c - 4) * 6}" y2="${a.Y(0) - 2}" stroke="#ccc" stroke-width="2"/>`).join('') + to92(a.X(4), a.Y(0) - 2) + a.end,
      b.s + [1,2,3].map(r => `<line x1="${b.X(4)}" y1="${b.Y(r)}" x2="${b.X(4) + 18}" y2="${b.Y(r)}" stroke="#ccc" stroke-width="2"/>`).join('') + `<rect x="${b.X(4) + 18}" y="${b.Y(1) - 6}" width="14" height="40" rx="3" fill="#222" stroke="#888"/>` + b.end,
      '세 다리를 세 개의 다른 묶음에, 납작한 면 방향 확인', '세 다리가 같은 묶음 → 다리끼리 연결되어 동작 안 함'); }
  // 푸시 버튼·IC
  { const a = miniBB({ bottom:true }), b = miniBB({ bottom:true, tint:[[3,1,'#f74f4f'],[6,1,'#f74f4f']] });
    const btn = (m, x1, x2, y1, y2) => `<rect x="${x1 - 4}" y="${y1 - 4}" width="${x2 - x1 + 8}" height="${y2 - y1 + 8}" rx="4" fill="#333" stroke="#999"/><circle cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" r="8" fill="#555" stroke="#bbb"/>` +
      [[x1,y1],[x2,y1],[x1,y2],[x2,y2]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#f7d94f"/>`).join('');
    card('푸시 버튼 · IC', a.s + btn(a, a.X(3), a.X(6), a.Y(4), a.Y(6)) + a.end, b.s + btn(b, b.X(3), b.X(6), b.Y(1), b.Y(3)) + b.end,
      '가운데 홈을 걸쳐서 꽂음 (IC도 같음)', '홈 한쪽에만 꽂음 → 같은 열의 다리끼리 연결되어 버림'); }
  // 전원 레일
  { const a = miniBB({ rails:true }), b = miniBB({ rails:true });
    const wires = (m, vRed) => `<path d="M${m.X(2)},12 L${m.X(2)},${m.Y(vRed ? 6 : 7.4)}" stroke="#f74f4f" stroke-width="3"/><text x="${m.X(2) + 4}" y="14" fill="#f74f4f" font-size="10">5V</text>` +
      `<path d="M${m.X(6)},12 L${m.X(6)},${m.Y(vRed ? 7.4 : 6)}" stroke="#9fb8ff" stroke-width="3"/><text x="${m.X(6) + 4}" y="14" fill="#9fb8ff" font-size="10">GND</text>` +
      `<circle cx="${m.X(2)}" cy="${m.Y(vRed ? 6 : 7.4)}" r="4.5" fill="#f7d94f" stroke="#000"/><circle cx="${m.X(6)}" cy="${m.Y(vRed ? 7.4 : 6)}" r="4.5" fill="#f7d94f" stroke="#000"/>` +
      `<text x="190" y="${m.Y(6) + 4}" fill="#f74f4f" font-size="11" font-weight="700" text-anchor="end">+</text><text x="190" y="${m.Y(7.4) + 4}" fill="#4f8ef7" font-size="11" font-weight="700" text-anchor="end">−</text>`;
    card('전원 레일', a.s + wires(a, true) + a.end, b.s + wires(b, false) + b.end,
      '아두이노 5V → 빨강(+), GND → 파랑(−)', '5V를 파랑, GND를 빨강에 → 헷갈려서 극성이 뒤바뀜'); }
  return `<div class="cmp-grid">${items.map(it => `<div class="cmp">
      <div class="cmp-t">${it.title}</div>
      <div class="cmp-pair"><figure class="ok">${it.ok}<figcaption><b>✔ 올바름</b> ${it.okTxt}</figcaption></figure>
        <figure class="bad">${it.bad}<figcaption><b>✘ 잘못</b> ${it.badTxt}</figcaption></figure></div></div>`).join('')}</div>`;
}
function m1Step5(){
  return `<div class="ia"><div>${breadboardSVG()}
      <div class="row"><button class="btn" id="bbBtnEx">✔ M1 실습 회로 올려 보기</button></div>
      <div class="status" id="bbInfo">구멍을 눌러 보세요. 함께 연결된 구멍이 노랗게 켜집니다.</div></div>
    <div class="explain"><ul>
      <li>번호 열마다 <b>a~e</b>, <b>f~j</b>가 각각 <b>세로 5칸 한 묶음</b>으로 연결됩니다.</li>
      <li><b>가운데 홈</b>에서 위·아래가 끊깁니다.</li>
      <li>양 가장자리 <b style="color:var(--red)">빨강(+)</b>·<b style="color:var(--accent)">파랑(−)</b> 줄은 가로로 길게 연결된 <b>전원 레일</b>. 긴 보드는 레일이 가운데서 끊긴 경우도 있습니다.</li>
      <li>배선은 <b>USB·배터리를 뺀 상태</b>에서 합니다.</li>
    </ul></div></div>
    <h4 class="sub-h">부품을 올바르게 꽂는 법 (✔ 올바름 / ✘ 잘못)</h4>
    <p class="muted" style="font-size:.85rem">색칠된 세로 띠 = 그 다리가 들어간 5칸 묶음. 같은 색 띠에 두 다리가 함께 있으면 서로 연결된 것입니다.</p>
    ${partCompare()}`;
}

/* 6단계: Arduino IDE · CH340 드라이버 · 보레이트 (+ setup/loop, loop 실행해 보기) */
const IDE_INFO = {
  1: '<b>① 확인(✓)</b>: 컴파일. 코드에 오류가 있는지 검사합니다. 오류는 아래 출력 창에 위치(줄 번호)와 함께 나옵니다.',
  2: '<b>② 업로드(→)</b>: 컴파일한 뒤 보드의 플래시 메모리에 기록합니다. 끝나면 보드가 자동으로 새 프로그램을 실행합니다.',
  3: '<b>③ 보드·포트 선택</b>: 툴 › 보드 › <b>Arduino Uno</b>, 툴 › 포트 › <b>COMx</b>(장치 관리자에서 확인한 번호).',
  4: '<b>④ 시리얼 모니터(돋보기)</b>: 아두이노가 보낸 글자를 봅니다. 오른쪽 아래 보레이트를 코드와 같게 맞춥니다.',
  5: '<b>⑤ 코드 창</b>: <code>setup()</code>은 전원이 켜질 때 한 번, <code>loop()</code>는 계속 반복. 이 두 함수는 지우면 안 됩니다.',
  6: '<b>⑥ 출력 창</b>: 컴파일·업로드 결과와 오류 메시지가 나옵니다. 빨간 글자가 나오면 위치를 보고 고칩니다.',
};
function ideSVG(){
  const call = (n, x, y) => `<g class="ide-call" data-ide="${n}"><circle cx="${x}" cy="${y}" r="11" fill="#f7a64f"/><text x="${x}" y="${y + 4}" fill="#000" font-size="12" font-weight="800" text-anchor="middle">${n}</text></g>`;
  return `<svg viewBox="0 0 540 330" id="ideSvg" role="img" aria-label="Arduino IDE 화면 목업">
    <rect x="10" y="10" width="520" height="310" rx="8" fill="#f2f2f2" stroke="#999"/>
    <rect x="10" y="10" width="520" height="24" rx="8" fill="#e0e0e0"/><text x="22" y="27" fill="#333" font-size="11">파일  편집  스케치  툴  도움말</text>
    <rect x="10" y="34" width="520" height="40" fill="#00878a"/>
    <circle cx="36" cy="54" r="13" fill="#fff"/><text x="36" y="59" fill="#00878a" font-size="15" font-weight="800" text-anchor="middle">✓</text>
    <circle cx="68" cy="54" r="13" fill="#fff"/><text x="68" y="59" fill="#00878a" font-size="15" font-weight="800" text-anchor="middle">→</text>
    <rect x="100" y="42" width="170" height="24" rx="4" fill="#fff"/><text x="110" y="58" fill="#333" font-size="11">Arduino Uno · COM3 ▾</text>
    <circle cx="505" cy="54" r="13" fill="#fff"/><circle cx="502" cy="51" r="5" fill="none" stroke="#00878a" stroke-width="2"/><line x1="506" y1="55" x2="511" y2="60" stroke="#00878a" stroke-width="2"/>
    <rect x="10" y="74" width="520" height="22" fill="#fff"/><text x="100" y="89" fill="#00878a" font-size="11">m1_blink.ino</text>
    <rect x="10" y="96" width="520" height="150" fill="#fff"/>
    <g font-family="Consolas,monospace" font-size="11.5"><text x="20" y="116" fill="#999">1</text><text x="40" y="116" fill="#00878a">void</text><text x="74" y="116" fill="#333">setup() {</text>
      <text x="20" y="134" fill="#999">2</text><text x="56" y="134" fill="#888">// 한 번 실행: 핀 설정, Serial.begin(${PINMAP.usb.baud})</text>
      <text x="20" y="152" fill="#999">3</text><text x="40" y="152" fill="#333">}</text>
      <text x="20" y="170" fill="#999">4</text><text x="40" y="170" fill="#00878a">void</text><text x="74" y="170" fill="#333">loop() {</text>
      <text x="20" y="188" fill="#999">5</text><text x="56" y="188" fill="#888">// 계속 반복: 켜기, 기다리기, 끄기…</text>
      <text x="20" y="206" fill="#999">6</text><text x="40" y="206" fill="#333">}</text></g>
    <rect x="10" y="246" width="520" height="74" fill="#1e1e1e"/><text x="20" y="266" fill="#ccc" font-size="11">출력</text>
    <text x="20" y="286" fill="#9c9" font-size="11" font-family="Consolas,monospace">스케치는 프로그램 저장 공간 1994 바이트(6%)를 사용…</text>
    <text x="20" y="304" fill="#9c9" font-size="11" font-family="Consolas,monospace">업로드 완료</text>
    ${call(1, 36, 86)}${call(2, 68, 86)}${call(3, 285, 54)}${call(4, 480, 54)}${call(5, 470, 150)}${call(6, 470, 270)}
  </svg>`;
}
function devmgrSVG(){
  return `<svg viewBox="0 0 520 180" id="dmSvg" role="img" aria-label="장치 관리자 목업">
    <rect x="6" y="6" width="508" height="168" rx="6" fill="#fafafa" stroke="#999"/>
    <text x="18" y="28" fill="#333" font-size="13" font-weight="700">장치 관리자</text>
    <g id="dmBefore"><text x="24" y="58" fill="#333" font-size="12">▾ 기타 장치</text>
      <text x="44" y="82" fill="#333" font-size="12"><tspan fill="#d9a400" font-weight="800">⚠</tspan> USB2.0-Serial</text>
      <text x="24" y="110" fill="#333" font-size="12">▸ 포트(COM &amp; LPT)</text>
      <text x="24" y="150" fill="#c33" font-size="12">노란 느낌표 = 드라이버가 없음 → CH340 드라이버 설치 필요</text></g>
    <g id="dmAfter" style="display:none"><text x="24" y="58" fill="#333" font-size="12">▾ 포트(COM &amp; LPT)</text>
      <text x="44" y="82" fill="#333" font-size="12">🔌 USB-SERIAL CH340 (<tspan font-weight="800" fill="#0a7">COM3</tspan>)</text>
      <text x="24" y="150" fill="#0a7" font-size="12">정상 인식 — COM 번호(예: COM3)를 적어 두고 IDE 포트에서 고릅니다</text></g>
  </svg>`;
}
const BAUDS = [9600, 57600, 115200];
function garble(text, seed){
  const pool = 'ÿ�þ¿ÆÐ×ßæ#~^|¤§°±µ¶·¸¹º»¼½¾', out = [];
  let x = seed % 9973 + 7;
  for (let i = 0; i < text.length; i++){ x = (x * 1103 + 12345) % 65536; out.push(text[i] === ' ' && x % 3 ? ' ' : pool[x % pool.length]); }
  return out.join('');
}
function m1Step6(){
  const opts = sel => BAUDS.map(b => `<option value="${b}" ${b === sel ? 'selected' : ''}>${b}</option>`).join('');
  return `<h4 class="sub-h">Arduino IDE 설치와 사용 순서</h4>
    <div class="ia"><div>${ideSVG()}<div class="status" id="ideInfo">주황 번호를 눌러 보세요.</div></div>
      <div class="explain"><ol>
        <li><b>arduino.cc/en/software</b>에서 Arduino IDE 2.x 설치</li>
        <li>코드 왼쪽에 줄 번호가 기본으로 보입니다(오류 위치 찾기에 씀)</li>
        <li>툴 › 보드 › <b>Arduino Uno</b>, 툴 › 포트 › <b>COMx</b></li>
        <li><b>확인(✓)</b> = 컴파일(오류 검사) → <b>업로드(→)</b> = 보드에 기록, 끝나면 자동 실행</li>
        <li>오른쪽 위 <b>돋보기</b> = 시리얼 모니터</li>
      </ol>
      <p style="font-size:.9rem">저장하면 <code>.ino</code>와 같은 이름의 폴더가 생깁니다. 컴파일 오류는 아래 출력 창에 위치와 함께 나옵니다.</p></div></div>
    <div class="box"><b>setup()과 loop()</b> — <code>setup()</code>은 전원이 켜질 때 <b>한 번</b>, <code>loop()</code>는 <b>끝없이 반복</b>됩니다. 아래 버튼으로 M1 예제가 어떻게 도는지 흉내 내 보세요.
      <div class="row"><svg viewBox="0 0 40 40" style="width:34px"><circle id="lpLed" cx="20" cy="20" r="13" fill="#5a1414" stroke="#f74f4f" stroke-width="2"/></svg>
        <button class="btn" id="lpBtn">loop() 실행해 보기</button><span class="muted" style="font-size:.85rem">가짜 시리얼 모니터(${PINMAP.usb.baud}bps)</span></div>
      <div class="fake-serial" id="lpSerial"></div></div>
    <h4 class="sub-h">CH340 드라이버 (호환 보드)</h4>
    <div class="ia"><div>${devmgrSVG()}
        <div class="row"><button class="btn on" data-dm="before">설치 전</button><button class="btn" data-dm="after">설치 후</button></div></div>
      <div class="explain"><ul>
        <li>정품 보드는 자동 인식됩니다. SMARS의 우노 <b>호환 보드(CH340)</b>는 장치 관리자 '기타 장치'에 <b>노란 느낌표</b>로 뜹니다.</li>
        <li>수업 폴더의 <code>CH34x_Install_Windows_v4_0</code>을 실행해 CH340/CH341 드라이버를 설치합니다.</li>
        <li>'포트(COM &amp; LPT)'에 <b>USB-SERIAL CH340 (COMx)</b>로 보이면 정상. <b>COM 번호를 적어 둡니다.</b></li>
      </ul></div></div>
    <h4 class="sub-h">보레이트 (baud rate)</h4>
    <div class="ia"><div>
        <div class="row"><label>보내는 쪽 <code>Serial.begin(</code><select id="bdTx" class="txt">${opts(PINMAP.usb.baud)}</select><code>)</code></label></div>
        <div class="row"><label>받는 쪽 (시리얼 모니터 오른쪽 아래) <select id="bdRx" class="txt">${opts(BAUDS.find(b => b !== PINMAP.usb.baud))}</select></label></div>
        <div class="fake-serial" id="bdOut" style="height:5.5em"></div>
        <div class="status" id="bdInfo"></div></div>
      <div class="explain"><ul>
        <li><b>보레이트</b> = 1초에 보내는 비트 수(bps). 보내는 쪽과 받는 쪽이 <b>같아야</b> 합니다. 다르면 글자가 깨집니다.</li>
        <li>한 글자 = 시작 비트 + 8비트 + 정지 비트 = 10비트 → ${PINMAP.usb.baud}bps면 1초에 약 <b>${PINMAP.usb.baud / 10}글자</b>.</li>
        <li>흔한 값: 9600 · 57600 · 115200.</li>
        <li><b>이 수업</b>: USB <b>${PINMAP.usb.baud}</b>, 블루투스 HC-05 <b>${PINMAP.bt.baud}</b>.</li>
      </ul></div></div>`;
}
function initStep6(sec){
  const ide = sec.querySelector('#ideSvg'), info = sec.querySelector('#ideInfo');
  ide.addEventListener('click', e => { const g = e.target.closest('.ide-call'); if (!g) return;
    ide.querySelectorAll('.ide-call').forEach(x => x.classList.toggle('sel', x === g)); info.innerHTML = IDE_INFO[g.dataset.ide]; });
  // loop() 흉내
  const led = sec.querySelector('#lpLed'), btn = sec.querySelector('#lpBtn'), out = sec.querySelector('#lpSerial');
  let timer = null, on = false;
  btn.onclick = () => {
    if (timer){ clearInterval(timer); timer = null; btn.textContent = 'loop() 실행해 보기'; btn.classList.remove('on'); return; }
    out.textContent = `[setup] 한 번 실행: ${LED_PIN}을 출력으로, Serial.begin(${PINMAP.usb.baud})\n`;
    btn.textContent = 'loop() 멈추기'; btn.classList.add('on');
    const tick = () => { on = !on; led.setAttribute('fill', on ? '#ff5a5a' : '#5a1414');
      out.textContent += `[loop] ${on ? 'ON' : 'OFF'}\n`;
      const L = out.textContent.split('\n'); if (L.length > 40) out.textContent = L.slice(-40).join('\n');
      out.scrollTop = out.scrollHeight; };
    tick(); timer = setInterval(tick, 500);
  };
  // 장치 관리자
  sec.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => {
    const after = b.dataset.dm === 'after';
    sec.querySelector('#dmBefore').style.display = after ? 'none' : ''; sec.querySelector('#dmAfter').style.display = after ? '' : 'none';
    sec.querySelectorAll('[data-dm]').forEach(x => x.classList.toggle('on', x === b));
  });
  // 보레이트
  const tx = sec.querySelector('#bdTx'), rx = sec.querySelector('#bdRx'), bo = sec.querySelector('#bdOut'), bi = sec.querySelector('#bdInfo');
  const MSG = ['M1 ready', 'ON', 'OFF', 'ON', 'OFF'];
  const upd = () => {
    const a = +tx.value, b = +rx.value;
    bo.textContent = MSG.map((m, i) => a === b ? m : garble(m + '  ', a + b * 7 + i * 13)).join('\n');
    bo.style.color = a === b ? 'var(--green)' : 'var(--red)';
    bi.innerHTML = a === b ? `같음(${a}) → 정상 글자. 1초에 약 ${a / 10}글자를 보낼 수 있습니다.` : `<b style="color:var(--red)">다름</b> (${a} ≠ ${b}) → 글자가 깨집니다. 시리얼 모니터 값을 ${a}로 바꾸세요.`;
  };
  tx.onchange = upd; rx.onchange = upd; upd();
}

function m1PrincipleHTML(){
  return stepperHTML('m1Steps', [
    { title:'아두이노 보드(UNO R3)', html: m1Step1() },
    { title:'신호선과 전원선', html: m1Step2() },
    { title:'전원 공급 3가지', html: m1Step3() },
    { title:'시리얼 통신 2경로', html: m1Step4() },
    { title:'브레드보드 사용법', html: m1Step5() },
    { title:'IDE · CH340 · 보레이트', html: m1Step6() },
  ]);
}
function initM1(sec){
  initStepper(sec, 'm1Steps');
  initUnoClick(sec, 's1', 's1Info');
  initStep2(sec); initStep3(sec); initStep4(sec); initBreadboard(sec); initStep6(sec);
}

/* 5-2. M2 H-bridge: 스위치 S1~S4 토글 → 전류 경로·회전 방향·단락 경고 */
function hbridgeSVG(){
  const sw = (id, x, y1, y2, lx) => `<g class="sw" data-sw="${id}">
      <circle cx="${x}" cy="${y1}" r="4" fill="#9aa"/><circle cx="${x}" cy="${y2}" r="4" fill="#9aa"/>
      <line class="sw-blade" x1="${x}" y1="${y2}" x2="${x - 20}" y2="${y1 + 4}"/>
      <text class="sw-label" x="${lx}" y="${(y1 + y2) / 2 + 5}" text-anchor="middle">S${id}</text>
      <rect class="sw-hit" x="${x - 40}" y="${y1 - 10}" width="80" height="${y2 - y1 + 20}" rx="8"/></g>`;
  return `<svg viewBox="0 0 440 320" id="hbSvg" role="img" aria-label="H-bridge">
    <text x="220" y="18" fill="#f74f4f" font-size="14" font-weight="700" text-anchor="middle">+ 전원(배터리)</text>
    <path class="hb-wire" d="M220,24 L220,40 M100,40 L340,40 M100,40 L100,75 M100,115 L100,185 M100,225 L100,270
      M340,40 L340,75 M340,115 L340,185 M340,225 L340,270 M100,270 L340,270 M220,270 L220,286 M100,150 L190,150 M250,150 L340,150"/>
    <text x="220" y="304" fill="#4f8ef7" font-size="14" font-weight="700" text-anchor="middle">GND(−)</text>
    <path class="flow" data-seg="railTopL" d="M220,40 L100,40"/><path class="flow" data-seg="railTopR" d="M220,40 L340,40"/>
    <path class="flow" data-seg="S1" d="M100,40 L100,150"/><path class="flow" data-seg="S2" d="M340,40 L340,150"/>
    <path class="flow" data-seg="S3" d="M100,150 L100,270"/><path class="flow" data-seg="S4" d="M340,150 L340,270"/>
    <path class="flow" data-seg="mid" d="M100,150 L190,150 M250,150 L340,150"/>
    <path class="flow" data-seg="railBotL" d="M100,270 L220,270"/><path class="flow" data-seg="railBotR" d="M340,270 L220,270"/>
    <circle cx="220" cy="150" r="30" fill="#141722" stroke="#e8eaf6" stroke-width="2.5"/>
    <g id="hbRotor" class="spin"><path d="M220,130 A20,20 0 1 1 201,144" stroke="#4fcf83" stroke-width="3" fill="none"/><path d="M220,124 L228,130 L220,136 Z" fill="#4fcf83"/></g>
    <text x="220" y="156" fill="#e8eaf6" font-size="16" font-weight="700" text-anchor="middle">M</text>
    <text x="220" y="200" fill="#7a7f99" font-size="12" text-anchor="middle">DC모터</text>
    ${sw(1, 100, 75, 115, 56)}${sw(2, 340, 75, 115, 384)}${sw(3, 100, 185, 225, 56)}${sw(4, 340, 185, 225, 384)}
  </svg>`;
}
function initHbridge(sec){
  const svg = sec.querySelector('#hbSvg'), st = sec.querySelector('#hbStatus'), warn = sec.querySelector('#hbShort');
  const rotor = svg.querySelector('#hbRotor');
  const on = { 1:false, 2:false, 3:false, 4:false };
  let spinning = null;   // 'cw' | 'ccw' | null — 직전 회전 방향(브레이크·자유 정지 애니메이션용)
  const segs = n => svg.querySelector(`.flow[data-seg="${n}"]`);
  function update(){
    svg.querySelectorAll('.sw').forEach(g => {
      const id = g.dataset.sw, c = on[id], b = g.querySelector('.sw-blade');
      const x = +b.getAttribute('x1');
      const y1 = +g.querySelectorAll('circle')[0].getAttribute('cy');
      g.classList.toggle('closed', c);
      b.setAttribute('x2', c ? x : x - 20); b.setAttribute('y2', c ? y1 : y1 + 4);
    });
    svg.querySelectorAll('.flow').forEach(f => f.classList.remove('on','rev','short','brk'));
    rotor.classList.remove('cw','ccw','stopFastCw','stopFastCcw','stopSlowCw','stopSlowCcw');
    void rotor.getBoundingClientRect();   // 정지 애니메이션을 다시 시작하게 함
    const prev = spinning; spinning = null;
    const stopAnim = fast => { if (prev) rotor.classList.add((fast ? 'stopFast' : 'stopSlow') + (prev === 'cw' ? 'Cw' : 'Ccw')); };
    const shortL = on[1] && on[3], shortR = on[2] && on[4];
    const light = (names, cls) => names.forEach(n => { const s = segs(n); s.classList.add('on'); if (cls) s.classList.add(cls); });
    warn.classList.toggle('show', shortL || shortR);
    if (shortL || shortR){
      if (shortL) light(['railTopL','S1','S3','railBotL'], 'short');
      if (shortR) light(['railTopR','S2','S4','railBotR'], 'short');
      st.innerHTML = `<span style="color:var(--red);font-weight:700">단락!</span> 같은 쪽 스위치 두 개(${shortL ? 'S1+S3' : ''}${shortL && shortR ? ', ' : ''}${shortR ? 'S2+S4' : ''})가 켜져 전류가 모터를 거치지 않고 바로 GND로 흐릅니다.`;
    } else if (on[1] && on[4]){
      light(['railTopL','S1','mid','S4','railBotR']); rotor.classList.add('cw'); spinning = 'cw';
      st.innerHTML = `대각선 쌍 <b>S1+S4</b>: 전류가 모터를 <b>왼쪽 → 오른쪽</b>으로 지나갑니다 → <b style="color:var(--green)">정방향 회전</b>`;
    } else if (on[2] && on[3]){
      light(['railTopR','S2','mid','S3','railBotL']); segs('mid').classList.add('rev'); rotor.classList.add('ccw'); spinning = 'ccw';
      st.innerHTML = `대각선 쌍 <b>S2+S3</b>: 전류가 모터를 <b>오른쪽 → 왼쪽</b>으로 지나갑니다 → <b style="color:var(--accent2)">역방향 회전</b>`;
    } else if ((on[3] && on[4]) || (on[1] && on[2])){
      const low = on[3] && on[4];
      light(low ? ['S3','railBotL','railBotR','S4','mid'] : ['S1','railTopL','railTopR','S2','mid'], 'brk');
      if (prev === 'ccw') svg.querySelectorAll('.flow.brk').forEach(f => f.classList.add('rev'));
      stopAnim(true);
      st.innerHTML = `<b style="color:#f7a64f">브레이크</b> (${low ? 'S3+S4' : 'S1+S2'}): 모터의 두 단자가 ${low ? 'GND' : '+ 전원'} 쪽으로 <b>서로 이어집니다</b>. ` +
        (prev ? '돌던 모터가 발전기처럼 만든 전기(역기전력)가 이 고리로 흘러 회전을 막는 힘이 생깁니다 → <b>빨리 멈춤</b>.' : '모터가 서 있으면 흐를 전류가 없습니다. 먼저 정방향·역방향으로 돌린 뒤 눌러 보세요.');
    } else {
      stopAnim(false);
      st.innerHTML = prev ? '<b>모두 끄기(자유 정지, coast)</b>: 전류의 길이 끊겨 모터가 관성으로 돌다가 <b>천천히 멈춥니다</b>. 브레이크와 비교해 보세요.'
                          : '전류가 한 바퀴 돌아올 길이 없습니다 → 모터 정지. 대각선 한 쌍을 켜 보세요.';
    }
  }
  svg.addEventListener('click', e => { const g = e.target.closest('.sw'); if (!g) return; on[g.dataset.sw] = !on[g.dataset.sw]; update(); });
  sec.querySelectorAll('[data-hb]').forEach(b => b.onclick = () => {
    const v = b.dataset.hb; [1,2,3,4].forEach(i => on[i] = v.includes(String(i))); update();
  });
  update();
}

/* 5-3. M2 PWM: 슬라이더 → 파형·평균·바퀴 속도, 약 25% 이하 deadband */
function initPwm(sec){
  const sl = sec.querySelector('#pwmSlider'), wave = sec.querySelector('#pwmWave'), avg = sec.querySelector('#pwmAvg');
  const txt = sec.querySelector('#pwmText'), wheel = sec.querySelector('#pwmWheel'), wst = sec.querySelector('#pwmWheelSt');
  let pct = +sl.value, ang = 0, last = performance.now();
  function draw(){
    pct = +sl.value;
    const val = Math.floor(pct * 255 / 100), d = val / 255, P = 80;
    let p = 'M10,100';
    for (let i = 0; i < 5; i++){
      const x = 10 + i * P;
      if (d <= 0) p += ` L${x + P},100`;
      else if (d >= 1) p += ` L${x},20 L${x + P},20`;
      else p += ` L${x},100 L${x},20 L${x + P * d},20 L${x + P * d},100 L${x + P},100`;
    }
    wave.setAttribute('d', p);
    const ay = 100 - 80 * d; avg.setAttribute('y1', ay); avg.setAttribute('y2', ay);
    txt.innerHTML = `속도 <b>${pct}%</b> → <code>analogWrite(PWM, ${val})</code> → 듀티비 ${val}/255 = <b>${Math.round(d * 100)}%</b> · 평균 전압 = 전원 전압 × ${Math.round(d * 100)}%`;
    if (pct === 0) wst.innerHTML = '정지 (PWM 0)';
    else if (pct <= 25) wst.innerHTML = '<span class="deadband">"웅—" 소리만 나고 안 돎 (deadband, 약 25% 이하)</span>';
    else wst.innerHTML = '<span style="color:var(--green)">회전 중</span> — 값이 클수록 빠름';
  }
  function frame(now){
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (pct > 25) ang = (ang + dt * 360 * 1.6 * (pct - 25) / 75) % 360;
    const jit = (pct > 0 && pct <= 25) ? (Math.random() - 0.5) * 3 : 0;
    wheel.setAttribute('transform', `rotate(${ang + jit} 60 60)`);
    requestAnimationFrame(frame);
  }
  sl.addEventListener('input', draw);
  draw(); requestAnimationFrame(frame);
}

/* 5-4. 공통: SVG 좌표 변환 + 드래그(SVG 전체가 드래그 면) */
function svgPt(svg, e){ const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function dragOn(svg, onMove){
  let drag = false;
  svg.addEventListener('pointerdown', e => { drag = true; try { svg.setPointerCapture(e.pointerId); } catch(_){} onMove(svgPt(svg, e)); e.preventDefault(); });
  svg.addEventListener('pointermove', e => { if (drag) onMove(svgPt(svg, e)); });
  const stop = () => { drag = false; };
  svg.addEventListener('pointerup', stop); svg.addEventListener('pointercancel', stop);
}

/* 5-5. M3 부저: 능동형/수동형 비교 + 삑·경보·SOS 타임라인
   패턴 시간은 ex-m3 예제 원문(P_BEEP, P_ALARM, P_SOS 배열)에서 읽는다 → 예제와 항상 같은 길이.
   예제 블록을 못 읽을 때만 아래 대체값(예제와 같은 값)을 쓴다. */
const BUZ_FALLBACK = { BEEP:[200], ALARM:[200,200,200,200,200,200,200,200,200,200], SOS:[150,150,150,150,150,450,450,150,450,150,450,450,150,150,150,150,150] };
const BUZ_NAMES = [['BEEP','1','삑'],['ALARM','2','경보'],['SOS','3','SOS']];
function buzzerPatterns(){
  const out = {}, el = $('ex-m3');
  if (el){
    const code = el.textContent.replace(/\/\/.*/g, '');
    const re = /P_(\w+)\[\]\s*=\s*\{([^}]*)\}/g; let m;
    while ((m = re.exec(code))) out[m[1]] = m[2].split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  }
  BUZ_NAMES.forEach(([k]) => { if (!out[k] || !out[k].length) out[k] = BUZ_FALLBACK[k]; });
  return out;
}
function buzzerCompareSVG(){
  const wave = (x, y) => `<path d="M${x},${y} q6,-10 12,0 q6,10 12,0" stroke="#f7d94f" stroke-width="2" fill="none"/>`;
  return `<svg viewBox="0 0 560 170" role="img" aria-label="능동형과 수동형 부저 비교">
    <rect x="6" y="6" width="270" height="158" rx="10" fill="#141722" stroke="#4fcf83"/>
    <text x="16" y="28" fill="#4fcf83" font-size="15" font-weight="700">능동형 (이 로봇)</text>
    <text x="16" y="62" fill="#7a7f99" font-size="12">핀 신호</text>
    <path d="M16,90 L36,90 L36,72 L70,72" stroke="#4fd1e0" stroke-width="2.5" fill="none"/>
    <text x="16" y="110" fill="#4fd1e0" font-size="12">HIGH만 주면 됨</text>
    <rect x="84" y="56" width="78" height="40" rx="6" fill="#1a1d27" stroke="#b48cf7"/>
    <text x="123" y="73" fill="#b48cf7" font-size="12" text-anchor="middle">내부</text><text x="123" y="89" fill="#b48cf7" font-size="12" text-anchor="middle">발진회로</text>
    <line x1="70" y1="76" x2="84" y2="76" stroke="#7a7f99" stroke-width="2"/><line x1="162" y1="76" x2="176" y2="76" stroke="#7a7f99" stroke-width="2"/>
    <rect x="176" y="56" width="56" height="40" rx="20" fill="#2a2d3e" stroke="#e8eaf6"/>
    <text x="204" y="81" fill="#e8eaf6" font-size="11" text-anchor="middle">압전</text>
    ${wave(238,76)}
    <text x="16" y="140" fill="#e8eaf6" font-size="13">정해진 음 한 가지 (음높이 못 바꿈)</text>
    <rect x="284" y="6" width="270" height="158" rx="10" fill="#141722" stroke="#7a7f99"/>
    <text x="294" y="28" fill="#7a7f99" font-size="15" font-weight="700">수동형 (비교용)</text>
    <text x="294" y="62" fill="#7a7f99" font-size="12">핀 신호</text>
    <path d="M294,90 L300,90 L300,72 L306,72 L306,90 L312,90 L312,72 L318,72 L318,90 L324,90 L324,72 L330,72 L330,90 L336,90 L336,72 L342,72 L342,90 L348,90" stroke="#4fd1e0" stroke-width="2.5" fill="none"/>
    <text x="294" y="110" fill="#4fd1e0" font-size="12">주파수(떨림 신호)를 줘야 함</text>
    <line x1="350" y1="76" x2="440" y2="76" stroke="#7a7f99" stroke-width="2"/>
    <rect x="440" y="56" width="56" height="40" rx="20" fill="#2a2d3e" stroke="#e8eaf6"/>
    <text x="468" y="81" fill="#e8eaf6" font-size="11" text-anchor="middle">압전</text>
    ${wave(502,76)}
    <text x="294" y="140" fill="#e8eaf6" font-size="13">주파수를 바꾸면 음높이도 바뀜</text>
  </svg>`;
}
const BUZ_TL = { X0:96, W:450 };
function buzzerTimelineSVG(P){
  const total = k => P[k].reduce((a,b) => a + b, 0);
  const maxT = Math.max(...BUZ_NAMES.map(([k]) => total(k)));
  const X0 = BUZ_TL.X0, W = BUZ_TL.W, sc = W / maxT;
  let s = `<svg viewBox="0 0 560 140" id="buzTl" role="img" aria-label="부저 패턴 타임라인">`;
  BUZ_NAMES.forEach(([k, key, name], r) => {
    const y = 14 + r * 38;
    s += `<g class="buz-row" data-row="${k}"><rect x="2" y="${y - 7}" width="556" height="34" rx="6" class="buz-rowbg"/>
      <text x="10" y="${y + 15}" fill="#e8eaf6" font-size="13"><tspan font-weight="700" fill="#f7a64f">${key}</tspan> ${name}</text>
      <line x1="${X0}" x2="${X0 + W}" y1="${y + 20}" y2="${y + 20}" stroke="#2a2d3e"/>`;
    let t = 0;
    P[k].forEach((ms, i) => { if (i % 2 === 0) s += `<rect x="${X0 + t * sc}" y="${y}" width="${Math.max(1.5, ms * sc)}" height="20" rx="2" fill="#f7d94f"/>`; t += ms; });
    if (t * sc < W - 50) s += `<text x="${X0 + t * sc + 6}" y="${y + 15}" fill="#7a7f99" font-size="11">${t}ms</text>`;
    s += `</g>`;
  });
  s += `<text x="${X0}" y="134" fill="#7a7f99" font-size="11">0</text><text x="${X0 + W}" y="134" fill="#7a7f99" font-size="11" text-anchor="end">${maxT}ms</text>`;
  s += `<line id="buzHead" x1="${X0}" x2="${X0}" y1="4" y2="124" stroke="#f74f4f" stroke-width="2" opacity="0"/></svg>`;
  return s;
}
function buzzerPrincipleHTML(){
  const P = buzzerPatterns();
  const sum = k => P[k].reduce((a,b) => a + b, 0);
  const desc = { BEEP:`켜짐 ${P.BEEP[0]}ms 한 번`, ALARM:`${P.ALARM[0]}ms 켜짐/꺼짐 ${Math.ceil(P.ALARM.length / 2)}회`, SOS:`짧게(점) ${P.SOS[0]}ms ×3, 길게(선) ${P.SOS[6]}ms ×3, 짧게 ×3` };
  return `<div class="ia">
    <div>${buzzerCompareSVG()}</div>
    <div class="explain"><ul>
      <li><b>압전 소자</b>: 전기를 주면 얇은 판이 떨리면서 소리가 납니다.</li>
      <li><b>능동형</b>: 안에 <b>발진회로</b>(스스로 떨림 신호를 만드는 회로)가 있어 전원만 주면 일정한 음이 납니다. 음높이는 못 바꿉니다. <b>이 로봇의 부저입니다.</b></li>
      <li><b>수동형</b>: 밖에서 주파수를 줘야 울립니다. 대신 음높이를 바꿀 수 있습니다.</li>
      <li>그래서 이 로봇은 <code>digitalWrite</code>로 <b>켜고 끄는 시간</b>만 바꿔 패턴을 만듭니다.</li>
    </ul></div>
  </div>
  <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
  <div class="ia">
    <div>${buzzerTimelineSVG(P)}
      <div class="row">${BUZ_NAMES.map(([k,key,name]) => `<button class="btn" data-buz="${k}">${key} ${name}</button>`).join('')}
        <label class="muted" style="font-size:.85rem"><input type="checkbox" id="buzSound"> 화면 소리 켜기</label></div>
    </div>
    <div class="explain" style="display:flex;gap:14px;align-items:flex-start">
      <svg viewBox="0 0 120 120" style="width:100px;flex:none" aria-label="부저">
        <g id="buzIcon"><circle class="buz-body" cx="50" cy="60" r="30" fill="#2a2d3e" stroke="#e8eaf6" stroke-width="3"/><circle cx="50" cy="60" r="8" fill="#0b0d13"/>
        <g class="buz-waves"><path d="M88,44 q10,16 0,32" stroke="#f7d94f" stroke-width="3" fill="none"/><path d="M98,36 q16,24 0,48" stroke="#f7d94f" stroke-width="3" fill="none"/></g></g>
      </svg>
      <div style="min-width:0"><div id="buzState" class="status">버튼을 눌러 패턴을 재생해 보세요.</div>
        <ul style="font-size:.88rem;margin-top:6px;padding-left:1.2em">${BUZ_NAMES.map(([k,key,name]) => `<li><b>${key} ${name}</b>: ${desc[k]} (총 ${sum(k)}ms)</li>`).join('')}</ul>
        <p class="muted" style="font-size:.82rem">노란 막대 = 켜짐(HIGH). 시간은 예제 코드와 같습니다. 화면 소리는 흉내일 뿐 실제 부저 음과 다릅니다.</p></div>
    </div>
  </div>`;
}
function initBuzzer(sec){
  const P = buzzerPatterns(), tl = sec.querySelector('#buzTl'), head = sec.querySelector('#buzHead');
  const icon = sec.querySelector('#buzIcon'), st = sec.querySelector('#buzState'), snd = sec.querySelector('#buzSound');
  const maxT = Math.max(...BUZ_NAMES.map(([k]) => P[k].reduce((a,b) => a + b, 0)));
  const sc = BUZ_TL.W / maxT;
  let run = null, ac = null, gain = null;
  function soundOn(v){
    if (!snd.checked){ if (gain) gain.gain.value = 0; return; }
    try {
      if (!ac){
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ac.createOscillator(); gain = ac.createGain();
        osc.type = 'square'; osc.frequency.value = 2300; gain.gain.value = 0;
        osc.connect(gain); gain.connect(ac.destination); osc.start();
      }
      if (ac.state === 'suspended') ac.resume();
      gain.gain.value = v ? 0.04 : 0;
    } catch(e){ snd.checked = false; }
  }
  function setOn(v){ icon.classList.toggle('buz-on', v); soundOn(v); }
  function stop(){
    run = null; setOn(false); head.setAttribute('opacity', '0');
    tl.querySelectorAll('.buz-row').forEach(r => r.classList.remove('play'));
  }
  function frame(now){
    if (!run) return;
    const t = now - run.start, pat = P[run.k];
    let acc = 0, idx = -1;
    for (let i = 0; i < pat.length; i++){ if (t < acc + pat[i]){ idx = i; break; } acc += pat[i]; }
    if (idx < 0){ const n = run.name; stop(); st.innerHTML = `<b>${n}</b> 끝 → 부저 꺼짐`; return; }
    const on = idx % 2 === 0; setOn(on);
    head.setAttribute('x1', BUZ_TL.X0 + t * sc); head.setAttribute('x2', BUZ_TL.X0 + t * sc);
    st.innerHTML = `<b>${run.name}</b> 재생 중 · ${Math.floor(t)}ms · 부저 <b style="color:${on ? 'var(--yellow)' : 'var(--muted)'}">${on ? 'ON' : 'OFF'}</b>`;
    requestAnimationFrame(frame);
  }
  sec.querySelectorAll('[data-buz]').forEach(b => b.onclick = () => {
    const k = b.dataset.buz, name = BUZ_NAMES.find(x => x[0] === k)[2];
    tl.querySelectorAll('.buz-row').forEach(r => r.classList.toggle('play', r.dataset.row === k));
    head.setAttribute('opacity', '1');
    const was = run; run = { k, name, start: performance.now() };
    if (!was) requestAnimationFrame(frame);
  });
  snd.addEventListener('change', () => { if (!snd.checked && gain) gain.gain.value = 0; });
}

/* 5-6. M4 초음파: 물체 드래그 → 왕복 애니메이션 + Trig/Echo 펄스 + 거리 = 시간 ÷ 58
   타임아웃 30000µs는 예제 m4_ultra의 pulseIn 값과 같다. */
const US = { X0:90, X1:480, DMIN:2, DMAX:100, NONE:505, TIMEOUT:30000 };
function ultraPrincipleHTML(){
  let ticks = '';
  for (let d = 10; d <= US.DMAX; d += 10){
    const x = US.X0 + (d - US.DMIN) / (US.DMAX - US.DMIN) * (US.X1 - US.X0);
    ticks += `<line x1="${x}" x2="${x}" y1="150" y2="158" stroke="#7a7f99"/><text x="${x}" y="172" fill="#7a7f99" font-size="11" text-anchor="middle">${d}</text>`;
  }
  return `<div class="ia">
    <div>
      <svg viewBox="0 0 560 180" id="usSvg" class="dragable" role="img" aria-label="초음파 거리 측정">
        <rect x="${US.NONE}" y="10" width="50" height="135" rx="6" fill="rgba(247,79,79,.08)" stroke="#f74f4f" stroke-dasharray="4 4"/>
        <text x="${US.NONE + 25}" y="70" fill="#f74f4f" font-size="11" text-anchor="middle">여기로</text><text x="${US.NONE + 25}" y="85" fill="#f74f4f" font-size="11" text-anchor="middle">치우면</text><text x="${US.NONE + 25}" y="100" fill="#f74f4f" font-size="11" text-anchor="middle">물체 없음</text>
        <rect x="14" y="50" width="52" height="60" rx="6" fill="#1a3a6e" stroke="#4f8ef7"/>
        <circle cx="52" cy="66" r="11" fill="#0b0d13" stroke="#c0c4d6" stroke-width="2"/><circle cx="52" cy="94" r="11" fill="#0b0d13" stroke="#c0c4d6" stroke-width="2"/>
        <text x="28" y="70" fill="#e8eaf6" font-size="11" text-anchor="middle">T</text><text x="28" y="98" fill="#e8eaf6" font-size="11" text-anchor="middle">R</text>
        <line x1="${US.X0}" x2="${US.X1}" y1="150" y2="150" stroke="#7a7f99"/>${ticks}<text x="${US.X1 + 8}" y="172" fill="#7a7f99" font-size="11">cm</text>
        <circle id="usPing" r="7" fill="none" stroke="#4fd1e0" stroke-width="3" cx="66" cy="66"/>
        <g id="usObj"><rect y="30" width="26" height="110" rx="4" fill="#f7a64f"/><text y="24" fill="#f7a64f" font-size="12" text-anchor="middle" id="usObjLbl"></text></g>
      </svg>
      <svg viewBox="0 0 560 140" id="usGraph" role="img" aria-label="Trig와 Echo 펄스" style="margin-top:8px">
        <defs><marker id="usArr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#f7a64f"/></marker></defs>
        <text x="8" y="44" fill="#e8eaf6" font-size="13">Trig</text><text x="8" y="114" fill="#e8eaf6" font-size="13">Echo</text>
        <path d="M60,50 L66,50 L66,26 L74,26 L74,50 L550,50" stroke="#4fd1e0" stroke-width="2.5" fill="none"/>
        <text x="80" y="22" fill="#4fd1e0" font-size="11">10µs 펄스 (보이게 넓게 그림)</text>
        <path d="M80,62 l3,-5 l3,10 l3,-10 l3,10 l3,-10 l3,10 l3,-10 l3,10 l3,-5" stroke="#b48cf7" stroke-width="1.5" fill="none"/>
        <text x="112" y="66" fill="#b48cf7" font-size="10">40kHz × 8회 발사</text>
        <path id="usEcho" d="" stroke="#f7a64f" stroke-width="2.5" fill="none"/>
        <text id="usEchoLbl" y="84" fill="#f7a64f" font-size="12" text-anchor="middle"></text>
        <line id="usEchoArrow" y1="90" y2="90" stroke="#f7a64f" stroke-width="1" marker-end="url(#usArr)"/>
        <text x="548" y="134" fill="#7a7f99" font-size="10" text-anchor="end">가로축: 0 ~ 6000µs</text>
      </svg>
      <div class="status" id="usEq"></div>
    </div>
    <div class="explain"><ul>
      <li><b>Trig</b>에 10µs(마이크로초, 100만분의 1초) 펄스를 주면 센서가 40kHz 초음파를 8번 쏩니다.</li>
      <li><b>Echo</b> 핀은 소리가 물체에 맞고 <b>돌아올 때까지</b> HIGH가 됩니다. 그 길이를 <code>pulseIn()</code>으로 잽니다.</li>
      <li><b>거리(cm) = 시간(µs) ÷ 58</b>. 소리는 1초에 340m → 1cm 가는 데 약 29µs, 갔다 와야 하니 ×2 = 58.</li>
      <li>소리가 안 돌아오면 HC-SR04는 약 <b>38ms</b> 뒤에 스스로 Echo를 끝냅니다. 예제 코드는 그보다 먼저 <code>pulseIn</code> <b>타임아웃</b> ${US.TIMEOUT}µs(=${US.TIMEOUT / 1000}ms)로 끊고 "감지 없음"으로 처리합니다.</li>
      <li>위 그림의 주황 물체를 <b>끌어서</b> 거리를 바꿔 보세요.</li>
    </ul></div>
  </div>`;
}
function initUltra(sec){
  const svg = sec.querySelector('#usSvg'), obj = sec.querySelector('#usObj'), lbl = sec.querySelector('#usObjLbl');
  const ping = sec.querySelector('#usPing'), echo = sec.querySelector('#usEcho'), elbl = sec.querySelector('#usEchoLbl');
  const arrow = sec.querySelector('#usEchoArrow'), eq = sec.querySelector('#usEq');
  const BUZ = pin('buzzer','신호');
  let x = US.X0 + (30 - US.DMIN) / (US.DMAX - US.DMIN) * (US.X1 - US.X0), d = 30;
  const t0 = performance.now();
  function update(){
    const none = x > US.X1 + 10;
    d = none ? null : Math.round(US.DMIN + (Math.min(x, US.X1) - US.X0) / (US.X1 - US.X0) * (US.DMAX - US.DMIN));
    const ox = none ? US.NONE + 12 : Math.min(x, US.X1);
    obj.querySelector('rect').setAttribute('x', ox); lbl.setAttribute('x', ox + 13);
    obj.style.opacity = none ? .35 : 1;
    lbl.textContent = none ? '' : d + 'cm';
    const EX = 96, sc = 440 / 6000;   // 그래프 가로축 0~6000µs
    if (none){
      echo.setAttribute('d', `M60,120 L${EX},120 L${EX},96 L548,96`);
      elbl.setAttribute('x', 330); elbl.textContent = `${US.TIMEOUT}µs까지 안 끝남 → 코드가 먼저 끊음(타임아웃)`;
      arrow.setAttribute('x1', EX); arrow.setAttribute('x2', 548);
      eq.innerHTML = `<span style="color:var(--red);font-weight:700">감지 없음</span> · <code>pulseIn(Echo, HIGH, ${US.TIMEOUT})</code>은 ${US.TIMEOUT}µs(=${US.TIMEOUT / 1000}ms) 안에 Echo가 끝나지 않으면 <b>0</b>을 돌려줍니다 → "감지 없음" 출력. 센서 자체는 약 38ms 뒤에 Echo를 끝내지만, 코드가 ${US.TIMEOUT / 1000}ms에서 먼저 끊습니다. 타임아웃을 안 쓰면 <code>pulseIn</code> 기본값은 1초라서, 센서가 빠졌거나 신호가 오지 않으면 최대 1초 동안 <code>loop()</code>가 멈출 수 있습니다.`;
    } else {
      const us = d * 58, w = us * sc;
      echo.setAttribute('d', `M60,120 L${EX},120 L${EX},96 L${EX + w},96 L${EX + w},120 L548,120`);
      elbl.setAttribute('x', EX + Math.max(w, 120) / 2); elbl.textContent = `${us}µs`;
      arrow.setAttribute('x1', EX); arrow.setAttribute('x2', EX + Math.max(w - 2, 4));
      eq.innerHTML = `Echo HIGH 시간 = <b>${us}µs</b> → 거리 = ${us} ÷ 58 = <b style="color:var(--green)">${Math.floor(us / 58)}cm</b>` +
        (d <= 20 ? ` · <span style="color:var(--yellow)">20cm 이하 → 부저(${BUZ}) ON</span>` : '');
    }
  }
  function frame(now){
    const none = d === null, far = none ? 548 : Math.min(x, US.X1);
    const period = none ? 1400 : 500 + (far - 66) * 4;
    const ph = ((now - t0) % period) / period;
    let px, py, op = 1;
    if (none){ px = 66 + ph * (548 - 66); py = 66; op = 1 - ph; }
    else if (ph < .5){ px = 66 + (ph / .5) * (far - 66); py = 66; }
    else { px = far - ((ph - .5) / .5) * (far - 66); py = 94; }
    ping.setAttribute('cx', px); ping.setAttribute('cy', py); ping.setAttribute('opacity', op);
    requestAnimationFrame(frame);
  }
  dragOn(svg, p => { x = Math.max(US.X0, Math.min(548, p.x - 13)); update(); });
  update(); requestAnimationFrame(frame);
}

/* 5-7. M5 IR 라인센서: 센서 이동 → 반사광 · 비교기 기준선 · DO · 판정 (수치는 그림용 상대값) */
const LN = { tapes:[[190,280],[400,425]], FL:20, FR:540, FY:176 };
function linePrincipleHTML(){
  const floor = `<rect x="${LN.FL}" y="${LN.FY}" width="${LN.FR - LN.FL}" height="22" fill="#e8e8e8"/>` +
    LN.tapes.map(([a,b]) => `<rect x="${a}" y="${LN.FY}" width="${b - a}" height="22" fill="#111" stroke="#555"/>`).join('');
  return `<div class="ia">
    <div>
      <svg viewBox="0 0 560 215" id="lnSvg" class="dragable" role="img" aria-label="라인센서 시뮬레이션">
        ${floor}<text x="${LN.FL}" y="${LN.FY + 34}" fill="#7a7f99" font-size="11">흰 바닥</text>
        <text x="235" y="${LN.FY + 34}" fill="#7a7f99" font-size="11" text-anchor="middle">검정 테이프</text>
        <polygon id="lnBeam" fill="rgba(247,79,79,.28)"/>
        <polygon id="lnBack" fill="rgba(79,209,224,.7)"/>
        <g id="lnSensor"><rect width="44" height="26" rx="4" fill="#1a3a6e" stroke="#4f8ef7"/>
          <circle cx="12" cy="22" r="5" fill="#f74f4f"/><circle cx="32" cy="22" r="5" fill="#4fd1e0"/>
          <text x="22" y="-6" fill="#e8eaf6" font-size="11" text-anchor="middle">센서</text></g>
        <text x="550" y="16" fill="#7a7f99" font-size="11" text-anchor="end">빨강 = IR LED · 하늘 = 포토트랜지스터</text>
      </svg>
      <div class="row"><button class="btn" id="lnAuto">자동으로 지나가기</button><span class="muted" style="font-size:.85rem">또는 센서를 끌어서 움직이세요</span></div>
      <div class="row"><label for="lnH" style="white-space:nowrap;min-width:7.5em">높이</label><input type="range" id="lnH" min="1" max="10" value="2" style="flex:1"><span id="lnHv" class="muted" style="min-width:6em"></span></div>
      <div class="row"><label for="lnTh" style="white-space:nowrap;min-width:7.5em">감도(가변저항)</label><input type="range" id="lnTh" min="10" max="90" value="50" style="flex:1"><span id="lnThv" class="muted" style="min-width:6em"></span></div>
      <div class="row"><span style="min-width:7.5em">코드 BLACK_IS</span><button class="btn small on" data-bi="1">1 (기본)</button><button class="btn small" data-bi="0">0 (반전)</button></div>
    </div>
    <div class="explain">
      <div style="display:flex;gap:14px;align-items:center">
        <svg viewBox="0 0 150 170" style="width:130px;flex:none" aria-label="반사광 막대">
          <rect x="30" y="10" width="50" height="140" fill="#0b0d13" stroke="#2a2d3e"/>
          <rect id="lnBar" x="30" width="50" fill="#4fd1e0"/>
          <line id="lnThLine" x1="22" x2="88" stroke="#f7a64f" stroke-width="2.5" stroke-dasharray="5 3"/>
          <text id="lnThTxt" x="92" fill="#f7a64f" font-size="12">기준</text>
          <text x="55" y="166" fill="#7a7f99" font-size="12" text-anchor="middle">반사광</text>
        </svg>
        <div><div style="font-size:2rem;font-family:Consolas,monospace;font-weight:800" id="lnDo">DO = 0</div>
          <div id="lnJudge" style="font-size:1.2rem;font-weight:700"></div></div>
      </div>
      <div class="status" id="lnSt"></div>
      <ul style="margin-top:8px">
        <li><b>IR LED</b>가 적외선(눈에 안 보이는 빛)을 쏘고, <b>포토트랜지스터</b>가 반사된 빛을 받습니다.</li>
        <li><b>흰색은 많이 반사</b>하고, <b>검정은 흡수</b>해서 반사광이 적습니다.</li>
        <li>모듈 안 <b>비교기</b>가 반사광을 기준값(가변저항으로 조절)과 비교해 <b>DO를 0 또는 1</b>로 냅니다 → <code>digitalRead</code>로 읽습니다.</li>
        <li>어느 쪽이 1인지는 모듈마다 다릅니다. 기본은 <b>1 = 검정</b>, 반대로 나오면 예제의 <code>BLACK_IS</code>를 0으로 바꿉니다.</li>
      </ul>
    </div>
  </div>`;
}
function initLine(sec){
  const svg = sec.querySelector('#lnSvg'), sensor = sec.querySelector('#lnSensor'), beam = sec.querySelector('#lnBeam'), back = sec.querySelector('#lnBack');
  const hS = sec.querySelector('#lnH'), thS = sec.querySelector('#lnTh'), bar = sec.querySelector('#lnBar');
  const thLine = sec.querySelector('#lnThLine'), thTxt = sec.querySelector('#lnThTxt');
  const doEl = sec.querySelector('#lnDo'), judge = sec.querySelector('#lnJudge'), st = sec.querySelector('#lnSt');
  const LINE = pin('line','DO');
  let sx = 120, blackIs = 1, auto = null, dir = 1;
  const blackFrac = (a, b) => LN.tapes.reduce((s,[ta,tb]) => s + Math.max(0, Math.min(b, tb) - Math.max(a, ta)), 0) / (b - a);
  function update(){
    const h = +hS.value, th = +thS.value;
    const sy = LN.FY - 34 - h * 12, hw = 5 + h * 3;
    sensor.setAttribute('transform', `translate(${sx - 22},${sy})`);
    const bf = blackFrac(sx - hw, sx + hw);
    const fall = h <= 3 ? 1 : Math.max(0, 1 - (h - 3) / 5);           // 높이 들수록 반사광이 덜 돌아온다
    const refl = Math.round(((1 - bf) * 90 + bf * 8) * fall);
    beam.setAttribute('points', `${sx - 14},${sy + 26} ${sx - 10},${sy + 26} ${sx + hw * .2},${LN.FY} ${sx - hw},${LN.FY}`);
    back.setAttribute('points', `${sx - hw * .2},${LN.FY} ${sx + hw},${LN.FY} ${sx + 14},${sy + 26} ${sx + 10},${sy + 26}`);
    back.setAttribute('opacity', (refl / 90).toFixed(2));
    bar.setAttribute('y', 150 - refl * 1.4); bar.setAttribute('height', refl * 1.4);
    const ty = 150 - th * 1.4; thLine.setAttribute('y1', ty); thLine.setAttribute('y2', ty); thTxt.setAttribute('y', ty + 4);
    const DO = refl < th ? 1 : 0;                                    // 반사 적음(검정·반사 없음) → 1 (스킬: TCRT5000 계열 기본)
    const isBlack = DO === blackIs, said = isBlack ? '검정' : '흰색';
    const truth = bf > .5 ? '검정' : '흰색';
    doEl.textContent = `DO = ${DO}`; doEl.style.color = DO ? 'var(--accent2)' : 'var(--cyan)';
    judge.innerHTML = `판정: ${isBlack ? '<span style="color:#fff;background:#000;padding:0 .4em;border:1px solid #555">검정</span>' : '<span style="color:#000;background:#eee;padding:0 .4em">흰색</span>'}`;
    let msg = `반사광 ${refl} ${refl < th ? '<' : '≥'} 기준 ${th} → DO=${DO} · <code>digitalRead(${LINE})</code>=${DO}, BLACK_IS=${blackIs} → "${said}"`;
    if (fall < .2) msg += `<br><span style="color:var(--yellow)">너무 높이 들어 반사광이 돌아오지 않습니다 → 바닥과 상관없이 DO가 늘 1(반사 없음 = 검정일 때와 같은 값)입니다.</span>`;
    else if (said !== truth) msg += `<br><span style="color:var(--red)">실제 바닥은 ${truth}인데 판정이 반대입니다 → 감도(가변저항)나 BLACK_IS를 확인하세요.</span>`;
    st.innerHTML = msg;
    sec.querySelector('#lnHv').textContent = h <= 3 ? '낮음(정상)' : h < 8 ? '조금 높음' : '너무 높음';
    sec.querySelector('#lnThv').textContent = '기준 ' + th;
  }
  dragOn(svg, p => { sx = Math.max(LN.FL + 22, Math.min(LN.FR - 22, p.x)); update(); });
  hS.addEventListener('input', update); thS.addEventListener('input', update);
  sec.querySelectorAll('[data-bi]').forEach(b => b.onclick = () => {
    blackIs = +b.dataset.bi; sec.querySelectorAll('[data-bi]').forEach(x => x.classList.toggle('on', x === b)); update();
  });
  const btn = sec.querySelector('#lnAuto');
  btn.onclick = () => {
    if (auto){ clearInterval(auto); auto = null; btn.classList.remove('on'); btn.textContent = '자동으로 지나가기'; return; }
    btn.classList.add('on'); btn.textContent = '멈추기';
    auto = setInterval(() => {
      sx += dir * 3;
      if (sx > LN.FR - 22 || sx < LN.FL + 22){ dir *= -1; sx = Math.max(LN.FL + 22, Math.min(LN.FR - 22, sx)); }
      update();
    }, 30);
  };
  update();
}

/* 5-8. M4 실측 비교 표 (자로 잰 거리 vs 모니터 값, localStorage 키 smarsLesson.m4.meas.<cm>) */
function measTableHTML(){
  return `<div class="box"><b>실측 비교</b> — 자로 거리를 맞추고 시리얼 모니터 값을 적어 보세요.
    <table class="meas"><tr><th>자로 잰 거리</th><th>모니터 값(cm)</th><th>차이</th></tr>
    ${[10,20,30].map(r => `<tr><td>${r}cm</td><td><input type="number" class="meas-in" data-meas="${r}" value="${esc(store.get('smarsLesson.m4.meas.' + r) || '')}"></td><td data-diff="${r}"></td></tr>`).join('')}
    </table></div>`;
}
function updateMeas(){
  document.querySelectorAll('[data-meas]').forEach(i => {
    const r = +i.dataset.meas, td = document.querySelector(`[data-diff="${r}"]`);
    if (!td) return;
    const v = i.value.trim();
    td.textContent = v === '' ? '' : ((+v - r > 0 ? '+' : '') + (+v - r) + 'cm');
  });
}

/* 5-9. M6 블루투스: 페어링 → 가상 COM → UART 교차 연결 흐름도 */
function btFlowSVG(){
  const tx = pin('bt','TXD→'), rx = pin('bt','RXD←');            // A1(아두이노 RX), A0(아두이노 TX)
  return `<svg viewBox="0 0 560 230" id="btFlow" role="img" aria-label="블루투스 연결 흐름">
    <defs><marker id="btArr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#4fd1e0"/></marker>
      <marker id="btArr2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#f7a64f"/></marker></defs>
    <g class="bt-step" data-step="pair">
      <rect x="10" y="20" width="120" height="60" rx="8" fill="#141722" stroke="#4f8ef7" stroke-width="2"/>
      <text x="70" y="46" fill="#e8eaf6" font-size="14" text-anchor="middle" font-weight="700">PC / 폰</text>
      <text x="70" y="66" fill="#7a7f99" font-size="11" text-anchor="middle">블루투스 켜기</text>
      <path d="M335,50 q8,-12 0,-24 M347,56 q14,-18 0,-36 M359,62 q20,-24 0,-48" stroke="#b48cf7" stroke-width="2.5" fill="none" transform="translate(0,12)"/>
      <text x="360" y="100" fill="#b48cf7" font-size="11" text-anchor="middle">무선(SPP)</text>
    </g>
    <g class="bt-step" data-step="com">
      <rect x="160" y="20" width="160" height="60" rx="8" fill="#141722" stroke="#4fcf83" stroke-width="2" stroke-dasharray="6 4"/>
      <text x="240" y="46" fill="#4fcf83" font-size="14" text-anchor="middle" font-weight="700">블루투스 COM 포트</text>
      <text x="240" y="66" fill="#7a7f99" font-size="11" text-anchor="middle">(가상 시리얼 포트)</text>
      <line x1="130" y1="50" x2="158" y2="50" stroke="#7a7f99" stroke-width="2"/>
    </g>
    <rect x="400" y="20" width="150" height="200" rx="8" fill="#141722" stroke="#6f8cff" stroke-width="2"/>
    <text x="475" y="46" fill="#6f8cff" font-size="15" text-anchor="middle" font-weight="700">HC-05</text>
    <text x="475" y="66" fill="#7a7f99" font-size="11" text-anchor="middle">${PINMAP.bt.baud}bps</text>
    <rect x="10" y="120" width="160" height="100" rx="8" fill="#101a2e" stroke="#4f8ef7" stroke-width="2"/>
    <text x="20" y="140" fill="#4f8ef7" font-size="13" font-weight="700">Arduino UNO</text>
    <g class="bt-step" data-step="uart">
      <text x="410" y="155" fill="#e8eaf6" font-size="13">TXD (보냄)</text><circle cx="400" cy="150" r="5" fill="#4fd1e0"/>
      <text x="410" y="195" fill="#e8eaf6" font-size="13">RXD (받음)</text><circle cx="400" cy="190" r="5" fill="#f7a64f"/>
      <text x="160" y="155" fill="#e8eaf6" font-size="13" text-anchor="end">${esc(rx)} (TX, 보냄)</text><circle cx="170" cy="150" r="5" fill="#f7a64f"/>
      <text x="160" y="195" fill="#e8eaf6" font-size="13" text-anchor="end">${esc(tx)} (RX, 받음)</text><circle cx="170" cy="190" r="5" fill="#4fd1e0"/>
      <path d="M395,150 C300,150 270,190 178,190" stroke="#4fd1e0" stroke-width="3" fill="none" marker-end="url(#btArr)"/>
      <path d="M175,150 C270,150 300,190 392,190" stroke="#f7a64f" stroke-width="3" fill="none" marker-end="url(#btArr2)"/>
      <text x="285" y="140" fill="#7a7f99" font-size="11" text-anchor="middle">교차 연결: 보내는 쪽 → 받는 쪽</text>
      <text x="285" y="218" fill="#f74f4f" font-size="11" text-anchor="middle">RXD에는 분압(5V→3.3V) 권장</text>
    </g>
  </svg>`;
}
const BT_STEPS = () => ({
  pair: `<b>1 페어링</b>: PC(또는 폰)의 블루투스 설정에서 로봇 이름(예: SMARS-01)을 찾아 연결합니다. 기본 PIN은 <b>1234</b> 또는 <b>0000</b>. 다른 팀 로봇과 헷갈리지 않게 이름을 꼭 확인하세요.`,
  com: `<b>2 가상 COM 포트</b>: 페어링하면 PC에 "블루투스 COM 포트"가 생깁니다. 프로그램 입장에서는 USB 시리얼과 똑같이 보여서 Web Serial(아래 미니 모니터)로 <b>${PINMAP.bt.baud}bps</b>로 열면 됩니다. HC-05는 <b>무선 시리얼 케이블</b>인 셈입니다.`,
  uart: `<b>3 UART 교차 연결</b>: 한쪽의 TX(보냄)는 상대의 RX(받음)에 꽂습니다. HC-05 TXD → <b>${pin('bt','TXD→')}</b>(아두이노 RX), HC-05 RXD ← <b>${pin('bt','RXD←')}</b>(아두이노 TX). D0/D1은 USB가 쓰므로 <code>SoftwareSerial</code>로 다른 핀을 시리얼처럼 씁니다.`,
});
function initBtFlow(sec){
  const svg = sec.querySelector('#btFlow'), info = sec.querySelector('#btFlowInfo');
  const show = k => {
    svg.querySelectorAll('.bt-step').forEach(g => g.classList.toggle('dim', g.dataset.step !== k));
    sec.querySelectorAll('[data-btstep]').forEach(b => b.classList.toggle('on', b.dataset.btstep === k));
    info.innerHTML = BT_STEPS()[k];
  };
  sec.querySelectorAll('[data-btstep]').forEach(b => b.onclick = () => show(b.dataset.btstep));
  show('pair');
}

/* 5-10. M6 UART 비트 애니메이션: 시작 비트(0) + 8비트(LSB 먼저) + 정지 비트(1) */
const UART = { X0:40, CW:40, HI:40, LO:90 };
function uartSVG(){
  return `<svg viewBox="0 0 560 150" id="uartSvg" role="img" aria-label="UART 비트 전송">
    <defs><clipPath id="uartClip"><rect id="uartClipR" x="0" y="0" width="0" height="150"/></clipPath></defs>
    <text x="4" y="${UART.HI + 4}" fill="#7a7f99" font-size="11">1</text><text x="4" y="${UART.LO + 4}" fill="#7a7f99" font-size="11">0</text>
    <g id="uartCells"></g>
    <path id="uartWaveBg" stroke="#2a2d3e" stroke-width="3" fill="none"/>
    <path id="uartWave" stroke="#4fd1e0" stroke-width="3" fill="none" clip-path="url(#uartClip)"/>
    <rect id="uartCur" y="22" width="${UART.CW}" height="86" fill="rgba(247,217,79,.15)" stroke="#f7d94f" opacity="0"/>
  </svg>`;
}
function initUart(sec){
  const inp = sec.querySelector('#uartChar'), btn = sec.querySelector('#uartGo'), info = sec.querySelector('#uartInfo');
  const cells = sec.querySelector('#uartCells'), wave = sec.querySelector('#uartWave'), bg = sec.querySelector('#uartWaveBg');
  const clip = sec.querySelector('#uartClipR'), cur = sec.querySelector('#uartCur');
  let frame = [], timer = null;
  function build(){
    const ch = inp.value.slice(0, 1) || 'F', code = ch.charCodeAt(0);
    if (code > 127){ info.innerHTML = '<span style="color:var(--red)">영문·숫자·기호 1글자만 넣어 주세요.</span>'; return false; }
    const bits = []; for (let i = 0; i < 8; i++) bits.push((code >> i) & 1);   // LSB 먼저
    frame = [{ l:'대기', v:1 }, { l:'시작', v:0 }].concat(bits.map((v, i) => ({ l:'D' + i, v })), [{ l:'정지', v:1 }, { l:'대기', v:1 }]);
    const X = UART.X0, W = UART.CW;
    cells.innerHTML = frame.map((f, i) => {
      const c = f.l === '시작' ? '#f74f4f' : f.l === '정지' ? '#4fcf83' : f.l === '대기' ? '#7a7f99' : '#e8eaf6';
      return `<rect x="${X + i * W}" y="22" width="${W}" height="86" fill="none" stroke="#2a2d3e"/>
        <text x="${X + i * W + W / 2}" y="122" fill="${c}" font-size="11" text-anchor="middle">${f.l}</text>
        <text x="${X + i * W + W / 2}" y="142" fill="${c}" font-size="14" font-weight="700" text-anchor="middle" font-family="Consolas,monospace">${f.v}</text>`;
    }).join('');
    let d = '', y0 = null;
    frame.forEach((f, i) => { const y = f.v ? UART.HI : UART.LO; d += (i === 0 ? `M${X},${y}` : (y !== y0 ? ` L${X + i * W},${y}` : '')) + ` L${X + (i + 1) * W},${y}`; y0 = y; });
    wave.setAttribute('d', d); bg.setAttribute('d', d);
    const bin = code.toString(2).padStart(8, '0');
    info.innerHTML = `<b>'${esc(ch)}'</b> = 0x${code.toString(16).toUpperCase().padStart(2, '0')} = ${bin.slice(0,4)} ${bin.slice(4)} (2진수). 보낼 때는 <b>가장 낮은 자리(LSB)부터</b>: ${bits.join(' ')}<br>
      시작 비트 1 + 데이터 8 + 정지 비트 1 = <b>10비트</b>. ${PINMAP.bt.baud}bps면 비트 하나에 약 ${Math.round(1e6 / PINMAP.bt.baud)}µs, 글자 하나에 약 ${(10e3 / PINMAP.bt.baud).toFixed(2)}ms.`;
    return true;
  }
  function play(){
    if (timer){ clearInterval(timer); timer = null; }
    if (!build()) return;
    let i = 0; cur.setAttribute('opacity', '1');
    const step = () => {
      cur.setAttribute('x', UART.X0 + i * UART.CW);
      clip.setAttribute('width', UART.X0 + (i + 1) * UART.CW);
      i++;
      if (i >= frame.length){ clearInterval(timer); timer = null; setTimeout(() => cur.setAttribute('opacity', '0'), 400); }
    };
    clip.setAttribute('width', UART.X0); step(); timer = setInterval(step, 380);
  }
  btn.onclick = play;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') play(); });
  build(); clip.setAttribute('width', 560);
}
function btPrincipleHTML(){
  return `<div class="ia">
    <div>${btFlowSVG()}
      <div class="row"><button class="btn" data-btstep="pair">1 페어링</button><button class="btn" data-btstep="com">2 가상 COM</button><button class="btn" data-btstep="uart">3 UART 교차 연결</button></div>
      <div class="status" id="btFlowInfo"></div>
    </div>
    <div class="explain"><ul>
      <li><b>HC-05</b>는 클래식 블루투스 SPP로 동작하는 <b>무선 시리얼 케이블</b>입니다.</li>
      <li><b>UART</b>(시리얼 통신)는 TX(보냄) → RX(받음)로 <b>교차</b> 연결합니다.</li>
      <li>D0/D1은 USB가 쓰므로 <code>SoftwareSerial</code>로 ${pin('bt','TXD→')}/${pin('bt','RXD←')}를 씁니다.</li>
      <li>페어링하면 PC에 <b>블루투스 COM 포트</b>가 생기고, 그것을 시리얼처럼 엽니다.</li>
    </ul>
    <div class="warn"><b>Web Bluetooth로는 못 붙습니다.</b> Web Bluetooth는 BLE만 지원해서 클래식 블루투스인 HC-05에 바로 연결할 수 없습니다. 그래서 웹에서는 <b>블루투스 COM 포트를 Web Serial로</b> 엽니다.</div></div>
  </div>
  <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
  <div class="ia">
    <div>${uartSVG()}
      <div class="row"><label for="uartChar">보낼 글자</label><input id="uartChar" class="txt" maxlength="1" value="F" style="width:3em;text-align:center">
        <button class="btn" id="uartGo">보내기 애니메이션</button></div>
    </div>
    <div class="explain"><p>문자 하나는 이렇게 한 비트씩 줄지어 나갑니다.</p>
      <ul><li><b style="color:var(--red)">시작 비트</b>(0): "이제 보낸다" 신호</li><li><b>데이터 8비트</b>: 가장 낮은 자리부터</li><li><b style="color:var(--green)">정지 비트</b>(1): "한 글자 끝"</li></ul>
      <div class="status" id="uartInfo"></div></div>
  </div>`;
}
function initBt(sec){ initBtFlow(sec); initUart(sec); }

/* 3. 카드 내용: LESSON.m1~m6 */
const LED_PIN = pin('led','+(저항 거쳐)');
Object.assign(LESSON, {
  /* ---------------- M1 아두이노·브레드보드 ---------------- */
  m1: {
    goal: `아두이노 보드의 핀·전원·시리얼 구조, 브레드보드에 부품 꽂는 법, IDE·드라이버·보레이트 설정을 알고, AI에게 ${LED_PIN} LED 깜빡이기 코드를 요청해 검증한다.`,
    topWarn: `<b>모터 전원은 빼고 진행:</b> LED 핀(${LED_PIN})은 오른쪽 모터 DIR(${pin('motorR','DIR')})과 <b>같은 핀</b>입니다. 쉴드에 모터 배터리를 연결하지 않은 채(또는 바퀴를 띄운 채) 실습합니다.`,
    principle: { html: () => m1PrincipleHTML(), init: initM1 },
    wiring: { keys:['led'], resistor:'220Ω',
      notes: `<div class="box">LED <b>긴 다리(+)</b> → 220Ω 저항 → <b>${LED_PIN}</b>, LED <b>짧은 다리(−)</b> → <b>${pin('led','−')}</b>. 저항은 LED에 너무 큰 전류가 흐르지 않게 막아 줍니다.</div>` },
    prompt: {
      parts: 'LED 1개 + 220Ω 저항(브레드보드)',
      pinKeys: ['led'],
      actions: [`${LED_PIN} LED를 0.5초씩 깜빡인다`, '켜질 때 ON, 꺼질 때 OFF를 시리얼에 출력한다'],
      mistakes: [`보율을 9600으로 마음대로 정한다 → 모니터(${PINMAP.usb.baud})에서 글자가 깨진다. 코드의 <code>Serial.begin</code> 숫자를 꼭 확인하세요.`],
      codeChecks: [`LED 핀이 <code>${LED_PIN}</code>인가 (숫자로는 ${LED_PIN.slice(1)})`],
      delayNote: '<br><span class="muted">— <b>M1만 예외:</b> 깜빡이기(blink)는 <code>delay(500)</code>을 써도 됩니다. 검증된 예제도 <code>delay()</code>를 씁니다. M2부터는 <code>millis()</code>로 바꿉니다.</span>',
      teacherTip: `[제약]에서 "시리얼 ${PINMAP.usb.baud}bps"를 빼고 한 번 요청해 보세요. AI가 9600을 쓰는 경우가 자주 있습니다. 모니터를 ${PINMAP.usb.baud}에 둔 채 깨진 글자를 보여 주고, 왜 제약을 적어야 하는지 이야기합니다.`,
    },
    example: { file:'examples/m1_blink/m1_blink.ino' },
    checklist: [
      '쉴드에서 모터 배터리를 뺐다 (또는 바퀴를 띄웠다)',
      '장치 관리자 “포트(COM &amp; LPT)”에 USB-SERIAL CH340이 보인다 (노란 느낌표면 CH340 드라이버 설치) — COM 번호를 적었다',
      'Arduino IDE에서 툴 › 보드 › Arduino Uno, 툴 › 포트 › 적어 둔 COM 번호를 골랐다',
      `LED 긴 다리(+) → 220Ω → ${LED_PIN}, 짧은 다리(−) → ${pin('led','−')}로 꽂았다 (저항 두 다리는 서로 다른 5칸 묶음)`,
      '코드 검사표로 AI 코드(또는 예제)를 확인했다',
      '확인(✓) → 업로드(→)가 성공했다 (실패하면 아래 "문제 해결" 표)',
      'LED가 0.5초마다 깜빡인다',
      `시리얼 모니터 오른쪽 아래 보레이트를 ${PINMAP.usb.baud}으로 맞추고, ON / OFF가 번갈아 보인다`,
    ],
    quiz: [
      { q:'저항을 빼고 LED를 바로 꽂으면 어떻게 될까?', a:'너무 큰 전류(과전류)가 흘러 LED와 아두이노 핀이 손상될 수 있다.' },
      { q:'시리얼 모니터의 보레이트를 코드와 다르게 맞추면 무엇이 보일까?', a:`알아볼 수 없는 깨진 글자가 보인다. 코드의 Serial.begin(${PINMAP.usb.baud}) 값과 모니터 보레이트를 같게 맞춘다.` },
      { q:'USB로 업로드하는 동안 D0/D1에 블루투스 모듈을 꽂아 두면?', a:`USB 시리얼도 같은 D0/D1(하드웨어 UART)을 쓰므로 충돌해 업로드가 실패하거나 글자가 섞인다. 그래서 SMARS는 블루투스를 SoftwareSerial(${pin('bt','TXD→')}/${pin('bt','RXD←')})로 따로 연결한다.` },
      { q:'저항의 두 다리를 같은 5칸 묶음에 꽂으면?', a:'두 다리가 이미 연결된 상태라 저항이 회로에서 빠진 것과 같다(합선). 저항은 서로 다른 묶음에 꽂는다.' },
      { q:'장치 관리자에 노란 느낌표(기타 장치)가 뜨면?', a:'호환 보드의 USB-시리얼 칩(CH340) 드라이버가 없다는 뜻이다. CH340 드라이버를 설치하면 “포트(COM &amp; LPT)”에 USB-SERIAL CH340 (COMx)로 보인다.' },
    ],
  },

  /* ---------------- M2 DC모터·H-bridge·PWM ---------------- */
  m2: {
    goal: 'H-bridge와 PWM으로 모터의 방향과 속도를 바꾸는 원리를 설명하고, 시리얼 문자로 바퀴를 돌린다.',
    topWarn: `<b>바퀴를 띄운 채 진행합니다.</b> 로봇을 받침 위에 올려 바퀴가 바닥에 닿지 않게 하세요. 배선을 바꿀 때는 USB와 배터리를 모두 뺍니다.`,
    principle: {
      html: `<div class="ia">
        <div>${hbridgeSVG()}
          <div class="row"><button class="btn" data-hb="14">정방향 (S1+S4)</button><button class="btn" data-hb="23">역방향 (S2+S3)</button><button class="btn" data-hb="">모두 끄기</button><button class="btn" data-hb="34" style="border-color:#f7a64f">브레이크 (S3+S4)</button></div>
          <div class="status" id="hbStatus"></div>
          <div class="warn hb-short" id="hbShort"><b>단락(shoot-through) 경고!</b> 같은 쪽 위·아래 스위치를 함께 켜면 전원이 GND에 바로 연결됩니다. 큰 전류가 흘러 드라이버가 망가질 수 있습니다.</div>
        </div>
        <div class="explain"><ul>
          <li><b>DC모터</b>는 전류 방향이 바뀌면 도는 방향이 바뀝니다.</li>
          <li>아두이노 핀은 <b>수십 mA</b>밖에 못 내서 모터를 직접 못 돌립니다 → <b>모터 드라이버</b>(L298P)가 필요합니다.</li>
          <li><b>H-bridge</b>: 스위치 4개(S1~S4). <b>대각선 한 쌍</b>을 켜면 정방향, 다른 쌍은 역방향. 같은 쪽 두 개를 함께 켜면 <b>단락</b>.</li>
          <li><b>멈추는 방법 2가지</b>: <b>모두 끄기</b>(자유 정지, coast)는 전류 길만 끊어 관성으로 <b>천천히</b> 멈춥니다. <b style="color:#f7a64f">브레이크</b>(brake)는 아래 두 스위치(S3+S4, 또는 위 두 개 S1+S2)를 켜 모터 두 단자를 서로 이어 줍니다. 돌던 모터가 만드는 전기(역기전력)가 회전을 막아 <b>빨리</b> 멈춥니다. 같은 쪽 위·아래(S1+S3)를 켜는 <b>단락</b>과 헷갈리지 마세요.</li>
          <li>L298P는 이 4개 스위치를 <b>DIR 핀 하나</b>(HIGH/LOW)로 단순하게 고를 수 있게 해 줍니다. DIR 한 핀은 늘 한쪽 대각선을 고르므로 이 쉴드에서는 브레이크를 만들 수 없고, 속도(PWM)를 0으로 하면 <b>자유 정지</b>가 됩니다.</li>
          <li>왼쪽 그림의 스위치를 눌러 켜고 꺼 보세요.</li>
        </ul></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
      <div class="ia">
        <div>
          <svg viewBox="0 0 420 120" role="img" aria-label="PWM 파형">
            <line x1="10" y1="20" x2="410" y2="20" stroke="#2a2d3e"/><line x1="10" y1="100" x2="410" y2="100" stroke="#2a2d3e"/>
            <text x="14" y="15" fill="#7a7f99" font-size="11">켜짐(HIGH)</text><text x="14" y="115" fill="#7a7f99" font-size="11">꺼짐(LOW)</text>
            <path id="pwmWave" d="" stroke="#4fd1e0" stroke-width="3" fill="none"/>
            <line id="pwmAvg" x1="10" x2="410" y1="60" y2="60" stroke="#f7a64f" stroke-width="2" stroke-dasharray="6 5"/>
            <text x="406" y="15" fill="#f7a64f" font-size="11" text-anchor="end">--- 평균</text>
          </svg>
          <div class="row" style="margin-top:10px"><label for="pwmSlider" style="white-space:nowrap">속도(%)</label><input type="range" id="pwmSlider" min="0" max="100" value="60"></div>
          <div class="status" id="pwmText"></div>
        </div>
        <div class="explain">
          <p><b>PWM</b>(펄스 폭 변조) = 켜짐/꺼짐을 아주 빠르게 반복해 <b>평균 전압</b>을 바꾸는 방법. 켜진 시간의 비율이 <b>듀티비</b>입니다.</p>
          <p><code>analogWrite(핀, 0~255)</code> → 듀티비 = 값 ÷ 255. 속도%는 <code>% × 255 ÷ 100</code>으로 바꿉니다.</p>
          <div style="display:flex;gap:12px;align-items:center;margin-top:8px">
            <svg viewBox="0 0 120 120" style="width:110px;flex:none" aria-label="바퀴">
              <g id="pwmWheel"><circle cx="60" cy="60" r="52" fill="#1a1d27" stroke="#e8eaf6" stroke-width="4"/>
                <circle cx="60" cy="60" r="8" fill="#e8eaf6"/>
                <line x1="60" y1="12" x2="60" y2="108" stroke="#4fd1e0" stroke-width="4"/><line x1="12" y1="60" x2="108" y2="60" stroke="#7a7f99" stroke-width="4"/>
                <circle cx="60" cy="16" r="5" fill="#f7a64f"/></g>
            </svg>
            <div id="pwmWheelSt" style="font-size:.95rem"></div>
          </div>
        </div>
      </div>`,
      init(sec){ initHbridge(sec); initPwm(sec); },
    },
    wiring: { keys:['motorL','motorR'],
      notes: `<div class="box"><b>코드 규칙</b> · 전진: BRAKE LOW + DIR HIGH + <code>analogWrite(PWM, 0~255)</code> · 후진: DIR LOW · 정지: PWM 0</div>
        <div class="warn"><b>${pin('ultra','Echo')}는 출력으로 쓰지 않습니다.</b> 오른쪽 모터 BRAKE 자리는 초음파 Echo와 겹쳐서 쓰지 않습니다. PWM은 <b>~</b> 표시 핀만 됩니다.</div>` },
    prompt: {
      parts: 'DC모터 2개(왼쪽=쉴드 B채널, 오른쪽=쉴드 A채널)',
      pinKeys: ['motorL','motorR'],
      actions: [
        '시리얼로 F/B/L/R/S 문자를 받아 구동한다 (전진/후진/제자리 좌회전/제자리 우회전/정지)',
        '문자 뒤에 숫자가 오면 속도(%)로 쓴다 (예: F50)',
        '정지는 PWM 0',
        `전진은 BRAKE LOW, DIR HIGH. 오른쪽 BRAKE(${pin('ultra','Echo')})는 쓰지 않는다`,
      ],
      mistakes: [`${pin('ultra','Echo')}을 BRAKE 출력으로 설정한다 (<code>pinMode(${pin('ultra','Echo').slice(1)}, OUTPUT)</code>) → 나중에 초음파가 고장 난 것처럼 보인다.`],
      codeChecks: [
        `<code>pinMode(${pin('ultra','Echo').slice(1)}, OUTPUT)</code>이 없는가`,
        `PWM 핀이 ${pin('motorL','PWM')}·${pin('motorR','PWM')}이고 값이 0~255 범위인가`,
      ],
      teacherTip: `[핀] 칸에서 "BRAKE=미사용(…)" 부분을 지우고 요청해 보세요. AI가 ${pin('ultra','Echo')}을 BRAKE 출력으로 쓰는 코드를 낼 수 있습니다. 학생이 코드 검사표로 찾아내게 합니다.`,
    },
    example: { file:'examples/m2_motor/m2_motor.ino' },
    quick: ['F','B','L','R','S','F50'],
    checklist: [
      '바퀴를 바닥에서 띄웠다',
      '코드 검사표로 AI 코드(또는 예제)를 확인했다',
      `업로드 후 시리얼 모니터를 ${PINMAP.usb.baud}bps로 연결했다`,
      'F → 두 바퀴가 앞으로, B → 뒤로 돈다',
      'L·R → 두 바퀴가 서로 반대로 돌아 제자리 회전한다',
      'S → 멈춘다',
      'F20, F30 … 처럼 속도를 바꿔 보며 모터가 돌기 시작하는 %를 찾아 적었다 (deadband)',
      '좌우 바퀴 한쪽이 반대로 돌면 코드에서 그쪽 방향을 반전했다',
    ],
    quiz: [
      { q:'S1과 S3를 동시에 켜면 무슨 일이 생길까?', a:'단락(shoot-through). 전류가 모터를 거치지 않고 전원에서 GND로 바로 흘러 드라이버가 손상될 수 있다.' },
      { q:'analogWrite(PWM, 128)이면 듀티비는 약 몇 %?', a:'128 ÷ 255 ≈ 50%. 평균 전압이 전원의 절반쯤 된다.' },
      { q:'모터를 아두이노 핀에 바로 연결하지 않는 이유는?', a:'아두이노 핀은 수십 mA밖에 못 낸다. 모터에는 더 큰 전류가 필요해서 모터 드라이버(L298P)를 거친다.' },
      { q:'속도 15%에서 모터가 "웅" 소리만 내고 안 돈다. 왜일까?', a:'PWM이 너무 낮아 평균 전압이 부족한 deadband 구간이다. 속도를 40% 이상으로 올리고, 그래도 약하면 배터리를 확인한다.' },
    ],
  },

  /* ---------------- M3 부저 ---------------- */
  m3: {
    goal: `능동형과 수동형 부저의 차이를 알고, tone() 없이 ${pin('buzzer','신호')} 부저로 삑·경보·SOS 패턴을 만든다.`,
    topWarn: `<b>tone() 금지!</b> <code>tone()</code>은 오른쪽 모터 PWM(${pin('motorR','PWM')})과 같은 타이머를 써서, 부저를 켜는 순간 오른쪽 모터가 이상해집니다. 이 로봇 부저는 능동형이라 <code>digitalWrite</code>로 켜고 끄기만 하면 됩니다.`,
    principle: { html: () => buzzerPrincipleHTML(), init: initBuzzer },
    wiring: { keys:['buzzer'],
      notes: `<div class="box">켜기: <code>digitalWrite(${pin('buzzer','신호').slice(1)}, HIGH)</code> · 끄기: <code>LOW</code>. 패턴은 켜고 끄는 <b>시간</b>을 <code>millis()</code>로 재서 만듭니다.</div>` },
    prompt: {
      parts: '능동형 부저 1개',
      pinKeys: ['buzzer'],
      actions: [
        '시리얼로 1을 받으면 삑(200ms)',
        '2를 받으면 경보(켜기/끄기 반복)',
        '3을 받으면 SOS(짧게 3번, 길게 3번, 짧게 3번)',
        '부저는 능동형이라 digitalWrite로 켜고 끄기만 한다',
      ],
      mistakes: [`<code>tone()</code>을 쓴다 → 부저를 켜면 오른쪽 모터(${pin('motorR','PWM')} PWM)가 이상해진다. 제약에 "tone() 사용 금지"를 꼭 넣고, 받은 코드에서 <code>tone</code>을 찾아보세요.`],
      codeChecks: [
        '<code>tone(</code> · <code>noTone(</code>이 한 줄도 없는가',
        `부저 핀이 <code>${pin('buzzer','신호')}</code>이고 <code>digitalWrite</code>로 켜고 끄는가`,
      ],
      teacherTip: '[제약]에서 "tone() 사용 금지"를 빼고 한 번 요청해 보세요. AI가 <code>tone()</code>을 쓸 가능성이 높습니다. 바이브코딩에서 "읽기" 단계가 왜 필요한지 보여 주는 좋은 사례입니다.',
    },
    example: { file:'examples/m3_buzzer/m3_buzzer.ino' },
    quick: ['1','2','3'],
    checklist: [
      '코드 검사표로 AI 코드(또는 예제)에 tone()이 없는 것을 확인했다',
      `업로드 후 시리얼 모니터를 ${PINMAP.usb.baud}bps로 연결했다`,
      '1 → 짧게 "삑" 한 번',
      '2 → 경보 5번 반복',
      '3 → SOS (짧게 3, 길게 3, 짧게 3)',
      '소리가 나는 중에 다른 숫자를 보내면 바로 바뀐다',
    ],
    quiz: [
      { q:'이 로봇의 부저로 "도레미" 음계를 연주할 수 있을까?', a:'아니다. 능동형이라 음높이가 정해져 있다. 음높이를 바꾸려면 주파수를 줘야 하는 수동형 부저가 필요하다.' },
      { q:'AI 코드가 tone()을 쓰면 무엇이 문제일까?', a:`tone()이 오른쪽 모터 PWM(${pin('motorR','PWM')})과 같은 타이머를 써서 오른쪽 모터가 제대로 돌지 않는다. digitalWrite로 바꾼다.` },
      { q:'패턴을 delay() 대신 millis()로 만들면 무엇이 좋을까?', a:'delay() 중에는 아무것도 못 한다. millis()로 시간을 재면 소리를 내는 중에도 새 시리얼 입력을 받아 바로 바꿀 수 있다.' },
    ],
  },

  /* ---------------- M4 초음파 ---------------- */
  m4: {
    goal: '초음파가 왕복하는 시간으로 거리를 재는 원리를 알고, 거리를 0.1초마다 출력하며 20cm 이하에서 부저로 경고한다.',
    principle: { html: () => ultraPrincipleHTML(), init: initUltra },
    wiring: { keys:['ultra','buzzer'],
      notes: `<div class="box">초음파는 쉴드의 <b>+ R T G</b> 헤더에 꽂습니다: + = 5V, <b>R = Echo(${pin('ultra','Echo')})</b>, <b>T = Trig(${pin('ultra','Trig')})</b>, G = GND.</div>
        <div class="warn"><b>Echo(${pin('ultra','Echo')})는 입력으로만</b> 씁니다. 오른쪽 모터 BRAKE 자리와 같은 핀이라 출력으로 설정하면 안 됩니다.</div>` },
    prompt: {
      parts: '초음파 센서 HC-SR04(쉴드 + R T G 헤더), 능동형 부저',
      pinKeys: ['ultra','buzzer'],
      actions: [
        `Trig ${pin('ultra','Trig')}, Echo ${pin('ultra','Echo')}로 100ms마다 거리(cm)를 출력한다`,
        '물체가 없어 Echo가 돌아오지 않으면(타임아웃) "감지 없음"을 출력한다',
        `20cm 이하면 ${pin('buzzer','신호')} 부저를 켠다`,
      ],
      mistakes: ['<code>pulseIn()</code>에 타임아웃(세 번째 값)을 안 넣는다 → 기본값이 1초라서, 센서가 빠졌거나 신호가 오지 않으면 최대 1초 동안 <code>loop()</code>가 멈출 수 있다.'],
      codeChecks: [
        '<code>pulseIn(Echo, HIGH, 숫자)</code>처럼 타임아웃 값이 있는가',
        '<code>pulseIn</code> 결과가 0(타임아웃)일 때 따로 처리하는가',
        `Echo 핀(${pin('ultra','Echo')})을 OUTPUT으로 설정하지 않았는가`,
      ],
      teacherTip: '[동작] 2번(타임아웃 처리)을 빼고 요청해 보세요. <code>pulseIn</code>에 타임아웃이 없는 코드가 나오면 학생이 코드 검사표로 찾아내게 합니다.',
    },
    example: { file:'examples/m4_ultra/m4_ultra.ino' },
    testExtra: () => `<div class="box">시리얼 모니터는 <b>${PINMAP.usb.baud}bps</b>로 엽니다. 이 예제는 문자를 받지 않으니 빠른 전송 버튼이 없습니다. 열면 바로 거리가 계속 나옵니다.</div>
      ${measTableHTML()}
      <div class="box"><b>관찰:</b> 부드러운 천이나 비스듬한 면에 대 보세요. 값이 튀거나 "감지 없음"이 나옵니다. 천은 소리를 <b>흡수</b>하고, 비스듬한 면은 소리를 다른 방향으로 <b>튕겨(난반사)</b> 센서로 잘 돌아오지 않기 때문입니다.</div>`,
    checklist: [
      `초음파를 + R T G 헤더에 맞게 꽂았다 (T=${pin('ultra','Trig')}, R=${pin('ultra','Echo')})`,
      '코드 검사표로 pulseIn 타임아웃을 확인했다',
      `업로드 후 시리얼 모니터(${PINMAP.usb.baud}bps)에 거리가 0.1초마다 나온다`,
      '손을 가까이 하면 숫자가 작아진다',
      '20cm 이하에서 부저가 울린다',
      '센서 앞을 비우면 "감지 없음"이 나온다',
      '자로 10·20·30cm를 재서 위 표에 적었다',
      '천·비스듬한 면에서 값이 튀는 것을 확인했다',
    ],
    quiz: [
      { q:'Echo가 1160µs 동안 HIGH였다. 거리는?', a:'1160 ÷ 58 = 20cm.' },
      { q:'왜 58로 나눌까?', a:'소리가 1cm 가는 데 약 29µs 걸리는데, 갔다가 돌아와야(왕복) 하니 2배인 58µs가 1cm다.' },
      { q:'부드러운 천이나 비스듬한 벽 앞에서 값이 튀는 이유는?', a:'천은 소리를 흡수하고, 비스듬한 면은 소리를 다른 방향으로 튕겨(난반사) 센서로 돌아오는 소리가 약하거나 없기 때문이다.' },
      { q:'pulseIn에 타임아웃을 안 넣으면?', a:'pulseIn의 기본 타임아웃은 1초다. 물체가 없으면 HC-SR04가 약 38ms 뒤 스스로 신호를 끝내므로 그만큼 기다리고, 센서가 빠졌거나 고장이면 최대 1초 동안 loop()가 멈춰 다른 일을 못 한다. 30000µs처럼 짧게 정해 두면 빨리 "감지 없음"으로 넘어간다.' },
    ],
  },

  /* ---------------- M5 적외선 라인센서 (선택) ---------------- */
  m5: {
    goal: `적외선 반사로 흰색과 검정을 구분하는 원리를 알고, digitalRead로 ${pin('line','DO')}를 읽어 판정한다.`,
    topWarn: '',
    principle: { html: () => linePrincipleHTML(), init: initLine },
    wiring: { keys:['line'],
      notes: `<div class="box">DO(디지털 출력)만 씁니다. AO(아날로그 출력)는 연결하지 않습니다. 모듈의 <b>가변저항</b>(작은 나사)을 돌리면 감도가 바뀝니다.</div>` },
    prompt: {
      parts: 'IR 라인센서 모듈 1개(디지털 출력 DO)',
      pinKeys: ['line'],
      actions: [
        `${pin('line','DO')}를 100ms마다 digitalRead로 읽어 "검정" 또는 "흰색"을 출력한다`,
        '검정일 때의 값(기본 1)을 코드 맨 위 한 곳에서 바꿀 수 있게 한다',
      ],
      mistakes: ['<code>analogRead</code>로 읽는다 → DO는 0/1만 내는 디지털 출력이라 <code>digitalRead</code>를 써야 한다.'],
      codeChecks: [
        `<code>digitalRead(${pin('line','DO')})</code>를 쓰고 <code>analogRead</code>는 없는가`,
        '검정일 때의 값을 한 곳에서 바꿀 수 있는가 (예제의 <code>BLACK_IS</code>)',
      ],
      teacherTip: '[동작]에서 "digitalRead로"를 빼고 "라인센서 값을 읽어"라고만 요청해 보세요. AI가 <code>analogRead</code>를 쓰는 경우를 보여 줄 수 있습니다.',
    },
    example: { file:'examples/m5_line/m5_line.ino' },
    testExtra: () => `<div class="box">시리얼 모니터는 <b>${PINMAP.usb.baud}bps</b>로 엽니다. 이 예제는 문자를 받지 않으니 빠른 전송 버튼이 없습니다.</div>`,
    checklist: [
      `DO → ${pin('line','DO')}, VCC → ${pin('line','VCC')}, GND → ${pin('line','GND')}로 연결했다`,
      '코드 검사표로 analogRead가 없는 것을 확인했다',
      `업로드 후 시리얼 모니터(${PINMAP.usb.baud}bps)에 0.1초마다 값이 나온다`,
      '흰 종이 위 → "흰색"',
      '검정 테이프 위 → "검정"',
      '반대로 나오면 BLACK_IS를 0으로 바꿔 다시 업로드했다 (해당할 때)',
      '가변저항을 돌려 흰색/검정이 확실히 바뀌는 감도로 맞췄다',
    ],
    quiz: [
      { q:'센서를 바닥에서 너무 높이 들면 왜 항상 "검정"이 될까?', a:'반사광이 센서로 돌아오지 않아서, 검정이 빛을 흡수한 것과 구분할 수 없기 때문이다.' },
      { q:'흰색과 검정에서 반사광은 어떻게 다를까?', a:'흰색은 빛을 많이 반사하고, 검정은 흡수해서 반사광이 적다.' },
      { q:'모듈의 가변저항을 돌리면 무엇이 바뀔까?', a:'비교기의 기준값(감도)이 바뀐다. 반사광이 기준보다 많은지 적은지로 DO가 0/1로 정해진다.' },
    ],
  },

  /* ---------------- M6 블루투스 ---------------- */
  m6: {
    goal: `HC-05가 '무선 시리얼 케이블'로 동작하는 원리(페어링·가상 COM·UART 교차 연결)를 알고, 블루투스로 문자를 보내 로봇을 움직인다.`,
    topWarn: `<b>배선 주의:</b> HC-05 TXD → <b>${pin('bt','TXD→')}</b>, RXD ← <b>${pin('bt','RXD←')}</b> (교차). HC-05 RXD에는 <b>분압(5V→3.3V)</b>을 권장합니다. 배선은 USB·배터리를 뺀 뒤에 바꿉니다.`,
    principle: { html: () => btPrincipleHTML(), init: initBt },
    wiring: { keys:['bt'],
      notes: `<div class="box">HC-05는 <b>${PINMAP.bt.baud}bps</b>, USB는 <b>${PINMAP.usb.baud}bps</b>로 서로 다릅니다. 모터·부저 핀은 M2·M3와 같습니다(공통 핀 맵 참고).</div>
        <div class="box">페어링 기본 PIN: <b>1234</b> 또는 <b>0000</b>. 로봇 이름(예: SMARS-01)을 확인하고 우리 팀 로봇에만 연결합니다.</div>` },
    prompt: {
      parts: 'HC-05 블루투스 모듈, DC모터 2개, 능동형 부저',
      pinKeys: ['bt','motorL','motorR','buzzer'],
      extraConstraint: `SoftwareSerial만 허용, HC-05는 ${PINMAP.bt.baud}`,
      actions: [
        `HC-05(${pin('bt','TXD→')}=RX, ${pin('bt','RXD←')}=TX, ${PINMAP.bt.baud})로 F/S/Z 문자를 받아 F=전진, S=정지, Z=부저 200ms`,
        '받은 문자를 USB 시리얼에도 출력한다',
        'USB 시리얼로 같은 문자를 받아도 똑같이 동작한다',
        '1초 동안 명령이 없으면 모터를 멈춘다',
      ],
      mistakes: [`<code>SoftwareSerial</code>의 인자 순서를 뒤바꾼다. 순서는 <b>(RX, TX)</b> → <code>SoftwareSerial BT(${pin('bt','TXD→')}, ${pin('bt','RXD←')})</code>가 맞습니다. 바뀌면 "연결은 되는데 응답 없음"이 됩니다.`],
      codeChecks: [
        `<code>SoftwareSerial 이름(${pin('bt','TXD→')}, ${pin('bt','RXD←')})</code> — (RX, TX) 순서인가`,
        `HC-05는 <code>.begin(${PINMAP.bt.baud})</code>, USB는 <code>Serial.begin(${PINMAP.usb.baud})</code>인가`,
        '모터 핀이 공통 핀 맵과 같은가 (M2와 같음)',
      ],
      includeCheck: '외부 라이브러리는 <code>SoftwareSerial</code>(<code>#include &lt;SoftwareSerial.h&gt;</code>)<b>만 허용</b> — 그 밖의 <code>#include</code>는 없는가',
      teacherTip: `<b>시연:</b> [핀] 칸의 "TXD→ / RXD←" 설명을 빼고 요청해 보세요. AI가 <code>SoftwareSerial</code> 인자 순서를 바꿔 쓰는 경우를 코드 검사표로 찾아내게 합니다.</p>
        <p><b>수업 전날:</b> HC-05 이름을 SMARS-01 … SMARS-10으로 바꿔 둡니다. <code>reference/sketches/at_test</code>(AT 모드 38400)를 쓰되, at_test는 HC-05를 D8/D9에 둔 배선이므로 <code>SoftwareSerial(${pin('bt','TXD→')}, ${pin('bt','RXD←')})</code>로 바꿔서 씁니다.`,
    },
    example: { file:'examples/m6_bt/m6_bt.ino' },
    quick: ['F','S','Z'],
    testExtra: () => `<div class="box"><b>예제 동작:</b> 1초 동안 명령이 없으면 멈추는 안전장치(워치독)가 있어서, <b>F를 한 번 보내면 약 1초만</b> 움직입니다. 받은 글자는 USB 시리얼에 <code>BT&gt; F</code> / <code>USB&gt; F</code>처럼 찍힙니다.</div>
      <div class="box"><b>빠른 전송 버튼</b>은 미니 모니터가 연결된 포트로 보냅니다.<br>
        · USB로 테스트: 미니 모니터를 <b>USB / ${PINMAP.usb.baud}</b>로 연결 (예제가 USB 입력도 받습니다)<br>
        · 블루투스로 테스트: PC에서 페어링 후 미니 모니터를 <b>블루투스 COM / ${PINMAP.bt.baud}</b>로 연결, 또는 폰 블루투스 시리얼 앱 사용</div>`,
    checklist: [
      `HC-05 TXD → ${pin('bt','TXD→')}, RXD ← ${pin('bt','RXD←')}로 교차 연결했다 (바퀴는 띄운 채)`,
      '코드 검사표로 SoftwareSerial (RX, TX) 순서를 확인했다',
      `USB(${PINMAP.usb.baud})로 F·S·Z를 보내면 바퀴·부저가 반응하고 "USB> F"가 찍힌다`,
      'PC(또는 폰)에서 우리 팀 로봇 이름을 확인하고 페어링했다',
      `블루투스(COM ${PINMAP.bt.baud} 또는 폰 앱)로 F를 보내면 바퀴가 약 1초 돈다`,
      '블루투스로 Z를 보내면 부저가 "삑" 한다',
    ],
    quiz: [
      { q:'HC-05 TXD를 아두이노의 TX에 꽂으면 왜 안 될까?', a:'TX는 "보내는" 핀이라 둘 다 말만 하고 아무도 듣지 않는다. 한쪽의 TX는 상대의 RX에 꽂는다(교차 연결).' },
      { q:'왜 D0/D1 대신 다른 핀과 SoftwareSerial을 쓸까?', a:'D0/D1은 USB 시리얼(업로드·시리얼 모니터)이 쓰고 있기 때문이다.' },
      { q:'웹 페이지가 Web Bluetooth로 HC-05에 바로 연결하지 못하는 이유는?', a:'Web Bluetooth는 BLE만 지원하고, HC-05는 클래식 블루투스(SPP)이다. 그래서 블루투스 COM 포트를 Web Serial로 연다.' },
      { q:"'F' 한 글자를 보낼 때 실제로 몇 비트가 나갈까?", a:'시작 비트 1 + 데이터 8 + 정지 비트 1 = 10비트.' },
    ],
  },
});

/* 4. 검증된 예제 — examples/ 에서 생성(sync_lesson.mjs). 카드 ④가 id="ex-mN" 블록을 읽는다 */
/* @examples:begin */
/* 아래는 examples 폴더의 .ino 파일에서 자동 생성 — 예제는 .ino 를 고친다 */
const A1_EXAMPLES = [
  { mod: "m1", file: "examples/m1_blink/m1_blink.ino",
    code: "// M1 LED 깜빡이기: D13의 LED를 0.5초 간격으로 켜고 끈다.\n// 배선: 외부 LED(+, 긴 다리) → 220Ω → D13, LED(−, 짧은 다리) → GND (보드 내장 LED도 같이 깜빡임). 시리얼 57600bps.\n// 테스트: 업로드 후 LED가 깜빡이는지 보고, 시리얼 모니터(57600)에서 ON/OFF가 번갈아 나오는지 확인한다.\n\nconst int LED_PIN = 13;   // LED가 연결된 핀 번호\n\nvoid setup() {\n  Serial.begin(57600);      // USB 시리얼 시작 (57600bps)\n  pinMode(LED_PIN, OUTPUT); // D13을 출력으로 설정\n}\n\nvoid loop() {\n  digitalWrite(LED_PIN, HIGH); // LED 켜기\n  Serial.println(\"ON\");        // 켰다고 알려주기\n  delay(500);                  // 0.5초 기다리기 (입문용으로 delay 사용 — M2부터는 millis()로 바꿔요)\n  digitalWrite(LED_PIN, LOW);  // LED 끄기\n  Serial.println(\"OFF\");       // 껐다고 알려주기\n  delay(500);                  // 0.5초 기다리기 (입문용으로 delay 사용 — M2부터는 millis()로 바꿔요)\n}\n" },
  { mod: "m2", file: "examples/m2_motor/m2_motor.ino",
    code: "// M2 모터 구동: 시리얼로 F/B/L/R/S 와 속도(%) 숫자를 받아 L298P 쉴드의 모터 두 개를 움직인다.\n// 배선: 왼쪽 DIR=D12, PWM=D10, BRAKE=D9 / 오른쪽 DIR=D13, PWM=D11 (D8은 초음파 Echo라 사용 안 함). 시리얼 57600bps.\n// 테스트: 시리얼 모니터(57600)에서 F, B, L, R, S 또는 F50 처럼 보낸다(F=전진 B=후진 L/R=제자리 회전 S=정지, 숫자=속도 0~100).\n\n#define INVERT_LEFT 0    // 왼쪽 바퀴가 거꾸로 돌면 1로 바꾼다\n#define INVERT_RIGHT 0   // 오른쪽 바퀴가 거꾸로 돌면 1로 바꾼다\n\nconst int L_DIR = 12;    // 왼쪽 방향 핀\nconst int L_BRK = 9;     // 왼쪽 브레이크 핀 (LOW로 유지)\nconst int L_PWM = 10;    // 왼쪽 속도 핀\nconst int R_DIR = 13;    // 오른쪽 방향 핀\nconst int R_PWM = 11;    // 오른쪽 속도 핀\n\nchar cmd = 'S';          // 마지막으로 받은 명령 글자\nint speedPct = 80;       // 속도(%) 기본값 80\nbool hasNum = false;     // 명령 뒤에 숫자가 왔는지\n\n// 모터 하나 구동: pct가 양수면 전진, 음수면 후진, 0이면 정지\nvoid drive(int dirPin, int pwmPin, int pct, int invert) {\n  if (invert) pct = -pct;                      // 방향 보정\n  digitalWrite(dirPin, pct >= 0 ? HIGH : LOW); // 전진이면 HIGH, 후진이면 LOW\n  analogWrite(pwmPin, abs(pct) * 255 / 100);   // 퍼센트를 0~255로 바꿔 출력\n}\n\n// 현재 명령(cmd)과 속도(speedPct)로 두 모터를 움직인다\nvoid apply() {\n  int v = constrain(speedPct, 0, 100);       // 속도를 0~100으로 제한\n  int l = 0, r = 0;                          // 왼쪽, 오른쪽 출력\n  if (cmd == 'F') { l = v;  r = v;  }        // 전진\n  if (cmd == 'B') { l = -v; r = -v; }        // 후진\n  if (cmd == 'L') { l = -v; r = v;  }        // 왼쪽 제자리 회전\n  if (cmd == 'R') { l = v;  r = -v; }        // 오른쪽 제자리 회전\n  drive(L_DIR, L_PWM, l, INVERT_LEFT);       // 왼쪽 모터 구동\n  drive(R_DIR, R_PWM, r, INVERT_RIGHT);      // 오른쪽 모터 구동\n}\n\nvoid setup() {\n  Serial.begin(57600);        // USB 시리얼 시작\n  pinMode(L_DIR, OUTPUT);     // 왼쪽 방향 핀 출력\n  pinMode(L_BRK, OUTPUT);     // 왼쪽 브레이크 핀 출력\n  pinMode(L_PWM, OUTPUT);     // 왼쪽 속도 핀 출력\n  pinMode(R_DIR, OUTPUT);     // 오른쪽 방향 핀 출력\n  pinMode(R_PWM, OUTPUT);     // 오른쪽 속도 핀 출력\n  digitalWrite(L_BRK, LOW);   // 왼쪽 브레이크 해제\n  apply();                    // 시작할 때는 정지 상태\n  Serial.println(\"M2 ready: F B L R S + speed\");\n}\n\nvoid loop() {\n  if (Serial.available() > 0) {              // 받은 글자가 있으면\n    char c = Serial.read();                  // 한 글자 읽기\n    if (c == '\\r' || c == '\\n') {            // 줄바꿈이면\n      hasNum = false;                        // 숫자 누적 초기화 (다음 숫자는 새 속도)\n      return;                                // 더 할 일 없음\n    }\n    if (c >= 'a' && c <= 'z') c -= 32;       // 소문자를 대문자로\n    if (c >= '0' && c <= '9') {              // 숫자면 속도 입력\n      if (!hasNum) speedPct = 0;             // 새 숫자의 첫 글자면 0부터 시작\n      hasNum = true;                         // 숫자가 왔다고 표시\n      speedPct = speedPct * 10 + (c - '0');  // 자릿수 쌓기\n      if (speedPct > 100) speedPct = 100;    // 100% 넘으면 100으로\n      Serial.print(\"speed \");                // 에코 출력\n      Serial.println(speedPct);\n      apply();                               // 바뀐 속도로 다시 구동\n    } else if (c == 'F' || c == 'B' || c == 'L' || c == 'R' || c == 'S') {\n      cmd = c;                               // 명령 저장\n      speedPct = 80;                         // 새 명령은 기본 속도 80\n      hasNum = false;                        // 숫자 입력 상태 초기화\n      Serial.print(\"cmd \");                  // 받은 명령 에코\n      Serial.println(c);\n      apply();                               // 모터 구동\n    }\n  }\n}\n" },
  { mod: "m3", file: "examples/m3_buzzer/m3_buzzer.ino",
    code: "// M3 부저: 시리얼 1/2/3 으로 삑, 경보, SOS 소리를 낸다. (능동 부저는 켜고 끄기만 가능)\n// 배선: 부저 신호 = D4, GND = GND. 시리얼 57600bps. tone()은 D11 모터 PWM을 깨뜨려서 쓰지 않는다.\n// 테스트: 시리얼 모니터(57600)에서 1(삑 200ms), 2(경보 5회), 3(SOS)을 보낸다. 소리 중 새 입력이 오면 바뀐다.\n\nconst int BUZ_PIN = 4;            // 부저 핀\n\n// 패턴: 켜짐/꺼짐 시간(ms)을 번갈아 적는다 (첫 값은 켜짐)\nconst int P_BEEP[]  = {200};                                      // 삑\nconst int P_ALARM[] = {200,200,200,200,200,200,200,200,200,200}; // 경보 5회\nconst int P_SOS[]   = {150,150,150,150,150,450,                   // 점 점 점\n                       450,150,450,150,450,450,                   // 선 선 선\n                       150,150,150,150,150};                      // 점 점 점\n\nconst int* pat = 0;               // 지금 재생 중인 패턴\nint patLen = 0;                   // 패턴 길이\nint step = 0;                     // 현재 단계\nunsigned long stepStart = 0;      // 현재 단계 시작 시각\n\n// 패턴 재생 시작\nvoid play(const int* p, int len) {\n  pat = p;                        // 패턴 저장\n  patLen = len;                   // 길이 저장\n  step = 0;                       // 처음부터\n  stepStart = millis();           // 시작 시각 기록\n  digitalWrite(BUZ_PIN, HIGH);    // 첫 단계는 켜짐\n}\n\nvoid setup() {\n  Serial.begin(57600);            // USB 시리얼 시작\n  pinMode(BUZ_PIN, OUTPUT);       // 부저 핀 출력\n  digitalWrite(BUZ_PIN, LOW);     // 처음에는 끔\n  Serial.println(\"M3 ready: 1 2 3\");\n}\n\nvoid loop() {\n  if (Serial.available() > 0) {   // 받은 글자가 있으면\n    char c = Serial.read();       // 한 글자 읽기\n    if (c == '1') play(P_BEEP, 1);    // 삑\n    if (c == '2') play(P_ALARM, 10);  // 경보\n    if (c == '3') play(P_SOS, 17);    // SOS\n    if (c >= '1' && c <= '3') {       // 유효한 입력이면\n      Serial.print(\"play \");          // 에코 출력\n      Serial.println(c);\n    }\n  }\n  if (pat != 0 && millis() - stepStart >= (unsigned long)pat[step]) { // 단계 시간이 끝나면\n    step++;                       // 다음 단계로\n    stepStart = millis();         // 시작 시각 갱신\n    if (step >= patLen) {         // 패턴이 끝났으면\n      pat = 0;                    // 재생 종료\n      digitalWrite(BUZ_PIN, LOW); // 부저 끄기\n    } else {\n      digitalWrite(BUZ_PIN, step % 2 == 0 ? HIGH : LOW); // 짝수 단계는 켜짐, 홀수는 꺼짐\n    }\n  }\n}\n" },
  { mod: "m4", file: "examples/m4_ultra/m4_ultra.ino",
    code: "// M4 초음파 거리: HC-SR04로 거리를 재서 0.1초마다 출력하고, 20cm 이하면 부저를 켠다.\n// 배선: 초음파 Trig = D7, Echo = D8, VCC = 5V, GND = GND / 부저 = D4. 시리얼 57600bps.\n// 테스트: 시리얼 모니터(57600)를 열고 손을 가까이 가져간다. 20cm 이하에서 부저가 울리고, 너무 멀면 \"감지 없음\"이 나온다.\n\nconst int TRIG_PIN = 7;            // 초음파 Trig 핀 (출력)\nconst int ECHO_PIN = 8;            // 초음파 Echo 핀 (입력만 사용)\nconst int BUZ_PIN = 4;             // 부저 핀\n\nunsigned long lastMs = 0;          // 마지막 측정 시각\n\nvoid setup() {\n  Serial.begin(57600);             // USB 시리얼 시작\n  pinMode(TRIG_PIN, OUTPUT);       // Trig는 출력\n  pinMode(ECHO_PIN, INPUT);        // Echo는 입력\n  pinMode(BUZ_PIN, OUTPUT);        // 부저는 출력\n}\n\nvoid loop() {\n  if (millis() - lastMs >= 100) {          // 100ms마다 한 번\n    lastMs = millis();                     // 시각 갱신\n    digitalWrite(TRIG_PIN, LOW);           // Trig를 잠깐 LOW로\n    delayMicroseconds(2);                  // 2마이크로초 대기\n    digitalWrite(TRIG_PIN, HIGH);          // 10마이크로초 펄스 시작\n    delayMicroseconds(10);                 // 10마이크로초 유지\n    digitalWrite(TRIG_PIN, LOW);           // 펄스 끝\n    long us = pulseIn(ECHO_PIN, HIGH, 30000); // Echo 시간 측정 (30ms 넘으면 포기)\n    if (us == 0) {                         // 0이면 물체를 못 찾은 것\n      Serial.println(\"감지 없음\");         // 안내 출력\n      digitalWrite(BUZ_PIN, LOW);          // 부저 끄기\n    } else {\n      long cm = us / 58;                   // 시간(us)을 거리(cm)로 변환\n      Serial.print(\"거리 \");               // 거리 출력\n      Serial.print(cm);\n      Serial.println(\" cm\");\n      digitalWrite(BUZ_PIN, cm <= 20 ? HIGH : LOW); // 20cm 이하면 부저 켬\n    }\n  }\n}\n" },
  { mod: "m5", file: "examples/m5_line/m5_line.ino",
    code: "// M5 라인 센서: 적외선 센서의 디지털 값을 0.1초마다 읽어 검정/흰색을 출력한다.\n// 배선: 센서 DO = A2, VCC = 5V, GND = GND (AO는 쓰지 않음). 시리얼 57600bps.\n// 테스트: 시리얼 모니터(57600)를 열고 센서 아래에 검정 테이프와 흰 종이를 번갈아 놓는다. 반대로 나오면 BLACK_IS를 0으로 바꾼다.\n\n#define BLACK_IS 1                 // 검정일 때 센서값 (1 또는 0, 모듈마다 다르다)\n\nconst int LINE_PIN = A2;           // 라인 센서 DO 핀\n\nunsigned long lastMs = 0;          // 마지막으로 읽은 시각\n\nvoid setup() {\n  Serial.begin(57600);             // USB 시리얼 시작\n  pinMode(LINE_PIN, INPUT);        // 센서 핀은 입력\n}\n\nvoid loop() {\n  if (millis() - lastMs >= 100) {          // 100ms마다 한 번\n    lastMs = millis();                     // 시각 갱신\n    int v = digitalRead(LINE_PIN);         // 디지털 값 읽기 (0 또는 1)\n    Serial.print(\"LINE \");                 // 원시 값 출력\n    Serial.print(v);\n    if (v == BLACK_IS) Serial.println(\" 검정\");  // 검정 판정\n    else Serial.println(\" 흰색\");                // 흰색 판정\n  }\n}\n" },
  { mod: "m6", file: "examples/m6_bt/m6_bt.ino",
    code: "// M6 블루투스: HC-05(또는 USB)로 F(전진 80%), S(정지), Z(부저 200ms) 명령을 받는다.\n// 배선: HC-05 TXD -> A1(아두이노 RX), HC-05 RXD <- A0(아두이노 TX, 분압 권장), 모터·부저는 M2·M3와 같다. BT 9600, USB 57600bps.\n// 테스트: 시리얼 모니터나 폰 앱에서 F, S, Z를 보낸다. 받은 글자는 \"BT> F\"처럼 출력되고, 1초 동안 명령이 없으면 모터가 멈춘다.\n\n#include <SoftwareSerial.h>        // 블루투스용 소프트웨어 시리얼\n\nSoftwareSerial BT(A1, A0);         // (RX, TX) = (A1, A0)\n\nconst int L_DIR = 12;              // 왼쪽 방향 핀\nconst int L_BRK = 9;               // 왼쪽 브레이크 핀 (LOW 유지)\nconst int L_PWM = 10;              // 왼쪽 속도 핀\nconst int R_DIR = 13;              // 오른쪽 방향 핀\nconst int R_PWM = 11;              // 오른쪽 속도 핀\nconst int BUZ_PIN = 4;             // 부저 핀\n\nunsigned long lastCmdMs = 0;       // 마지막 명령 받은 시각\nunsigned long buzOffMs = 0;        // 부저를 끌 시각 (0이면 꺼짐 상태)\n\n// 두 모터를 같은 방향·속도로 구동 (pct 0이면 정지)\nvoid driveBoth(int pct) {\n  digitalWrite(L_DIR, HIGH);               // 전진 방향\n  digitalWrite(R_DIR, HIGH);               // 전진 방향\n  analogWrite(L_PWM, pct * 255 / 100);     // 왼쪽 속도\n  analogWrite(R_PWM, pct * 255 / 100);     // 오른쪽 속도\n}\n\n// 받은 글자 하나를 처리 (from은 \"BT\" 또는 \"USB\")\nvoid handle(char c, const char* from) {\n  if (c == '\\r' || c == '\\n') return;      // 줄바꿈은 무시\n  if (c >= 'a' && c <= 'z') c -= 32;       // 소문자를 대문자로\n  Serial.print(from);                      // 어디서 왔는지 출력\n  Serial.print(\"> \");\n  Serial.println(c);                       // 받은 글자 출력\n  lastCmdMs = millis();                    // 명령 받은 시각 기록\n  if (c == 'F') driveBoth(80);             // 전진 80%\n  if (c == 'S') driveBoth(0);              // 정지\n  if (c == 'Z') {                          // 부저 200ms\n    digitalWrite(BUZ_PIN, HIGH);           // 부저 켜기\n    buzOffMs = millis() + 200;             // 200ms 뒤에 끄기\n  }\n}\n\nvoid setup() {\n  Serial.begin(57600);             // USB 시리얼 시작\n  BT.begin(9600);                  // HC-05 시리얼 시작 (9600)\n  pinMode(L_DIR, OUTPUT);          // 모터 핀들을 출력으로\n  pinMode(L_BRK, OUTPUT);          // 왼쪽 브레이크 핀 출력\n  pinMode(L_PWM, OUTPUT);          // 왼쪽 속도 핀 출력\n  pinMode(R_DIR, OUTPUT);          // 오른쪽 방향 핀 출력\n  pinMode(R_PWM, OUTPUT);          // 오른쪽 속도 핀 출력\n  pinMode(BUZ_PIN, OUTPUT);        // 부저 핀 출력\n  digitalWrite(L_BRK, LOW);        // 왼쪽 브레이크 해제\n  driveBoth(0);                    // 처음에는 정지\n  Serial.println(\"M6 ready: F S Z\");\n}\n\nvoid loop() {\n  if (BT.available() > 0) handle(BT.read(), \"BT\");          // 블루투스 입력\n  if (Serial.available() > 0) handle(Serial.read(), \"USB\"); // USB 입력\n  if (millis() - lastCmdMs > 1000) driveBoth(0);            // 1초간 명령 없으면 정지\n  if (buzOffMs != 0 && millis() >= buzOffMs) {              // 부저 끌 시간이면\n    digitalWrite(BUZ_PIN, LOW);                             // 부저 끄기\n    buzOffMs = 0;                                           // 꺼짐 상태로\n  }\n}\n" },
];
/* @examples:end */
A1_EXAMPLES.forEach(e => { if (document.getElementById('ex-' + e.mod)) return; const s = document.createElement('script'); s.type = 'text/plain'; s.id = 'ex-' + e.mod; s.dataset.file = e.file; s.textContent = '\n' + e.code; document.body.appendChild(s); });
