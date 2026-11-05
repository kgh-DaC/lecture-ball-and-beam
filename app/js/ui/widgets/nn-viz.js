// nn-viz: 신경망 구조·가중치·활성값 그림(16·18·19장, ai-extension §3). describe(net), forwardCache(net, x)만 부른다.
// 선 굵기 = |W|, 선 색 = 부호(파랑 +, 주황 −), 노드 색 = 현재 입력에서의 활성값. 은닉 뉴런이 max_neurons보다 많으면
// 연결 세기(들어오고 나가는 |W| 합)가 큰 것부터 그리고 나머지 수를 적는다. 입력 슬라이더로 활성값이 어떻게 바뀌는지 본다.

import { h, checkProps, clear, infoBox, fmt, slider } from '../dom.js';
import { head, kv } from './_util.js';
import { loadAI, loadBundle, aiState, policyCandidates, SOURCE_LABEL, describePolicy, DEG } from '../ai/lib.js';

export const accepts = ['source', 'max_neurons'];

const POS = '#0072B2', NEG = '#D55E00';
const POLICY_INPUTS = [
  { key: 'e', label: '오차 e', sym: 'e', unit: 'mm', scale: 1000, min: -0.15, max: 0.15, value: 0.03 },
  { key: 'v', label: '속도 v', sym: 'v', unit: 'mm/s', scale: 1000, min: -0.4, max: 0.4, value: 0 },
  { key: 'u_prev', label: '직전 u', sym: 'u_prev', unit: '°', scale: DEG, min: -0.5236, max: 0.5236, value: 0 },
];
const ID_INPUTS = [
  { key: 'y', label: '위치 y', sym: 'y', unit: 'mm', scale: 1000, min: 0.02, max: 0.33, value: 0.15 },
  { key: 'ydot', label: '속도 ẏ', sym: 'ẏ', unit: 'mm/s', scale: 1000, min: -0.5, max: 0.5, value: 0 },
  { key: 'theta', label: '빔 각 θ', sym: 'θ', unit: '°', scale: DEG, min: -0.5236, max: 0.5236, value: 0 },
  { key: 'u', label: '명령 u', sym: 'u', unit: '°', scale: DEG, min: -0.5236, max: 0.5236, value: 0.05 },
  { key: 'u_prev', label: '직전 u', sym: 'u_prev', unit: '°', scale: DEG, min: -0.5236, max: 0.5236, value: 0.05 },
];

/** 그릴 뉴런 고르기: 층마다 최대 maxN개(연결 세기 순) → 원래 순서로 */
export function pickNeurons(net, maxN) {
  return net.sizes.map((n, l) => {
    if (l === 0 || l === net.sizes.length - 1 || n <= maxN) return Array.from({ length: n }, (_, i) => i);
    const imp = new Array(n).fill(0);
    const Win = net.W[l - 1], nin = net.sizes[l - 1];
    for (let i = 0; i < n; i++) for (let j = 0; j < nin; j++) imp[i] += Math.abs(Win[i * nin + j]);
    const Wout = net.W[l];
    for (let k = 0; k < net.sizes[l + 1]; k++) for (let i = 0; i < n; i++) imp[i] += Math.abs(Wout[k * n + i]);
    return imp.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, maxN).map((x) => x[1]).sort((a, b) => a - b);
  });
}

export async function mount(el, props, ctx) {
  checkProps(el, 'nn-viz', props, accepts);
  const ai = await loadAI();
  const source = props.source || 'es';
  const maxN = Math.max(2, props.max_neurons ?? 16);
  el.appendChild(head('신경망 들여다보기', h('span', { class: 'muted' }, `${SOURCE_LABEL[source] || source} · 선 굵기 |W|, 파랑 +, 주황 − · 노드 색 = 활성값 [시뮬레이션]`)));
  if (!ai.mlp || !ai.obs) { el.appendChild(infoBox('신경망 모듈(control/ai/mlp.js)을 불러오지 못했습니다.')); return {}; }
  const pick = h('div', { class: 'row' });
  const msg = h('div');
  const cvWrap = h('div', { class: 'plot' });
  const H = props.height_px || 300;
  const cv = h('canvas', { role: 'img', 'aria-label': '신경망 구조 그림', style: { height: `${H}px`, width: '100%' } });
  cvWrap.appendChild(cv);
  const sliders = h('div');
  const read = h('div', { class: 'readout' });
  el.append(pick, msg, cvWrap, sliders, read);

  let cands = [], cur = null, net = null, kind = 'policy', inputs = [], x = [];

  const candidatesFor = async () => {
    if (source === 'nn-id') {
      const out = [];
      const u = aiState(ctx).get().nn_id;
      if (u && u.model) out.push({ key: 'user', label: '내가 학습한 식별 망', json: u.model, origin: 'user' });
      const b = await loadBundle(ctx, 'nn-id');
      if (b && b.net) out.push({ key: 'nn-id', label: '번들: 식별 신경망', json: b, origin: 'bundled' });
      return out;
    }
    return (await policyCandidates(ctx, source)).filter((c) => c.json && c.json.format === 'nn-policy');
  };

  const compute = () => {
    const xin = kind === 'id' ? ai.mlp.normalize(cur.json.x_norm, x) : ai.obs.normObs(x, cur.json.obs || ai.obs.OBS_SPEC);
    return ai.mlp.forwardCache(net, xin);
  };

  const draw = () => {
    if (!net) return;
    const cache = compute();
    const g = cv.getContext && cv.getContext('2d');
    clear(read);
    const out = cache.a[cache.a.length - 1];
    if (kind === 'policy') {
      const lim = cur.json.u_lim_rad ?? 0.5236;
      read.append(kv('정책 출력 u', lim * Math.tanh(out[0]) * DEG, '°'), kv('망 출력(tanh 전)', out[0]));
    } else {
      const d = ai.mlp.denormalize(cur.json.y_norm, out);
      read.append(kv('Δy', d[0] * 1000, 'mm'), kv('Δẏ', d[1] * 1000, 'mm/s'), kv('Δθ', d[2] * DEG, '°'), h('span', { class: 'kv muted' }, `한 스텝(${cur.json.Ts_s ?? 0.06} s) 뒤 변화 예측`));
    }
    const desc = ai.mlp.describe(net);
    read.append(kv('파라미터 수', desc.n_params));
    if (!g) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const W = cv.clientWidth || 600;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(cvWrap) : null;
    const v = (k, d) => (css && css.getPropertyValue(k).trim()) || d;
    const ink = v('--ink', '#1d232a'), muted = v('--muted', '#5d6670'), bg = v('--plot-bg', '#ffffff');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const shown = pickNeurons(net, maxN);
    const L = net.sizes.length;
    const mx = 70, top = 26, bot = 30;
    const colX = (l) => mx + ((W - 2 * mx) * l) / (L - 1);
    const rowY = (l, k) => { const n = shown[l].length; return n === 1 ? top + (H - top - bot) / 2 : top + ((H - top - bot) * k) / (n - 1); };
    let wmax = 1e-9;
    for (const Wl of net.W) for (const w of Wl) wmax = Math.max(wmax, Math.abs(w));
    // 연결
    for (let l = 0; l < L - 1; l++) {
      const nin = net.sizes[l];
      shown[l + 1].forEach((i, ki) => shown[l].forEach((j, kj) => {
        const w = net.W[l][i * nin + j];
        const r = Math.abs(w) / wmax;
        if (r < 0.03) return;
        g.strokeStyle = w >= 0 ? POS : NEG; g.globalAlpha = 0.15 + 0.75 * r; g.lineWidth = 0.4 + 3.2 * r;
        g.beginPath(); g.moveTo(colX(l), rowY(l, kj)); g.lineTo(colX(l + 1), rowY(l + 1, ki)); g.stroke();
      }));
    }
    g.globalAlpha = 1;
    // 노드
    const nodeR = Math.max(4, Math.min(11, (H - top - bot) / (2.4 * Math.max(...shown.map((s) => s.length)))));
    for (let l = 0; l < L; l++) {
      const act = cache.a[l];
      const isRelu = l > 0 && l < L - 1 && net.activation === 'relu';
      const scale = l === 0 || l === L - 1 ? Math.max(1, ...act.map(Math.abs)) : 1;
      shown[l].forEach((i, k) => {
        const a = Math.max(-1, Math.min(1, act[i] / (isRelu ? Math.max(1, ...act) : scale)));
        g.fillStyle = a >= 0 ? POS : NEG; g.globalAlpha = 0.12 + 0.88 * Math.abs(a);
        g.beginPath(); g.arc(colX(l), rowY(l, k), nodeR, 0, 2 * Math.PI); g.fill();
        g.globalAlpha = 1; g.strokeStyle = ink; g.lineWidth = 1; g.stroke();
      });
      g.fillStyle = muted; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center';
      const name = l === 0 ? `입력 ${net.sizes[0]}` : l === L - 1 ? `출력 ${net.sizes[l]}` : `은닉 ${l} (${net.sizes[l]}, ${net.activation})`;
      g.fillText(name, colX(l), 14);
      if (shown[l].length < net.sizes[l]) g.fillText(`+${net.sizes[l] - shown[l].length}개 생략`, colX(l), H - 10);
    }
    // 입력·출력 이름
    g.font = '11px system-ui, sans-serif'; g.fillStyle = ink;
    g.textAlign = 'right';
    shown[0].forEach((i, k) => g.fillText(inputs[i] ? inputs[i].sym || inputs[i].key : `x${i}`, colX(0) - nodeR - 4, rowY(0, k) + 4));
    g.textAlign = 'left';
    const outNames = kind === 'policy' ? ['u'] : ['Δy', 'Δẏ', 'Δθ'];
    shown[L - 1].forEach((i, k) => g.fillText(outNames[i] || `y${i}`, colX(L - 1) + nodeR + 4, rowY(L - 1, k) + 4));
  };

  const select = (c) => {
    cur = c; clear(msg); clear(sliders);
    if (!c) { net = null; msg.appendChild(infoBox(source === 'nn-id' ? '식별 신경망이 아직 없습니다. 아래 학습 위젯에서 학습하거나 번들 결과(data/ai/nn-id.json)를 준비하세요.' : `${SOURCE_LABEL[source] || source} 신경망 정책이 아직 없습니다. 학습 위젯에서 정책을 학습하면 여기에 나타납니다.`)); clear(read); return; }
    try {
      kind = c.json.format === 'nn-id' ? 'id' : 'policy';
      net = ai.mlp.fromJSON(c.json.net);
    } catch (e) { net = null; msg.appendChild(infoBox(`망을 읽지 못했습니다: ${e.message}`)); return; }
    inputs = kind === 'id' ? ID_INPUTS : POLICY_INPUTS;
    x = inputs.map((i) => i.value);
    inputs.forEach((inp, i) => sliders.appendChild(slider({ label: inp.label, min: +(inp.min * inp.scale).toFixed(1), max: +(inp.max * inp.scale).toFixed(1), step: kind === 'id' && inp.unit === 'mm' ? 1 : 0.5,
      value: +(inp.value * inp.scale).toFixed(1), unit: inp.unit, onInput: (val) => { x[i] = val / inp.scale; draw(); } })));
    msg.appendChild(h('div', { class: 'muted' }, `${c.label} — ${describePolicy(c.json)}${c.origin === 'bundled' ? ' [시뮬레이션, 가정 서보 모델로 학습]' : ' [내 학습, 시뮬레이션]'}`));
    draw();
  };

  const refresh = async () => {
    cands = await candidatesFor();
    clear(pick);
    if (cands.length > 1) {
      pick.append(h('label', null, '보기 ', h('select', { onchange: (e) => select(cands[Number(e.target.value)]) }, cands.map((c, i) => h('option', { value: i, selected: cur && c.json === cur.json }, c.label)))));
    }
    const keep = cur && cands.find((c) => c.json === cur.json);
    select(keep || cands[0] || null);
  };
  await refresh();
  const off = aiState(ctx).subscribe(() => { refresh(); });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  if (ro) ro.observe(cvWrap);
  return { unmount() { off && off(); if (ro) ro.disconnect(); }, refresh };
}
