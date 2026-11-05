// AI 학습 실행기: 모듈 Worker가 있으면 Worker에서, 없으면(file:// 열기, 오래된 브라우저, Node 시험) 주 스레드에서
// setTimeout 청크로 job.step()을 돌린다. 어느 쪽이든 화면 갱신 사이에 틈이 생겨 UI가 멈추지 않는다.
//
// startTask(spec, { onProgress(items, all), onDone(payload, { stopped, history, mode, elapsed_ms }), onError(msg) })
//   → { stop() /* 지금까지 결과로 끝냄 */, cancel() /* 결과 버림 */, mode, running }

import { buildTask } from './tasks.js';

function canUseWorker() {
  if (typeof Worker !== 'function') return false;
  try { if (typeof location !== 'undefined' && location.protocol === 'file:') return false; } catch { /* 무시 */ }
  return true;
}

export function startTask(spec, { onProgress = () => {}, onDone = () => {}, onError = () => {}, preferWorker = true } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const all = [];
  const h = { mode: null, running: true, stop() {}, cancel() {} };
  const progress = (items) => { all.push(...items); try { onProgress(items, all); } catch (e) { console.error(e); } };
  const done = (payload, stopped) => {
    if (!h.running) return;
    h.running = false;
    try { onDone(payload, { stopped, history: all, mode: h.mode, elapsed_ms: now() - t0 }); } catch (e) { console.error(e); onError(e.message); }
  };
  const fail = (msg) => { if (!h.running) return; h.running = false; onError(msg); };

  const runMain = () => {
    h.mode = 'main';
    let task;
    try { task = buildTask(spec, 'main'); } catch (e) { fail(e.message); return; }
    let stopped = false, cancelled = false, sent = 0, timer = null;
    const loop = () => {
      timer = null;
      if (cancelled) return;
      try {
        if (!stopped && !task.job.done) task.job.step(task.budget);
        const hist = task.job.history;
        if (hist.length > sent) { progress(hist.slice(sent)); sent = hist.length; }
        if (stopped || task.job.done) { done(task.finish(), stopped); return; }
      } catch (e) { fail(e.message); return; }
      timer = setTimeout(loop, 0);
    };
    h.stop = () => { stopped = true; if (!timer) loop(); };
    h.cancel = () => { cancelled = true; h.running = false; if (timer) clearTimeout(timer); };
    timer = setTimeout(loop, 0);
  };

  if (preferWorker && canUseWorker()) {
    let w;
    try { w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch { w = null; }
    if (w) {
      h.mode = 'worker';
      let started = false;
      w.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === 'started') started = true;
        else if (m.type === 'progress') progress(m.items);
        else if (m.type === 'done') { done(m.payload, m.stopped); w.terminate(); }
        else if (m.type === 'error') { fail(m.message); w.terminate(); }
      };
      w.onerror = (ev) => {
        // 모듈 Worker를 못 여는 환경: 주 스레드로 대체
        if (ev && ev.preventDefault) ev.preventDefault();
        w.terminate();
        if (!started && h.running) { console.warn('AI Worker를 열지 못해 주 스레드에서 학습합니다', ev && ev.message); runMain(); }
        else fail(ev && ev.message ? ev.message : 'Worker 실행 실패');
      };
      h.stop = () => w.postMessage({ type: 'stop' });
      h.cancel = () => { h.running = false; w.terminate(); };
      w.postMessage({ type: 'start', spec });
      return h;
    }
  }
  runMain();
  return h;
}
