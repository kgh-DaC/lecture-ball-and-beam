// M5 라인 센서: 적외선 센서의 디지털 값을 0.1초마다 읽어 검정/흰색을 출력한다.
// 배선: 센서 DO = A2, VCC = 5V, GND = GND (AO는 쓰지 않음). 시리얼 57600bps.
// 테스트: 시리얼 모니터(57600)를 열고 센서 아래에 검정 테이프와 흰 종이를 번갈아 놓는다. 반대로 나오면 BLACK_IS를 0으로 바꾼다.

#define BLACK_IS 1                 // 검정일 때 센서값 (1 또는 0, 모듈마다 다르다)

const int LINE_PIN = A2;           // 라인 센서 DO 핀

unsigned long lastMs = 0;          // 마지막으로 읽은 시각

void setup() {
  Serial.begin(57600);             // USB 시리얼 시작
  pinMode(LINE_PIN, INPUT);        // 센서 핀은 입력
}

void loop() {
  if (millis() - lastMs >= 100) {          // 100ms마다 한 번
    lastMs = millis();                     // 시각 갱신
    int v = digitalRead(LINE_PIN);         // 디지털 값 읽기 (0 또는 1)
    Serial.print("LINE ");                 // 원시 값 출력
    Serial.print(v);
    if (v == BLACK_IS) Serial.println(" 검정");  // 검정 판정
    else Serial.println(" 흰색");                // 흰색 판정
  }
}
