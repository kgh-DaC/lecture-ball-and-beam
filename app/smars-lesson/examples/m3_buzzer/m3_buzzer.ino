// M3 부저: 시리얼 1/2/3 으로 삑, 경보, SOS 소리를 낸다. (능동 부저는 켜고 끄기만 가능)
// 배선: 부저 신호 = D4, GND = GND. 시리얼 57600bps. tone()은 D11 모터 PWM을 깨뜨려서 쓰지 않는다.
// 테스트: 시리얼 모니터(57600)에서 1(삑 200ms), 2(경보 5회), 3(SOS)을 보낸다. 소리 중 새 입력이 오면 바뀐다.

const int BUZ_PIN = 4;            // 부저 핀

// 패턴: 켜짐/꺼짐 시간(ms)을 번갈아 적는다 (첫 값은 켜짐)
const int P_BEEP[]  = {200};                                      // 삑
const int P_ALARM[] = {200,200,200,200,200,200,200,200,200,200}; // 경보 5회
const int P_SOS[]   = {150,150,150,150,150,450,                   // 점 점 점
                       450,150,450,150,450,450,                   // 선 선 선
                       150,150,150,150,150};                      // 점 점 점

const int* pat = 0;               // 지금 재생 중인 패턴
int patLen = 0;                   // 패턴 길이
int step = 0;                     // 현재 단계
unsigned long stepStart = 0;      // 현재 단계 시작 시각

// 패턴 재생 시작
void play(const int* p, int len) {
  pat = p;                        // 패턴 저장
  patLen = len;                   // 길이 저장
  step = 0;                       // 처음부터
  stepStart = millis();           // 시작 시각 기록
  digitalWrite(BUZ_PIN, HIGH);    // 첫 단계는 켜짐
}

void setup() {
  Serial.begin(57600);            // USB 시리얼 시작
  pinMode(BUZ_PIN, OUTPUT);       // 부저 핀 출력
  digitalWrite(BUZ_PIN, LOW);     // 처음에는 끔
  Serial.println("M3 ready: 1 2 3");
}

void loop() {
  if (Serial.available() > 0) {   // 받은 글자가 있으면
    char c = Serial.read();       // 한 글자 읽기
    if (c == '1') play(P_BEEP, 1);    // 삑
    if (c == '2') play(P_ALARM, 10);  // 경보
    if (c == '3') play(P_SOS, 17);    // SOS
    if (c >= '1' && c <= '3') {       // 유효한 입력이면
      Serial.print("play ");          // 에코 출력
      Serial.println(c);
    }
  }
  if (pat != 0 && millis() - stepStart >= (unsigned long)pat[step]) { // 단계 시간이 끝나면
    step++;                       // 다음 단계로
    stepStart = millis();         // 시작 시각 갱신
    if (step >= patLen) {         // 패턴이 끝났으면
      pat = 0;                    // 재생 종료
      digitalWrite(BUZ_PIN, LOW); // 부저 끄기
    } else {
      digitalWrite(BUZ_PIN, step % 2 == 0 ? HIGH : LOW); // 짝수 단계는 켜짐, 홀수는 꺼짐
    }
  }
}
