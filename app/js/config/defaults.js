// 앱 공통 상수
export const APP_VER = '1.0.0';
export const PROTO_VER = 1;
export const BAUD = 115200;
export const HELLO_TIMEOUT_MS = 3000;
export const HEARTBEAT_MS = 200;      // 펌웨어 만료 500 ms보다 충분히 짧게
export const AUTOSAVE_MS = 2000;      // data-schema §2.4
export const FS_MIN_MS = 60;
export const FS_MAX_MS = 200;
export const HARD_LIM_CDEG = 3000;
export const RING_SIZE = 6000;        // 실시간 링 버퍼 행 수(60 ms에서 6분)
export const PATHS = {
  toc: '../curriculum/toc.json',
  chapters: '../curriculum/chapters/',
  assets: '../curriculum/',
  samples: '../data/samples/',
  identification: '../data/identification/',
  ai: '../data/ai/',
  twin: '../data/twin/',
};
