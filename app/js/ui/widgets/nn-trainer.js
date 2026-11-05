// nn-trainer: 신경망 시스템 식별 학습(16장, ai-extension §3). generateDataset → createIdTrainer job을 Worker(없으면 청크)로 돌리고
// 에폭별 학습/검증 손실(로그축 = log10)을 그린다. "번들 결과 불러오기" = data/ai/nn-id.json, "과적합 시연" = nn-id-overfit.json.
// 학습이 끝나면 같은 챕터의 nn-viz·nn-model-compare가 '내가 학습한 망'을 쓸 수 있게 채널(__ai)에 올린다.

import { h, checkProps, clear, infoBox, warnBox, fmt, toast, download } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, kv } from './_util.js';
import { loadAI, loadBundle, aiState, parseList } from '../ai/lib.js';
import { startTask } from '../ai/runner.js';

export const accepts = ['n_samples', 'noise_mm', 'hidden', 'epochs', 'lr', 'optimizer', 'activation', 'allow_edit', 'l2', 'seed'];

export async function mount(el, props, ctx) {
  checkProps(el, 'nn-trainer', props, accepts);
  const ai = await loadAI();
  const cfg = {
    n_samples: props.n_samples ?? 3000, noise_mm: props.noise_mm ?? 0, hidden: parseList(props.hidden, [32, 32]),
    epochs: props.epochs ?? 150, lr: props.lr ?? 0.003, optimizer: props.optimizer || 'adam', activation: props.activation || 'tanh',
    l2: props.l2 ?? 0, seed: props.seed ?? 1,
  };
  const edit = props.allow_edit !== false;
  el.appendChild(head('신경망 식별 학습', h('span', { class: 'muted' }, '입력 [y, ẏ, θ, u, u_prev] → 출력 Δ[y, ẏ, θ] · 가상 장치 데이터 [시뮬레이션]')));
  if (!ai.nnId || !ai.mlp) { el.appendChild(infoBox('신경망 식별 모듈(control/ai/nn-id.js)을 불러오지 못했습니다.')); return {}; }

  const form = h('div', { class: 'row' });
  const ctl = h('div', { class: 'row' });
  const bar = h('progress', { max: 1, value: 0, style: { width: '100%' } });
  const msg = h('div');
  const read = h('div', { class: 'readout' });
  el.append(form, ctl, bar, read, msg);
  const pL = new Plot(el, { height: props.height_px || 230, xLabel: '에폭', yLabel: 'log₁₀ 손실 (정규화 MSE)' });

  // 입력란
  const num = (key, label, step, unit = '') => h('label', null, `${label} `, h('input', { type: 'number', step, value: cfg[key], class: 'num', disabled: !edit,
    onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) cfg[key] = v; } }), unit ? ` ${unit}` : '');
  const sel = (key, label, opts) => h('label', null, `${label} `, h('select', { disabled: !edit, onchange: (e) => { cfg[key] = e.target.value; } },
    opts.map(([v, t]) => h('option', { value: v, selected: v === cfg[key] }, t))));
  form.append(
    num('n_samples', '데이터 수', 100), num('noise_mm', '측정 잡음 σ', 0.5, 'mm'),
    h('label', null, '은닉층 ', h('input', { type: 'text', value: cfg.hidden.join(','), size: 7, disabled: !edit, title: '쉼표로 층별 뉴런 수(예: 32,32)',
      onchange: (e) => { const a = parseList(e.target.value, []); if (a.length && a.every((x) => x >= 1 && x <= 256)) cfg.hidden = a.map(Math.round); else toast('은닉층은 1~256 사이 정수를 쉼표로 적으세요', 'warn'); } })),
    num('epochs', '에폭', 10), num('lr', '학습률', 0.001),
    sel('optimizer', '최적화', [['adam', 'Adam'], ['sgd', 'SGD(모멘텀)']]), sel('activation', '활성화', [['tanh', 'tanh'], ['relu', 'ReLU']]),
    num('l2', 'L2', 0.0001));

  let run = null, result = null, curves = [];
  const draw = () => {
    const ser = [];
    curves.forEach((c, i) => {
      const x = c.history.map((p) => p.iter);
      ser.push({ label: `${c.label} 학습`, x, y: c.history.map((p) => Math.log10(p.train_loss)), ...styleOf(2 * i), width: 1.8 });
      ser.push({ label: `${c.label} 검증`, x, y: c.history.map((p) => Math.log10(p.val_loss)), ...styleOf(2 * i + 1), width: 2.2 });
    });
    pL.setSeries(ser);
    const last = curves[curves.length - 1];
    const be = last && last.best_epoch;
    pL.setAnnotations(be ? [{ type: 'vline', x: be, color: '#009E73', label: `최저 검증 에폭 ${be}` }] : []);
  };
  const showRead = (c, extra = []) => {
    clear(read);
    const h1 = c.history[c.history.length - 1] || {};
    read.append(kv('에폭', h1.iter ?? 0), kv('학습 손실', h1.train_loss, ''), kv('검증 손실', h1.val_loss, ''), kv('최저 검증 에폭', c.best_epoch ?? '–'), ...extra);
  };
  // 과적합 신호: 검증 손실(10 에폭 이동 평균)이 최저점보다 30 % 넘게 올랐는데 학습 손실은 그동안 더 줄었을 때
  const overfitHint = (hist) => {
    if (hist.length < 20) return null;
    const n = 10;
    const sm = (k) => hist.map((_, i) => { const a = hist.slice(Math.max(0, i - n + 1), i + 1); return a.reduce((s, p) => s + p[k], 0) / a.length; });
    const va = sm('val_loss'), tr = sm('train_loss');
    let ib = n - 1;
    for (let i = n - 1; i < va.length; i++) if (va[i] < va[ib]) ib = i;
    const L = va.length - 1;
    if (va[L] > va[ib] * 1.3 && tr[L] < tr[ib]) return warnBox(`과적합 신호: 학습 손실은 계속 줄지만 검증 손실(10 에폭 평균)은 에폭 ${hist[ib].iter} 뒤로 ${fmt((va[L] / va[ib] - 1) * 100, 0)}% 늘었습니다. 결과 망은 검증 손실이 가장 낮았던 시점(조기 종료)의 것입니다.`);
    return null;
  };

  const startBtn = h('button', { class: 'btn primary', onclick: () => start() }, '학습 시작');
  const stopBtn = h('button', { class: 'btn', disabled: true, onclick: () => run && run.stop() }, '멈추기(지금까지 결과 사용)');
  const saveBtn = h('button', { class: 'btn', disabled: true, onclick: () => {
    if (!result) return;
    download(`nn-id-${Date.now()}.json`, JSON.stringify(result.model), 'application/json');
  } }, '학습한 망 내려받기(JSON)');
  ctl.append(startBtn, stopBtn,
    h('button', { class: 'btn', onclick: () => loadB('nn-id', '번들') }, '번들 결과 불러오기'),
    h('button', { class: 'btn', onclick: () => loadB('nn-id-overfit', '과적합 시연', true) }, '과적합 시연 불러오기'),
    saveBtn);

  const loadB = async (name, label, add = false) => {
    clear(msg);
    const b = await loadBundle(ctx, name);
    if (!b || !Array.isArray(b.history)) { msg.appendChild(infoBox(`번들 결과(data/ai/${name}.json)가 아직 없습니다. "학습 시작"으로 직접 학습해 보세요.`)); return; }
    const c = { label, history: b.history, best_epoch: b.meta?.best_epoch ?? b.best_epoch ?? null };
    curves = add ? [...curves.filter((x) => x.label !== label), c] : [c];
    draw();
    const m = b.meta || {};
    showRead(c, [h('span', { class: 'kv muted' }, `데이터 ${m.dataset?.n_samples ?? m.n_samples ?? '–'}개, 잡음 ${fmt(((m.dataset?.noise_m ?? m.noise_m ?? 0) * 1000), 1)} mm, 은닉 ${(m.hidden || []).join(',')}`)]);
    const w = overfitHint(c.history); if (w) msg.appendChild(w);
    msg.appendChild(infoBox(`${label} 학습 곡선 [시뮬레이션]. 같은 조건으로 "학습 시작"을 눌러 직접 재현해 보세요.`));
  };

  const start = () => {
    if (run && run.running) return;
    clear(msg);
    result = null; saveBtn.disabled = true;
    const c = { label: '내 학습', history: [], best_epoch: null };
    curves = curves.filter((x) => x.label !== '내 학습').slice(-1).concat([c]);
    bar.max = cfg.epochs; bar.value = 0;
    startBtn.disabled = true; stopBtn.disabled = false;
    const spec = { kind: 'nn-id', opts: {
      dataset: { n_samples: Math.max(100, Math.round(cfg.n_samples)), noise_m: Math.max(0, cfg.noise_mm) / 1000, seed: cfg.seed },
      train: { hidden: cfg.hidden, activation: cfg.activation, epochs: Math.max(1, Math.round(cfg.epochs)), lr: cfg.lr, optimizer: cfg.optimizer, l2: cfg.l2, seed: cfg.seed },
    } };
    run = startTask(spec, {
      onProgress: (items) => {
        c.history.push(...items);
        const last = items[items.length - 1];
        c.best_epoch = last.best_epoch;
        bar.value = last.iter;
        showRead(c, [h('span', { class: 'kv muted' }, run.mode === 'worker' ? '백그라운드(Worker) 학습' : '주 스레드 청크 학습')]);
        draw();
      },
      onDone: (payload, info) => {
        startBtn.disabled = false; stopBtn.disabled = true;
        result = payload; saveBtn.disabled = false;
        aiState(ctx).set({ nn_id: payload });
        const w = overfitHint(c.history); if (w) msg.appendChild(w);
        msg.appendChild(infoBox(`${info.stopped ? '중간에 멈춤' : '학습 완료'}: ${c.history.length} 에폭, ${fmt(info.elapsed_ms / 1000, 1)} s. 결과 망(최저 검증 에폭 ${payload.model.meta.best_epoch})을 아래 신경망 그림과 모델 비교에서 "내가 학습한 망"으로 볼 수 있습니다.`));
        if (payload.compare && payload.compare.rmse_y_m) {
          const r = payload.compare.rmse_y_m;
          read.append(kv('20스텝 RMSE(NN)', r.nn[2] == null ? null : r.nn[2] * 1000, 'mm'), kv('물리(서보 포함)', r.phys_servo[2] == null ? null : r.phys_servo[2] * 1000, 'mm'));
        }
      },
      onError: (m) => { startBtn.disabled = false; stopBtn.disabled = true; msg.appendChild(warnBox(`학습을 끝내지 못했습니다: ${m}`)); },
    });
  };

  read.append(h('span', { class: 'kv muted' }, '“학습 시작”을 누르면 데이터 생성 → 학습이 백그라운드에서 진행됩니다.'));
  await loadB('nn-id', '번들');
  return { unmount() { if (run && run.running) run.cancel(); pL.destroy(); }, start, stop: () => run && run.stop() };
}
