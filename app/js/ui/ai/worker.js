// AI 학습 Worker(모듈 Worker). 주 스레드(화면·제어 루프)를 막지 않도록 job.step()을 여기서 돌린다.
// 메시지: 받음 { type:'start', spec } | { type:'stop' }  /  보냄 { type:'progress', items } | { type:'done', payload, stopped } | { type:'error', message }
// 모든 데이터는 이 브라우저 안에서만 오간다(외부 전송 없음).

import { buildTask } from './tasks.js';

let task = null, stopped = false, sent = 0;

function flush() {
  const h = task.job.history;
  if (h.length > sent) { self.postMessage({ type: 'progress', items: h.slice(sent) }); sent = h.length; }
}

function loop() {
  try {
    if (!stopped && !task.job.done) task.job.step(task.budget);
    flush();
    if (stopped || task.job.done) { self.postMessage({ type: 'done', payload: task.finish(), stopped }); task = null; return; }
    setTimeout(loop, 0); // stop 메시지를 받을 틈
  } catch (e) {
    self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) });
  }
}

self.onmessage = (ev) => {
  const m = ev.data || {};
  if (m.type === 'start') {
    try {
      stopped = false; sent = 0;
      task = buildTask(m.spec, 'worker');
      self.postMessage({ type: 'started' });
      setTimeout(loop, 0);
    } catch (e) { self.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) }); }
  } else if (m.type === 'stop') {
    stopped = true;
  }
};
