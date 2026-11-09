# 볼앤빔 웹 교재 앱

빌드 도구 없이 여는 웹 앱(`index.html` + ES 모듈). 모든 데이터는 이 브라우저(IndexedDB·localStorage)에만 저장되고 외부로 보내지 않는다. 외부 CDN을 쓰지 않는다(KaTeX는 `vendor/`).

## 실행
저장소 **최상위**에서 로컬 서버를 띄운다(교재 파일 `curriculum/`, 샘플 `data/samples/`를 같이 읽기 때문).

```
python -m http.server 8000
```
브라우저에서 `http://localhost:8000/app/` 을 연다.

- 실제 장치(Web Serial): Chrome·Edge 데스크톱에서만. `localhost` 또는 https에서만 동작한다.
- 하드웨어가 없거나 다른 브라우저: 실습 패널에서 **가상 장치**(같은 프로토콜을 흉내 내는 시뮬레이터) 또는 **샘플 재생**을 고른다. 가상 장치 데이터는 항상 `시뮬레이션` 배지가 붙고 실측 샘플보다 앞서지 않는다.
- 비상 정지: 상단 빨간 버튼 또는 `Esc`(대기 중 명령을 지우고 `M,0` 전송).

## 화면
| 경로 | 내용 |
|---|---|
| `#/ch/<챕터 id>` | 교재 챕터(왼쪽 목차). 본문 안 위젯은 `js/ui/widgets/<이름>.js` |
| `#/settings` | 연결, 하드웨어 점검 순서(`hardware-steps`), A 조립 전(포텐쇼미터 매핑 시험 — 펌웨어 1.2.0 벤치 모드, 서보 90° 고정), B 조립 후(수평 trim, 실제 거리 vs 초음파 측정 거리 검증, 신호 확인, 각도 한계, 방향·수평), 보정 기록(포텐쇼미터 서보각 ↔ A0, 수평 서보각 → trim, 공 크기·초음파 좌표 규약, 거리 검증 기록, 사용자 입력·수정·적용, localStorage), 장치 설정(저장된 설정이 없으면 사용자 장치 프로필 제안), 서보 프리셋, 캘리브레이션 기록 |
| `#/sessions` | 내 세션 목록, 여러 세션 겹쳐 비교·지표 표, ZIP 내보내기/불러오기, CSV, 승격 |
| `#/samples` | 샘플 목록(내 실측 > 실측 > 내 시뮬레이션 > 시뮬레이션), 미리보기, 점수 가중치, 배포용 내보내기 |

## 포텐쇼미터 기본 보정과 가상 장치
- HS-5645MG 기본 보정 = 사용자 실측(2026-11-04): 서보각 0/90/180° → A0 60/330/598(각 10회 평균). 최소제곱 2.989 LSB/°, 90° raw 329.3. **서보 혼 각도 기준**이며 빔 수평은 조립 후 trim으로 맞춘다. 예전 슬라이드 67 임시값(raw 감소 방향)은 배선 방향이 다른 장치의 값이다(`js/config/servo-presets.js`).
- pot → 명령 좌표 각(러너 `servo_pot_cdeg`, 제어기 `theta_rad`, 식별·각도 한계 위젯): 펌웨어 `서보각 = 90° + trim/100 + dir·cmd/100`을 뒤집어 **θ_cmd = dir·((서보각 − 90°)·100 − trim)**. 서보각은 보정 직선으로 raw에서 구한 혼 각도, trim·dir는 장치가 보고한 값(없으면 저장된 설정). 세션 메타 `calibration`에 쓴 `trim_cdeg`·`dir`·`basis`가 남는다(`docs/spec/data-schema.md` §4.2). trim 0·dir 1이면 예전 식과 같다.
- 수평(trim): 명령 0에서 서보각 = 90° + trim/100 이므로 **trim = (수평 서보각 − 90°) × 100 cdeg**(±15° → 75°~105°). 사용자 장치 실측(2026-11-04): 공이 흘러가지 않는 서보각 83° → trim −700, dir 1(A0 기대 ≈ 308.4). 번들 기본 장치 설정은 trim 0 그대로(가상 장치·트윈 기구는 trim 0이 수평)이고, 저장된 장치 설정이 없으면 장치 설정·`#/settings` 수평 기록 표에서 이 "사용자 장치 프로필"을 제안한다(한 번 클릭 적용). `level-trim` 위젯에서 수평 서보각을 직접 넣어 적용·저장할 수 있다.
- 공 크기·초음파 거리 규약(사용자 실측 2026-11-05): 공 지름 52 mm → **반지름 R = 26 mm**(`#/settings` 공 크기 기록, 고치면 덮어쓴 값·수정 취소). 초음파가 재는 거리 = 센서 앞면 → 공의 **가까운 표면**이고 **공 중심 = 측정 거리 + 26 mm**. 제어·설정값·세션 CSV(`y_mm`·`y_filt_mm`·`ref_mm`)·가상 장치·트윈 거리는 모두 측정 거리 그대로(상수 오프셋이라 동역학 불변)이며, 세션 메타에 `ball_radius_mm`·`distance_convention: "surface"`가 남는다. 실시간 그래프·신호 확인의 "좌표 보기"로 공 중심을 볼 수 있다(화면 전용, `js/ui/coord.js`).
- 실제 거리 vs 초음파 측정 거리 검증(`sensor-position-test`, 점검 ⑥): 줄자로 잰 거리와 "무엇까지 쟀는지"(공 표면 / 공 중심 → − 26 mm 환산)를 넣고 위치별 측정 평균·σ·튄 값·오차(실제 − 측정)·직선 맞춤·공 중심을 본다. 판정 기준(평균 |오차| ≤ 5 mm, 기울기 0.98~1.02는 제안값)과 해석(상수 오차 → 센서 위치·영점, 기울기 → 음속·온도)은 `js/ui/hwtest.js`. 가상 장치에서는 "공 옮겨 놓기"와 시험용 센서 오차 주입(상수·배율, `VirtualDevice.setSensorError`)으로 판정을 시험할 수 있다.
- 가상 장치 기본 펌웨어 판은 1.2.0(벤치 모드 `P,bench` 포함, `virtual-1.2.0`). 포텐쇼미터는 위 실측 직선 + 잡음으로 흉내 낸다.

## 구조
```
js/main.js            서비스 조립(장치·러너·저장소·샘플·진도·제어 모듈)
js/book/              교재 셸, 마크다운 렌더러(:::part 이론/실습), bind 채널
js/serial/            Web Serial, 파서, 명령 큐(writer), 장치 관리자
js/sim/               가상 장치(control/simulate.js의 stepPlant 재사용)
js/loop/              러너(D 수신 구동 제어 루프, 단위 변환 한 곳, 하트비트, 비상 정지)
js/store/             세션·CSV·ZIP·IndexedDB·지표(metrics.js)·점수(best.js)·샘플·진도
js/ui/                DOM·그래프·막대·파라미터 편집기·출처 해석(sources.js)
js/ui/widgets/        교재 위젯 47종(하드웨어 구성 3종, AI 제어 9종 포함, _util.js 공용 도우미)
js/ui/ai/             AI 위젯 공용: 학습 실행기(runner.js: 모듈 Worker → 없으면 주 스레드 청크), worker.js, tasks.js, 번들·채널 도우미(lib.js)
js/ui/heatmap.js      Q 표·정책 지도용 칸 그림
js/ui/jog.js          하드웨어 구성용 조그(HOST 모드, 하트비트, 램프, 비상 정지)
js/ui/coord.js        거리 좌표 보기(측정 거리(표면) / 공 중심 = 측정 + R), 화면 전용
js/ui/practice.js     practice 해석(제어기별 safe_defaults, 진도 판정 규칙)
js/ui/panels/         #/settings, #/sessions, #/samples
js/control/           제어기·모델·분석(control-engineer 담당)
```

## 시험(브라우저 없이)
```
node --test tests/web/*.test.mjs
```
`tests/web/dom-shim.mjs`가 최소 DOM을 흉내 내어 모든 챕터 위젯을 실제 props로 마운트해 본다. 캔버스 그림·배치·실제 Web Serial·브라우저 IndexedDB는 확인하지 않는다(브라우저에서 확인 필요). AI 학습은 Node에 Worker가 없어 주 스레드 청크 경로로 시험한다.

## AI 학습(16~20장)
학습 버튼은 모듈 Worker에서 돌아 화면과 제어 루프를 막지 않는다. `python -m http.server`로 열어야 Worker가 뜬다(file://로 열면 주 스레드 청크로 대신 돌아 조금 끊길 수 있다). 학습한 정책은 이 탭 안에서만 제어기(`policy: user`)에 연결되며, 남기려면 "정책 내려받기(JSON)"로 저장했다가 "정책 불러오기"로 다시 올린다. 모든 학습·데이터는 브라우저 안에서만 처리된다.

## 교수자 도구
```
node tools/merge_sample.js sample_<id>.zip        # 앱 "배포용 내보내기" ZIP을 data/samples에 병합
node tools/pick_best_sample.js data/samples       # 지표·슬롯 점수 재계산(--dry-run: 쓰지 않음)
```
