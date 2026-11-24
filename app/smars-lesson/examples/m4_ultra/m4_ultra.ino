// M4 초음파 거리: HC-SR04로 거리를 재서 0.1초마다 출력하고, 20cm 이하면 부저를 켠다.
// 배선: 초음파 Trig = D7, Echo = D8, VCC = 5V, GND = GND / 부저 = D4. 시리얼 57600bps.
// 테스트: 시리얼 모니터(57600)를 열고 손을 가까이 가져간다. 20cm 이하에서 부저가 울리고, 너무 멀면 "감지 없음"이 나온다.

const int TRIG_PIN = 7;            // 초음파 Trig 핀 (출력)
const int ECHO_PIN = 8;            // 초음파 Echo 핀 (입력만 사용)
const int BUZ_PIN = 4;             // 부저 핀

unsigned long lastMs = 0;          // 마지막 측정 시각

void setup() {
  Serial.begin(57600);             // USB 시리얼 시작
  pinMode(TRIG_PIN, OUTPUT);       // Trig는 출력
  pinMode(ECHO_PIN, INPUT);        // Echo는 입력
  pinMode(BUZ_PIN, OUTPUT);        // 부저는 출력
}

void loop() {
  if (millis() - lastMs >= 100) {          // 100ms마다 한 번
    lastMs = millis();                     // 시각 갱신
    digitalWrite(TRIG_PIN, LOW);           // Trig를 잠깐 LOW로
    delayMicroseconds(2);                  // 2마이크로초 대기
    digitalWrite(TRIG_PIN, HIGH);          // 10마이크로초 펄스 시작
    delayMicroseconds(10);                 // 10마이크로초 유지
    digitalWrite(TRIG_PIN, LOW);           // 펄스 끝
    long us = pulseIn(ECHO_PIN, HIGH, 30000); // Echo 시간 측정 (30ms 넘으면 포기)
    if (us == 0) {                         // 0이면 물체를 못 찾은 것
      Serial.println("감지 없음");         // 안내 출력
      digitalWrite(BUZ_PIN, LOW);          // 부저 끄기
    } else {
      long cm = us / 58;                   // 시간(us)을 거리(cm)로 변환
      Serial.print("거리 ");               // 거리 출력
      Serial.print(cm);
      Serial.println(" cm");
      digitalWrite(BUZ_PIN, cm <= 20 ? HIGH : LOW); // 20cm 이하면 부저 켬
    }
  }
}
