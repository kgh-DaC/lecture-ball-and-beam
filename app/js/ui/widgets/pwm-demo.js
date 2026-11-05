// pwm-demo: 펄스폭 ↔ 서보 각 (chapter-format §6.1). 대응식은 config/servo-presets.js 한 곳(펌웨어 프리셋과 같은 값).

import { h, checkProps, slider, clear, badge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, kv } from './_util.js';
import { pulseToServoDeg } from '../../config/servo-presets.js';

export const accepts = ['servo_model', 'pulse_us', 'show_period'];

export function mount(el, props, ctx) {
  checkProps(el, 'pwm-demo', props, accepts);
  const presets = (ctx.settings && ctx.settings.servoPresets) || {};
  const dev = (ctx.settings && ctx.settings.device) || {};
  let modelId = props.servo_model && props.servo_model !== 'current' ? props.servo_model : dev.servo_model || 'HS5645MG';
  let pulse = props.pulse_us ?? 1500;
  el.appendChild(head('PWM 펄스폭과 서보 각'));
  const sel = h('select', { onchange: (e) => { modelId = e.target.value; draw(); } },
    Object.values(presets).map((p) => h('option', { value: p.id, selected: p.id === modelId }, p.label + (p.id === dev.servo_model ? ' (현재 설정)' : ''))));
  el.appendChild(h('div', { class: 'row' }, h('label', null, '서보 모델 ', sel)));
  const cv = h('canvas', { style: { width: '220px', height: '160px', display: 'block', margin: '0 auto' }, role: 'img', 'aria-label': '서보 혼 각도' });
  el.appendChild(cv);
  const read = h('div', { class: 'readout' });
  el.appendChild(read);
  el.appendChild(slider({ label: '펄스폭', min: 400, max: 2600, step: 10, value: pulse, unit: 'µs', onInput: (v) => { pulse = v; draw(); } }));
  const plot = props.show_period !== false ? new Plot(el, { height: 150, xLabel: '시간 (ms)', yLabel: '신호 (V)', yRange: [-0.5, 5.5], noZoom: true }) : null;
  const note = h('div', { class: 'muted', style: { fontSize: '.85rem' } });
  el.appendChild(note);

  const draw = () => {
    const p = presets[modelId] || { pmin_us: 544, pmax_us: 2400 };
    const useDev = modelId === dev.servo_model;
    const pmin = useDev && dev.pmin ? dev.pmin : p.pmin_us, pmax = useDev && dev.pmax ? dev.pmax : p.pmax_us;
    const clipped = Math.min(pmax, Math.max(pmin, pulse));
    const deg = pulseToServoDeg(clipped, { pmin_us: pmin, pmax_us: pmax });
    const trim = (useDev ? dev.trim || 0 : 0) / 100, dir = useDev ? dev.dir || 1 : 1;
    const cmdDeg = (deg - 90 - trim) * dir;
    // 혼 그림
    const g = cv.getContext && cv.getContext('2d');
    if (g) {
      const W = 220, H = 160, dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H - 25;
      g.strokeStyle = '#d8dde3'; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, 90, Math.PI, 2 * Math.PI); g.stroke();
      g.fillStyle = '#5d6670'; g.font = '11px sans-serif';
      g.fillText('0°', cx - 104, cy + 4); g.fillText('90°', cx - 9, cy - 95); g.fillText('180°', cx + 92, cy + 4);
      g.fillStyle = '#444'; g.fillRect(cx - 30, cy - 10, 60, 30);
      const a = Math.PI - (deg * Math.PI) / 180;
      g.strokeStyle = '#D55E00'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 80 * Math.cos(a), cy - 80 * Math.sin(a)); g.stroke();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 5, 0, 2 * Math.PI); g.fill();
    }
    clear(read).append(kv('펄스폭', clipped, 'µs'), kv('서보 각', deg, '°'), kv('명령각(수평 0)', cmdDeg, '°'), kv('듀티비', (clipped / 20000) * 100, '%'), kv('범위', `${pmin}~${pmax}`, 'µs'));
    if (pulse !== clipped) read.appendChild(badge(`펄스폭이 범위 밖이라 ${clipped} µs로 잘림`, 'b-bad'));
    if (plot) {
      const x = [], y = [];
      for (const T of [0, 20, 40]) { x.push(T, T, T + clipped / 1000, T + clipped / 1000); y.push(0, 5, 5, 0); }
      x.push(60); y.push(0);
      plot.setSeries([{ label: `PWM (주기 20 ms, 펄스 ${clipped} µs)`, x, y, ...styleOf(0) }]);
    }
    note.textContent = `${p.label || modelId}: ${p.note || ''} 공급 전압 ${p.supply_v || '확인 필요'}. 서보 각 = (펄스 − ${pmin})/(${pmax} − ${pmin})·180°. 실제 각은 서보마다 다르므로 07장 캘리브레이션으로 확인한다.`;
  };
  draw();
  return { unmount() { plot && plot.destroy(); }, update() { draw(); } };
}
