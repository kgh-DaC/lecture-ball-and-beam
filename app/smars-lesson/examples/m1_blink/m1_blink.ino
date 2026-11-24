// M1 LED 깜빡이기: D13의 LED를 0.5초 간격으로 켜고 끈다.
// 배선: 외부 LED(+, 긴 다리) → 220Ω → D13, LED(−, 짧은 다리) → GND (보드 내장 LED도 같이 깜빡임). 시리얼 57600bps.
// 테스트: 업로드 후 LED가 깜빡이는지 보고, 시리얼 모니터(57600)에서 ON/OFF가 번갈아 나오는지 확인한다.

const int LED_PIN = 13;   // LED가 연결된 핀 번호

void setup() {
  Serial.begin(57600);      // USB 시리얼 시작 (57600bps)
  pinMode(LED_PIN, OUTPUT); // D13을 출력으로 설정
}

void loop() {
  digitalWrite(LED_PIN, HIGH); // LED 켜기
  Serial.println("ON");        // 켰다고 알려주기
  delay(500);                  // 0.5초 기다리기 (입문용으로 delay 사용 — M2부터는 millis()로 바꿔요)
  digitalWrite(LED_PIN, LOW);  // LED 끄기
  Serial.println("OFF");       // 껐다고 알려주기
  delay(500);                  // 0.5초 기다리기 (입문용으로 delay 사용 — M2부터는 millis()로 바꿔요)
}
