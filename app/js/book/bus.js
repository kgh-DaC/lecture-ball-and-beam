// 위젯 공유 채널 (chapter-format §3.1 bind). 같은 챕터 안에서 같은 bind 이름 = 같은 상태.
// 상태 키: { plant, controller, delay_s, alpha, Ts_s, spec }

export class Bus {
  constructor() { this.channels = new Map(); }
  channel(name) {
    if (!this.channels.has(name)) {
      let state = {};
      const subs = new Set();
      this.channels.set(name, {
        get: () => state,
        set: (partial, src) => {
          state = { ...state, ...partial };
          for (const f of subs) { if (f.__src !== src) { try { f(state, partial, src); } catch (e) { console.error(e); } } }
        },
        /** fn(state, partial, src). 자기 자신이 보낸 변경을 무시하려면 set(partial, token) 후 subscribe(fn, token) */
        subscribe: (fn, src) => { fn.__src = src; subs.add(fn); return () => subs.delete(fn); },
      });
    }
    return this.channels.get(name);
  }
  clear() { this.channels.clear(); }
}
