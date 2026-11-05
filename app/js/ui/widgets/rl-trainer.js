// rl-trainer: 강화학습 학습기(17장 mode 'q' = 표 Q-러닝, 18장 mode 'es' = 신경망 정책 진화 전략; ai-extension §3).
// job(createQLearner / createES)을 Worker(없으면 주 스레드 청크)로 돌리고, 진행을 '__ai_progress' 채널로 reward-curve에 보낸다.
// 끝나면 registerPolicy('user-q' | 'user-nn')로 제어기(q-policy / nn-policy, policy: 'user')에 넘기고 같은 챕터 위젯(q-table-view, policy-map, nn-viz)에 알린다.

import { h, checkProps, clear, infoBox, warnBox, fmt, toast, download, pickFile } from '../dom.js';
import { head, kv, sendToPractice } from './_util.js';
import { loadAI, aiState, aiProgress, parseList, describePolicy } from '../ai/lib.js';
import { startTask } from '../ai/runner.js';

export const accepts = ['mode', 'episodes', 'iters', 'domain_rand', 'seed', 'hidden', 'pop', 'sigma', 'lr', 'method', 'alpha', 'gamma'];

export async function mount(el, props, ctx) {
  checkProps(el, 'rl-trainer', props, accepts);
  const ai = await loadAI();
  const mode = props.mode === 'es' ? 'es' : 'q';
  const cfg = mode === 'q'
    ? { episodes: props.episodes ?? 3000, alpha: props.alpha ?? 0.05, gamma: props.gamma ?? 0.98, seed: props.seed ?? 1, domain_rand: !!props.domain_rand }
    : { iters: props.iters ?? 120, pop: props.pop ?? 24, sigma: props.sigma ?? 0.1, lr: props.lr ?? 0.05, hidden: parseList(props.hidden, [8]), method: props.method || 'openai-es', seed: props.seed ?? 1, domain_rand: !!props.domain_rand };
  el.appendChild(head(mode === 'q' ? '강화학습: 표 Q-러닝' : '강화학습: 신경망 정책 + 진화 전략',
    h('span', { class: 'muted' }, mode === 'q' ? '상태 (e, v) 칸, 행동 = 서보 각도 후보, ε-탐욕 [시뮬레이션]' : '정책 u = u_lim·tanh(MLP(e, v, u_prev)), 대칭 섭동 ES [시뮬레이션]')));
  const need = mode === 'q' ? ai.qlearn : ai.es;
  if (!need || !ai.policy) { el.appendChild(infoBox(`학습 모듈(control/ai/${mode === 'q' ? 'qlearn' : 'es'}.js)을 불러오지 못했습니다.`)); return {}; }

  const form = h('div', { class: 'row' });
  const ctl = h('div', { class: 'row' });
  const bar = h('progress', { max: 1, value: 0, style: { width: '100%' } });
  const read = h('div', { class: 'readout' });
  const msg = h('div');
  el.append(form, ctl, bar, read, msg);

  const num = (key, label, step, unit = '', title = '') => h('label', { title }, `${label} `, h('input', { type: 'number', step, value: cfg[key], class: 'num',
    onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) cfg[key] = v; } }), unit ? ` ${unit}` : '');
  if (mode === 'q') form.append(num('episodes', '에피소드', 100, '', '에피소드 1개 = 10 s 시뮬레이션'), num('alpha', '학습률 α', 0.01), num('gamma', '할인율 γ', 0.01), num('seed', '시드', 1));
  else {
    form.append(num('iters', '반복(세대)', 10), num('pop', '집단 크기', 2), num('sigma', '섭동 σ', 0.01), num('lr', '학습률', 0.01),
      h('label', null, '은닉층 ', h('input', { type: 'text', size: 5, value: cfg.hidden.join(','), onchange: (e) => { const a = parseList(e.target.value, []); if (a.length && a.every((x) => x >= 1 && x <= 64)) cfg.hidden = a.map(Math.round); else toast('은닉층은 1~64 정수를 쉼표로', 'warn'); } })),
      h('label', null, '방법 ', h('select', { onchange: (e) => { cfg.method = e.target.value; } }, [['openai-es', 'OpenAI-ES'], ['cem', 'CEM']].map(([v, t]) => h('option', { value: v, selected: v === cfg.method }, t)))),
      num('seed', '시드', 1));
  }
  form.append(h('label', { title: '에피소드마다 K_b 0.8~1.2배, 서보 τ 0.04~0.10 s, 지연 0~0.04 s, 잡음 0~2 mm' },
    h('input', { type: 'checkbox', checked: cfg.domain_rand, onchange: (e) => { cfg.domain_rand = e.target.checked; } }), ' 도메인 랜덤화'));

  let run = null, result = null, last = null;
  const prog = aiProgress(ctx);
  const label = mode === 'q' ? 'Q-러닝' : 'ES';
  const total = () => (mode === 'q' ? Math.round(cfg.episodes) : Math.round(cfg.iters));

  const showRead = (p, info = '') => {
    clear(read);
    if (!p) { read.append(h('span', { class: 'kv muted' }, '“학습 시작”을 누르면 백그라운드에서 학습합니다. 진행은 아래 보상 곡선에 그려집니다.')); return; }
    if (mode === 'q') {
      read.append(kv('에피소드', p.iter), kv('ε', p.epsilon), kv('최근 50 평균 return', p.mean_return_50), kv('최근 50 성공률', p.success_rate_50 == null ? null : p.success_rate_50 * 100, '%'),
        kv('방문한 칸', p.visited_frac == null ? null : p.visited_frac * 100, '%'), kv('탐욕 평가 최고', Number.isFinite(p.best_greedy_return) ? p.best_greedy_return : null));
    } else {
      read.append(kv('반복', p.iter), kv('집단 평균 return', p.mean_return), kv('중심 정책 return', p.center_return), kv('최고 중심 return', p.best_center_return), kv('σ', p.sigma), kv('|∇|', p.grad_norm));
    }
    if (info) read.append(h('span', { class: 'kv muted' }, info));
  };

  const publish = (json, origin) => {
    result = json;
    try { ai.policy.registerPolicy(mode === 'q' ? 'user-q' : 'user-nn', json); } catch (e) { msg.appendChild(warnBox(`정책을 등록하지 못했습니다: ${e.message}`)); return false; }
    aiState(ctx).set(mode === 'q' ? { q: json, last_policy: json, last_policy_kind: 'q' } : { nn: json, last_policy: json, last_policy_kind: 'es' });
    saveBtn.disabled = false; sendBtn.disabled = false;
    msg.appendChild(infoBox(`${origin}: ${describePolicy(json)}. 실습 패널에서 ${mode === 'q' ? 'q-policy' : 'nn-policy'}의 정책을 "user"로 고르면 이 결과로 실행됩니다(이 탭을 닫으면 사라지니 필요하면 내려받으세요).`));
    return true;
  };

  const start = () => {
    if (run && run.running) return;
    clear(msg);
    const env = cfg.domain_rand ? { domain: true } : {};
    const spec = mode === 'q'
      ? { kind: 'qlearn', opts: { env, seed: Math.round(cfg.seed), q: { episodes: Math.max(10, Math.round(cfg.episodes)), alpha: cfg.alpha, gamma: cfg.gamma, eval_every: Math.max(50, Math.round(cfg.episodes / 20)) } } }
      : { kind: 'es', opts: { env, seed: Math.round(cfg.seed), iters: Math.max(1, Math.round(cfg.iters)), pop: Math.max(2, 2 * Math.round(cfg.pop / 2)), sigma: cfg.sigma, lr: cfg.lr, hidden: cfg.hidden, method: cfg.method } };
    const history = [];
    bar.max = total(); bar.value = 0;
    startBtn.disabled = true; stopBtn.disabled = false;
    prog.set({ kind: mode === 'q' ? 'qlearn' : 'es', label: `내 ${label}${cfg.domain_rand ? ' (랜덤화)' : ''}`, history, last: null, running: true, started_at: Date.now() });
    run = startTask(spec, {
      onProgress: (items) => {
        history.push(...items);
        last = items[items.length - 1];
        bar.value = last.iter;
        showRead(last, run.mode === 'worker' ? '백그라운드(Worker)' : '주 스레드 청크');
        prog.set({ history, last, running: true });
      },
      onDone: (payload, info) => {
        startBtn.disabled = false; stopBtn.disabled = true;
        prog.set({ history, last, running: false });
        const json = mode === 'q' ? payload.table : payload.policy;
        msg.appendChild(h('div', { class: 'muted' }, `${info.stopped ? '중간에 멈춤' : '학습 완료'} · ${history.length} ${mode === 'q' ? '에피소드' : '반복'}, ${fmt(info.elapsed_ms / 1000, 1)} s`));
        if (json) publish(json, '내 학습 결과');
      },
      onError: (m) => { startBtn.disabled = false; stopBtn.disabled = true; prog.set({ running: false }); msg.appendChild(warnBox(`학습을 끝내지 못했습니다: ${m}`)); },
    });
  };

  const startBtn = h('button', { class: 'btn primary', onclick: start }, '학습 시작');
  const stopBtn = h('button', { class: 'btn', disabled: true, onclick: () => run && run.stop() }, '멈추기(지금까지 결과 사용)');
  const saveBtn = h('button', { class: 'btn', disabled: true, onclick: () => { if (result) download(`${mode === 'q' ? 'q-table' : 'nn-policy'}-${Date.now()}.json`, JSON.stringify(result), 'application/json'); } }, '정책 내려받기(JSON)');
  const loadBtn = h('button', { class: 'btn', onclick: async () => {
    const files = await pickFile('.json,application/json');
    const f = files && files[0];
    if (!f) return;
    clear(msg);
    try {
      const json = JSON.parse(await f.text());
      const want = mode === 'q' ? 'q-table' : 'nn-policy';
      if (json.format !== want) throw new Error(`format이 ${want}가 아닙니다(${json.format})`);
      ai.policy.policyFromJSON(json);
      publish(json, `불러온 정책(${f.name})`);
    } catch (e) { msg.appendChild(warnBox(`정책 파일을 읽지 못했습니다: ${e.message}`)); }
  } }, '정책 불러오기');
  const sendBtn = h('button', { class: 'btn', disabled: true, onclick: () => {
    const id = mode === 'q' ? 'q-policy' : 'nn-policy';
    sendToPractice(ctx, { id, params: { policy: 'user' } });
    toast(`실습 패널을 ${id}(policy: user)로 맞췄습니다`, 'ok');
  } }, '실습 패널에 보내기');
  ctl.append(startBtn, stopBtn, saveBtn, loadBtn, sendBtn);
  showRead(null);
  return { unmount() { if (run && run.running) { run.cancel(); prog.set({ running: false }); } }, start, stop: () => run && run.stop() };
}
