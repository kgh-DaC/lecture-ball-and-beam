// M6 블루투스: HC-05(또는 USB)로 F(전진 80%), S(정지), Z(부저 200ms) 명령을 받는다.
// 배선: HC-05 TXD -> A1(아두이노 RX), HC-05 RXD <- A0(아두이노 TX, 분압 권장), 모터·부저는 M2·M3와 같다. BT 9600, USB 57600bps.
// 테스트: 시리얼 모니터나 폰 앱에서 F, S, Z를 보낸다. 받은 글자는 "BT> F"처럼 출력되고, 1초 동안 명령이 없으면 모터가 멈춘다.

#include <SoftwareSerial.h>        // 블루투스용 소프트웨어 시리얼

SoftwareSerial BT(A1, A0);         // (RX, TX) = (A1, A0)

const int L_DIR = 12;              // 왼쪽 방향 핀
const int L_BRK = 9;               // 왼쪽 브레이크 핀 (LOW 유지)
const int L_PWM = 10;              // 왼쪽 속도 핀
const int R_DIR = 13;              // 오른쪽 방향 핀
const int R_PWM = 11;              // 오른쪽 속도 핀
const int BUZ_PIN = 4;             // 부저 핀

unsigned long lastCmdMs = 0;       // 마지막 명령 받은 시각
unsigned long buzOffMs = 0;        // 부저를 끌 시각 (0이면 꺼짐 상태)

// 두 모터를 같은 방향·속도로 구동 (pct 0이면 정지)
void driveBoth(int pct) {
  digitalWrite(L_DIR, HIGH);               // 전진 방향
  digitalWrite(R_DIR, HIGH);               // 전진 방향
  analogWrite(L_PWM, pct * 255 / 100);     // 왼쪽 속도
  analogWrite(R_PWM, pct * 255 / 100);     // 오른쪽 속도
}

// 받은 글자 하나를 처리 (from은 "BT" 또는 "USB")
void handle(char c, const char* from) {
  if (c == '\r' || c == '\n') return;      // 줄바꿈은 무시
  if (c >= 'a' && c <= 'z') c -= 32;       // 소문자를 대문자로
  Serial.print(from);                      // 어디서 왔는지 출력
  Serial.print("> ");
  Serial.println(c);                       // 받은 글자 출력
  lastCmdMs = millis();                    // 명령 받은 시각 기록
  if (c == 'F') driveBoth(80);             // 전진 80%
  if (c == 'S') driveBoth(0);              // 정지
  if (c == 'Z') {                          // 부저 200ms
    digitalWrite(BUZ_PIN, HIGH);           // 부저 켜기
    buzOffMs = millis() + 200;             // 200ms 뒤에 끄기
  }
}

void setup() {
  Serial.begin(57600);             // USB 시리얼 시작
  BT.begin(9600);                  // HC-05 시리얼 시작 (9600)
  pinMode(L_DIR, OUTPUT);          // 모터 핀들을 출력으로
  pinMode(L_BRK, OUTPUT);          // 왼쪽 브레이크 핀 출력
  pinMode(L_PWM, OUTPUT);          // 왼쪽 속도 핀 출력
  pinMode(R_DIR, OUTPUT);          // 오른쪽 방향 핀 출력
  pinMode(R_PWM, OUTPUT);          // 오른쪽 속도 핀 출력
  pinMode(BUZ_PIN, OUTPUT);        // 부저 핀 출력
  digitalWrite(L_BRK, LOW);        // 왼쪽 브레이크 해제
  driveBoth(0);                    // 처음에는 정지
  Serial.println("M6 ready: F S Z");
}

void loop() {
  if (BT.available() > 0) handle(BT.read(), "BT");          // 블루투스 입력
  if (Serial.available() > 0) handle(Serial.read(), "USB"); // USB 입력
  if (millis() - lastCmdMs > 1000) driveBoth(0);            // 1초간 명령 없으면 정지
  if (buzOffMs != 0 && millis() >= buzOffMs) {              // 부저 끌 시간이면
    digitalWrite(BUZ_PIN, LOW);                             // 부저 끄기
    buzOffMs = 0;                                           // 꺼짐 상태로
  }
}
