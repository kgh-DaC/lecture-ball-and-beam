// M2 모터 구동: 시리얼로 F/B/L/R/S 와 속도(%) 숫자를 받아 L298P 쉴드의 모터 두 개를 움직인다.
// 배선: 왼쪽 DIR=D12, PWM=D10, BRAKE=D9 / 오른쪽 DIR=D13, PWM=D11 (D8은 초음파 Echo라 사용 안 함). 시리얼 57600bps.
// 테스트: 시리얼 모니터(57600)에서 F, B, L, R, S 또는 F50 처럼 보낸다(F=전진 B=후진 L/R=제자리 회전 S=정지, 숫자=속도 0~100).

#define INVERT_LEFT 0    // 왼쪽 바퀴가 거꾸로 돌면 1로 바꾼다
#define INVERT_RIGHT 0   // 오른쪽 바퀴가 거꾸로 돌면 1로 바꾼다

const int L_DIR = 12;    // 왼쪽 방향 핀
const int L_BRK = 9;     // 왼쪽 브레이크 핀 (LOW로 유지)
const int L_PWM = 10;    // 왼쪽 속도 핀
const int R_DIR = 13;    // 오른쪽 방향 핀
const int R_PWM = 11;    // 오른쪽 속도 핀

char cmd = 'S';          // 마지막으로 받은 명령 글자
int speedPct = 80;       // 속도(%) 기본값 80
bool hasNum = false;     // 명령 뒤에 숫자가 왔는지

// 모터 하나 구동: pct가 양수면 전진, 음수면 후진, 0이면 정지
void drive(int dirPin, int pwmPin, int pct, int invert) {
  if (invert) pct = -pct;                      // 방향 보정
  digitalWrite(dirPin, pct >= 0 ? HIGH : LOW); // 전진이면 HIGH, 후진이면 LOW
  analogWrite(pwmPin, abs(pct) * 255 / 100);   // 퍼센트를 0~255로 바꿔 출력
}

// 현재 명령(cmd)과 속도(speedPct)로 두 모터를 움직인다
void apply() {
  int v = constrain(speedPct, 0, 100);       // 속도를 0~100으로 제한
  int l = 0, r = 0;                          // 왼쪽, 오른쪽 출력
  if (cmd == 'F') { l = v;  r = v;  }        // 전진
  if (cmd == 'B') { l = -v; r = -v; }        // 후진
  if (cmd == 'L') { l = -v; r = v;  }        // 왼쪽 제자리 회전
  if (cmd == 'R') { l = v;  r = -v; }        // 오른쪽 제자리 회전
  drive(L_DIR, L_PWM, l, INVERT_LEFT);       // 왼쪽 모터 구동
  drive(R_DIR, R_PWM, r, INVERT_RIGHT);      // 오른쪽 모터 구동
}

void setup() {
  Serial.begin(57600);        // USB 시리얼 시작
  pinMode(L_DIR, OUTPUT);     // 왼쪽 방향 핀 출력
  pinMode(L_BRK, OUTPUT);     // 왼쪽 브레이크 핀 출력
  pinMode(L_PWM, OUTPUT);     // 왼쪽 속도 핀 출력
  pinMode(R_DIR, OUTPUT);     // 오른쪽 방향 핀 출력
  pinMode(R_PWM, OUTPUT);     // 오른쪽 속도 핀 출력
  digitalWrite(L_BRK, LOW);   // 왼쪽 브레이크 해제
  apply();                    // 시작할 때는 정지 상태
  Serial.println("M2 ready: F B L R S + speed");
}

void loop() {
  if (Serial.available() > 0) {              // 받은 글자가 있으면
    char c = Serial.read();                  // 한 글자 읽기
    if (c == '\r' || c == '\n') {            // 줄바꿈이면
      hasNum = false;                        // 숫자 누적 초기화 (다음 숫자는 새 속도)
      return;                                // 더 할 일 없음
    }
    if (c >= 'a' && c <= 'z') c -= 32;       // 소문자를 대문자로
    if (c >= '0' && c <= '9') {              // 숫자면 속도 입력
      if (!hasNum) speedPct = 0;             // 새 숫자의 첫 글자면 0부터 시작
      hasNum = true;                         // 숫자가 왔다고 표시
      speedPct = speedPct * 10 + (c - '0');  // 자릿수 쌓기
      if (speedPct > 100) speedPct = 100;    // 100% 넘으면 100으로
      Serial.print("speed ");                // 에코 출력
      Serial.println(speedPct);
      apply();                               // 바뀐 속도로 다시 구동
    } else if (c == 'F' || c == 'B' || c == 'L' || c == 'R' || c == 'S') {
      cmd = c;                               // 명령 저장
      speedPct = 80;                         // 새 명령은 기본 속도 80
      hasNum = false;                        // 숫자 입력 상태 초기화
      Serial.print("cmd ");                  // 받은 명령 에코
      Serial.println(c);
      apply();                               // 모터 구동
    }
  }
}
