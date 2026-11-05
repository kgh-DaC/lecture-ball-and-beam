// 연결 문제 해결 안내(보드 중립: Arduino Uno / Nano 호환). 설정 화면·오류 토스트·신호 판정이 같은 문구를 쓴다.
// 장치 구성: Nano V3.0 호환(CH340, ATmega328P) 또는 Uno + HS-5645MG 서보(별도 5.0 V 전원) + HC-SR04.

export const BOARD_LABEL = 'Arduino(Uno/Nano)';

/** 서보 전원 부족 증상 안내(리셋·하트비트 타임아웃·떨림) */
export const SERVO_POWER_HINT = '서보 전원 부족일 수 있습니다: 서보를 별도 5.0 V(2 A 이상) 전원으로 구동하고, 서보 전원 GND와 보드 GND만 공통인지, 서보 5 V를 보드 5V 핀에 잇지 않았는지, 9 V 사각 건전지를 쓰지 않았는지 확인하세요.';

/** 포트 선택 창에 보이는 이름(운영체제별) */
export const PORT_NAMES = [
  ['Arduino Uno', 'Windows "Arduino Uno (COMn)", Linux /dev/ttyACM0, macOS /dev/cu.usbmodem…'],
  ['Arduino Nano 호환(CH340)', 'Windows "USB-SERIAL CH340 (COMn)", Linux /dev/ttyUSB0, macOS /dev/cu.wchusbserial… 또는 /dev/cu.usbserial…'],
];

/** 연결 실패 안내(증상 → 확인할 것) */
export const CONNECT_HELP = [
  { key: 'no_port', title: '포트 선택 창에 장치가 없다',
    items: ['데이터 전송이 되는 USB 케이블인지(충전 전용 케이블은 포트가 안 생긴다)',
      'Nano 호환 보드는 CH340 USB-시리얼 드라이버가 설치되어 있는지(Windows 장치 관리자 → 포트에 "USB-SERIAL CH340"이 보여야 한다)',
      'Arduino IDE 시리얼 모니터·a0_monitor 같은 다른 프로그램이 포트를 잡고 있지 않은지(닫고 다시 시도)'] },
  { key: 'no_hello', title: '포트는 열리는데 "장치 응답(H)이 없습니다"',
    items: ['펌웨어(firmware/ball_beam)를 이 보드에 업로드했는지. 업로드 보드: Uno는 "Arduino Uno", Nano 호환은 "Arduino Nano"(업로드가 not in sync로 실패하면 프로세서 "ATmega328P (Old Bootloader)")',
      '보드레이트 115200(펌웨어와 같은 값)',
      '포트를 연 직후 보드가 리셋되어 약 1.6 s 뒤에 H를 보낸다 — 3 s 넘게 조용하면 업로드·포트를 다시 확인'] },
  { key: 'servo_power', title: '서보가 움직이면 연결이 끊기거나 리셋된다 · 하트비트 만료(E,4) · 서보 떨림',
    items: ['서보 전원 부족의 전형적인 증상이다: 서보가 전류를 끌 때 보드 전압이 처지면 보드가 리셋되고(연결 중에 H가 다시 온다), 그동안 B를 못 받아 하트비트가 만료되며, 서보가 덜덜 떤다',
      '서보는 별도 5.0 V 전원(2 A 이상 어댑터·보조 배터리·5 V 강압 모듈)으로, 보드는 USB로 따로 받는다',
      '서보 전원 GND와 보드 GND만 공통으로 잇는다(공통 GND가 없어도 떨림·A0 오측정이 생긴다)',
      '서보 전원의 5 V를 보드 5V 핀에 잇지 않는다(USB 5 V와 부딪힌다). 실드 헤더의 V핀에도 꽂지 않는다',
      '9 V 사각 건전지로 구동하지 않는다(전류 부족으로 전압이 무너지고 서보 정격을 넘는다)',
      '서보 전원은 연결 전에 멀티미터로 5.0 V 이하인지 확인한다(포텐쇼미터 와이퍼 → A0 보호)'] },
  { key: 'unstable', title: '수신 주기가 들쭉날쭉하거나 가끔 끊긴다',
    items: ['USB 허브 대신 PC 포트에 직접 꽂기, 케이블 교체', '탭을 백그라운드로 두지 않기(브라우저가 타이머를 늦춘다)', '서보 전원 부족도 같은 증상을 낸다 — 위 항목 확인'] },
];

/** 하트비트 만료 안내(러너·조그 오류 문구 뒤에 붙인다) */
export function heartbeatHint() {
  return '탭 전환·PC 부하로 B 전송이 늦었거나, 서보 전원 부족으로 보드가 리셋됐을 수 있습니다. ' + SERVO_POWER_HINT;
}

/** 예기치 않은 연결 끊김 안내 */
export function disconnectHint() {
  return `USB 케이블·포트를 확인하세요. 서보가 움직일 때 끊겼다면 ${SERVO_POWER_HINT}`;
}

/** 연결 중 보드 리셋(H 재수신) 안내 */
export function resetHint() {
  return `연결 중에 장치가 다시 시작했습니다(H 재수신). 장치 설정이 펌웨어 기본값으로 돌아갔으니 연결을 끊고 다시 연결하세요. ${SERVO_POWER_HINT}`;
}
