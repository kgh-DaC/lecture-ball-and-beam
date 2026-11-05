// 몬테카를로 강건성 시험 Worker(모듈 Worker). 화면·제어 루프를 막지 않도록 실행을 여기서 돌린다.
// 받음 { type:'start', spec } | { type:'stop' }  /  보냄 { type:'started' } | { type:'progress', items } | { type:'done', payload, stopped } | { type:'error', message }
// 모든 데이터는 이 브라우저 안에서만 오간다(외부 전송 없음).

import { createMcJob } from './mc-job.js';

let job = null, stopped = false;

function loop() {
  try {
    if (!stopped && !job.done) {
      const items = job.step(2);
      if (items.length) self.postMessage({ type: 'progress', items });
    }
    if (stopped || job.done) { self.postMessage({ type: 'done', payload: job.result(), stopped }); job = null; return; }
    setTimeout(loop, 0); // stop 메시지를 받을 틈
  } catch (e) {
    self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) });
  }
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'start') {
    try {
      stopped = false;
      job = createMcJob(m.spec);
      self.postMessage({ type: 'started', total: job.total });
      setTimeout(loop, 0);
    } catch (e) { self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) }); }
  } else if (m.type === 'stop') {
    stopped = true;
  }
};
