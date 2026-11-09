// device-check: IDLE D 스트림으로 정지 노이즈 σ, 유실률, 필터 α 비교, 포텐쇼미터 원값 (chapter-format §6.2).
// 원측정 통계는 두 가지로 낸다: 이상값 포함 평균·σ(그대로의 raw)와 로버스트(중앙값·MAD σ, 이상값 제외 평균·σ) + 튄 값 비율.
// α 비교 재필터는 펌웨어와 같은 순서(이상값 제거 → 재귀 필터, dist-filter.js)로 호스트에서 다시 계산한다.

import { h, checkProps, clear, errorBox, infoBox, table, fmt, provenanceBadge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head } from './_util.js';
import { meanSd } from '../../store/compare.js';
import { DistFilter, DESPIKE_LABEL } from '../../sim/dist-filter.js';
import { robustDistStats } from './signal-monitor.js';
import { radiusOf, centerMm } from '../coord.js';

export const accepts = ['duration_s', 'alphas', 'show_pot'];

/**
 * D 메시지 배열 → 통계와 α별 재필터(펌웨어와 같은 순서: 이상값 제거 despike → filt = filt(1−α) + x·α). 순수 함수
 * opts.despike: 재필터에 쓸 이상값 제거 방식(0 끔 / 1 median3 / 2 gate, 기본 2 — 장치 보고값을 넘기면 장치와 같게)
 * 반환: raw(이상값 포함 평균·σ), robust(중앙값·MAD σ·튄 값 비율·정상값 평균·σ), filters, dev_filt(장치 filt_mm 통계·치우침) …
 */
export function analyzeIdle(samples, alphas = [0.1, 0.2], opts = {}) {
  const n = samples.length;
  const raw = samples.map((d) => (d.dist_mm >= 0 ? d.dist_mm : NaN));
  const lost = raw.filter((v) => !Number.isFinite(v)).length;
  const rawStat = meanSd(raw);
  const robust = robustDistStats(samples.map((d) => d.dist_mm));
  const despike = opts.despike ?? 2;
  const filters = alphas.map((a) => {
    const df = new DistFilter();
    const y = raw.map((x) => { df.update(Number.isFinite(x) ? x : -1, despike, Math.round(a * 1000)); const o = df.output(); return o >= 0 ? o : NaN; });
    const tail = y.slice(Math.floor(y.length * 0.2)); // 초기 수렴 구간 제외
    return { alpha: a, despike, y, stat: meanSd(tail) };
  });
  const fdev = samples.map((d) => (d.filt_mm >= 0 ? d.filt_mm : NaN));
  const fTail = meanSd(fdev.slice(Math.floor(fdev.length * 0.2)));
  const devFilt = { ...fTail, bias: Number.isFinite(fTail.mean) && Number.isFinite(robust.inlier_mean) ? fTail.mean - robust.inlier_mean : null };
  const pot = meanSd(samples.map((d) => d.pot_raw));
  const dts = [];
  for (let i = 1; i < n; i++) dts.push(samples[i].t_ms - samples[i - 1].t_ms);
  return { n, lost, lost_ratio: n ? lost / n : null, raw: rawStat, robust, filters, dev_filt: devFilt, pot, dt: meanSd(dts), t_s: samples.map((d) => (d.t_ms - samples[0].t_ms) / 1000), rawSeries: raw };
}

export function mount(el, props, ctx) {
  checkProps(el, 'device-check', props, accepts);
  const dev = ctx.device;
  const dur = props.duration_s ?? 10;
  const alphas = props.alphas || [0.1, 0.2];
  el.appendChild(head('장치 점검(정지 노이즈)', h('span', { class: 'muted' }, `공을 빔 가운데에 고정하고 ${dur} s 동안 측정`)));
  const ctl = h('div', { class: 'row' });
  const out = h('div');
  const plot = new Plot(el, { height: 200, xLabel: '시간 (s)', yLabel: '측정 거리(표면) (mm)', minYSpan: 6 });
  el.append(ctl, out);
  let off = null, timer = null;
  const run = async () => {
    clear(out);
    if (!dev || dev.mode === 'sample') { out.appendChild(infoBox('장치 점검은 실제 장치 또는 가상 장치 모드에서 합니다(실습 패널에서 모드를 고르세요).')); return; }
    try { if (!dev.connected) await dev.connect(); } catch (e) { out.appendChild(errorBox(e.message)); return; }
    if (ctx.runner && ctx.runner.state === 'running') { out.appendChild(errorBox('실험 중에는 점검할 수 없습니다.')); return; }
    if (dev.devMode !== 0) { try { await dev.setDeviceMode(0); } catch (e) { out.appendChild(errorBox(e.message)); return; } }
    const got = [];
    off && off();
    off = dev.onSample((d) => { if (d.mode === 0) got.push(d); });
    btn.disabled = true;
    const t0 = Date.now();
    const prog = h('span', { class: 'muted' });
    out.appendChild(prog);
    timer = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      prog.textContent = `측정 중 ${t.toFixed(0)} / ${dur} s (${got.length}개)`;
      if (t >= dur) { clearInterval(timer); off(); off = null; btn.disabled = false; show(got); }
    }, 250);
  };
  const show = (got) => {
    clear(out);
    if (got.length < 5) { out.appendChild(errorBox('D 줄을 거의 받지 못했습니다. 연결·보드레이트를 확인하세요.')); return; }
    const dsp = dev.config ? dev.config.despike : null; // null = 구 펌웨어(1.0.0) 또는 모름
    const r = analyzeIdle(got, alphas, { despike: dsp ?? 2 });
    plot.setSeries([{ label: '원측정', x: r.t_s, y: r.rawSeries, ...styleOf(6), width: 1 }, ...r.filters.map((f, i) => ({ label: `재필터 α = ${f.alpha}`, x: r.t_s, y: f.y, ...styleOf(i) }))]);
    const dspName = dsp == null ? '없음(펌웨어 1.0.0)' : DESPIKE_LABEL[dsp] ?? dsp;
    const rb = r.robust, df = r.dev_filt;
    out.append(
      h('div', { class: 'row' }, provenanceBadge(dev.provenance)),
      table(['항목', '값'], [
        ['샘플 수', r.n], ['유실', `${r.lost} (${fmt((r.lost_ratio || 0) * 100, 1)}%)`],
        ['원측정 평균 ± σ (raw, 이상값 포함)', `${fmt(r.raw.mean, 1)} ± ${fmt(r.raw.sd, 2)} mm`],
        ['원측정 중앙값 · σ(MAD)', `${fmt(rb.median, 1)} mm · ${fmt(rb.mad_sd, 2)} mm`],
        ['튄 값(중앙값 ±50 mm 밖)', `${rb.n_outlier} / ${rb.n} (${fmt(rb.outlier_ratio * 100, 1)}%)`],
        ['정상값 평균 ± σ (튄 값 제외, 측정 거리 = 센서 → 공 표면)', `${fmt(rb.inlier_mean, 1)} ± ${fmt(rb.inlier_sd, 2)} mm`],
        [`공 중심 위치 = 측정 + ${radiusOf(ctx)} mm (참고)`, `${fmt(centerMm(rb.inlier_mean, radiusOf(ctx)), 1)} mm`],
        [`장치 filt_mm 평균 ± σ (이상값 제거: ${dspName})`, `${fmt(df.mean, 1)} ± ${fmt(df.sd, 2)} mm, 치우침 ${df.bias == null ? '-' : `${df.bias >= 0 ? '+' : ''}${fmt(df.bias, 1)} mm`}`],
        ...r.filters.map((f) => [`재필터 α=${f.alpha} σ (호스트, 이상값 제거 ${DESPIKE_LABEL[f.despike] ?? f.despike} 후)`, `${fmt(f.stat.sd, 2)} mm`]),
        ['샘플 간격', `${fmt(r.dt.mean, 1)} ms (σ ${fmt(r.dt.sd, 1)})`],
        ...(props.show_pot !== false ? [['포텐쇼미터 원값', `${fmt(r.pot.mean, 1)} ± ${fmt(r.pot.sd, 2)} LSB`]] : []),
      ]),
      rb.outlier_ratio >= 0.02 ? h('p', { class: 'muted' }, `튄 값이 ${fmt(rb.outlier_ratio * 100, 1)}% 있습니다. 이상값 포함 σ는 튄 값 때문에 커 보이므로 정상값 σ(MAD)를 잡음으로 보세요.${dsp == null ? ' 구 펌웨어(1.0.0)는 튄 값을 filt_mm에도 그대로 넣습니다 — 1.1.0을 올리면 게이트(기본)가 걸러 냅니다.' : ''}`) : null,
      h('p', { class: 'muted' }, 'α가 작을수록 σ는 줄지만 응답이 늦어진다(05장 센서 필터 지연). 유실이 5%를 넘으면 공 표면·센서 각도를 점검하세요.'));
  };
  const btn = h('button', { class: 'btn primary', onclick: () => run() }, '점검 시작');
  ctl.append(btn);
  return { unmount() { off && off(); clearInterval(timer); plot.destroy(); } };
}
