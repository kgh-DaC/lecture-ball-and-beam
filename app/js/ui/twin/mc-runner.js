// 몬테카를로 실행기: 모듈 Worker가 있으면 Worker에서, 없으면(file:// 열기, Node 시험, Worker 실패) 주 스레드에서
// setTimeout 청크(실행 1개씩)로 돈다. 어느 쪽이든 화면이 멈추지 않는다(ui/ai/runner.js 와 같은 방식).
//
// startMonteCarlo(spec, { onProgress(items, all), onDone(result, { stopped, mode, elapsed_ms }), onError(msg), preferWorker })
//   → { stop() /* 지금까지 결과로 끝냄 */, cancel() /* 결과 버림 */, mode, running }

import { createMcJob } from './mc-job.js';

function canUseWorker() {
  if (typeof Worker !== 'function') return false;
  try { if (typeof location !== 'undefined' && location.protocol === 'file:') return false; } catch { /* 무시 */ }
  return true;
}

export function startMonteCarlo(spec, { onProgress = () => {}, onDone = () => {}, onError = () => {}, preferWorker = true } = {}) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const all = [];
  const h = { mode: null, running: true, total: null, stop() {}, cancel() {} };
  const progress = (items) => { all.push(...items); try { onProgress(items, all); } catch (e) { console.error(e); } };
  const done = (payload, stopped) => {
    if (!h.running) return;
    h.running = false;
    try { onDone(payload, { stopped, mode: h.mode, elapsed_ms: now() - t0 }); } catch (e) { console.error(e); onError(e.message); }
  };
  const fail = (msg) => { if (!h.running) return; h.running = false; onError(msg); };

  const runMain = () => {
    h.mode = 'main';
    let job;
    try { job = createMcJob(spec); } catch (e) { setTimeout(() => fail(e.message), 0); return; }
    h.total = job.total;
    let stopped = false, cancelled = false, timer = null;
    const loop = () => {
      timer = null;
      if (cancelled) return;
      try {
        if (!stopped && !job.done) { const items = job.step(1); if (items.length) progress(items); }
        if (stopped || job.done) { done(job.result(), stopped); return; }
      } catch (e) { fail(e.message); return; }
      timer = setTimeout(loop, 0);
    };
    h.stop = () => { stopped = true; if (!timer) loop(); };
    h.cancel = () => { cancelled = true; h.running = false; if (timer) clearTimeout(timer); };
    timer = setTimeout(loop, 0);
  };

  if (preferWorker && canUseWorker()) {
    let w;
    try { w = new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' }); } catch { w = null; }
    if (w) {
      h.mode = 'worker';
      let started = false;
      w.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === 'started') { started = true; h.total = m.total; }
        else if (m.type === 'progress') progress(m.items);
        else if (m.type === 'done') { done(m.payload, m.stopped); w.terminate(); }
        else if (m.type === 'error') { fail(m.message); w.terminate(); }
      };
      w.onerror = (ev) => {
        if (ev && ev.preventDefault) ev.preventDefault();
        w.terminate();
        if (!started && h.running) { console.warn('몬테카를로 Worker를 열지 못해 주 스레드에서 실행합니다', ev && ev.message); runMain(); }
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
