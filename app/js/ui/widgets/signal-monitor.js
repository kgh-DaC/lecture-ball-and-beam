// signal-monitor: 장치 신호 수신 확인 — D 스트림(dist, filt, pot_raw, cmd, mode)을 실시간 그래프·수치 카드로 보이고
// 항목별 판정(수신 주기, 거리 이상값, 거리 유실, 필터 치우침, A0 안정성, A0 0/1023 고정, 수신 끊김·하트비트)을 정상/주의/이상 + 문구로 표시한다.
// 거리 통계는 원측정 dist_mm 의 로버스트 통계(중앙값·MAD)로 낸다 — 평균·σ는 튄 값(실기 약 15 %가 ~304 mm, protocol §3.1)에 끌려간다.
// 필터 치우침 = filt_mm 중앙값 − 원측정 정상값 중앙값: 튐이 filt 로 새는지(펌웨어 1.0.0, despike 0) 본다.
// 판정 기준은 tools/a0_monitor.html과 같다(A0 최근 2 s 표준편차 > 15 LSB 또는 폭 > 60 → 부유·와이퍼 미연결 의심).
// 렌더링은 rAF(10 Hz)에서, 수신은 onSample에서 버퍼에만 쌓는다(제어와 분리).

import { BOARD_LABEL, SERVO_POWER_HINT } from '../../serial/troubleshoot.js';
import { h, checkProps, clear, errorBox, infoBox, badge, fmt, toast } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, kpi } from './_util.js';
import { GUIDE, hwModeNote } from '../jog.js';

export const accepts = ['window_s', 'show_pot'];
const LV = { ok: ['정상', 'b-ok', '●'], warn: ['주의', 'b-assumed', '▲'], bad: ['이상', 'b-bad', '■'], info: ['참고', 'b-unknown', '○'] };

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
/** 정지 공 기준 이상값 판정 문턱(mm): 중앙값에서 이만큼 넘게 떨어지면 튄 값 */
export const OUTLIER_MM = 50;
const DESPIKE_NAME = { 0: '꺼짐', 1: '중간값 3', 2: '게이트' };

/**
 * 원측정 거리의 로버스트 통계(순수). ds: dist_mm 배열(-1 = 유실 포함 가능)
 * 반환 { n, median, mad_sd(1.4826·MAD, 정상값만), n_outlier, outlier_ratio, inlier_mean, inlier_sd, raw_mean, raw_sd }
 */
export function robustDistStats(ds) {
  const v = ds.filter((x) => x >= 0);
  const med = median(v);
  const isOut = (x) => x < 20 || x > 500 || Math.abs(x - med) > OUTLIER_MM;
  const inl = v.filter((x) => !isOut(x));
  const mi = median(inl);
  return {
    n: v.length, median: med, mad_sd: inl.length ? 1.4826 * median(inl.map((x) => Math.abs(x - mi))) : NaN,
    n_outlier: v.length - inl.length, outlier_ratio: v.length ? (v.length - inl.length) / v.length : 0,
    inlier_mean: mean(inl), inlier_sd: sd(inl), raw_mean: mean(v), raw_sd: sd(v),
  };
}
/**
 * 판정(순수). samples: D 메시지 배열(t_ms, dist_mm, filt_mm, cmd_cdeg, pot_raw, mode, recv_ms?)
 * opts: { fs_ms = 60, now_ms?, hb_errors = 0, despike?: 0|1|2|null(구 펌웨어 1.0.0 또는 모름), resets = 0(연결 중 보드 리셋 횟수) }
 * 반환 [{ key, level: ok|warn|bad|info, label, text, guide? }]
 */
export function judgeSignal(samples, opts = {}) {
  const fs = opts.fs_ms ?? 60;
  const out = [];
  const n = samples.length;
  if (n < 5) return [{ key: 'rx', level: 'bad', label: '수신', text: `D 줄을 거의 받지 못했습니다(${n}개). ${BOARD_LABEL} 포트·보드레이트(115200)·펌웨어 업로드를 확인하세요(Nano 호환은 CH340 드라이버).`, guide: 'wiring' }];
  // 수신 주기
  const dts = [];
  for (let i = 1; i < n; i++) dts.push(samples[i].t_ms - samples[i - 1].t_ms);
  const dm = mean(dts), dmax = Math.max(...dts);
  const rateLv = Math.abs(dm - fs) <= 0.15 * fs && dmax <= 2 * fs ? 'ok' : dmax > 4 * fs || Math.abs(dm - fs) > 0.5 * fs ? 'bad' : 'warn';
  out.push({ key: 'rate', level: rateLv, label: '수신 주기', value: dm, text: `평균 ${fmt(dm, 1)} ms(설정 ${fs} ms), 최대 ${fmt(dmax, 0)} ms${rateLv === 'ok' ? '' : ' — 다른 프로그램이 포트를 쓰거나 USB 케이블이 불안정하거나, 서보 전원 부족으로 보드가 리셋되고 있을 수 있습니다'}` });
  // 거리 유실
  const lost = samples.filter((d) => !(d.dist_mm >= 0)).length / n;
  out.push({ key: 'lost', level: lost < 0.02 ? 'ok' : lost < 0.05 ? 'warn' : 'bad', label: '거리 유실', value: lost, text: `${fmt(lost * 100, 1)}%${lost >= 0.02 ? ' — 센서가 공을 놓칩니다. 센서 높이·각도, 공 표면을 확인하세요' : ''}`, guide: lost >= 0.02 ? 'sonar' : null });
  // 거리 이상값(원측정 dist_mm): 범위(20~500 mm) 밖 또는 중앙값에서 50 mm 넘게 튐(정지 상태 기준)
  const rs = robustDistStats(samples.map((d) => d.dist_mm));
  const med = rs.median, outl = rs.outlier_ratio;
  const dsp = opts.despike;
  const dspNote = outl < 0.02 ? '' : dsp == null ? ' 구 펌웨어(1.0.0, despike 없음)는 이 튐을 filt_mm에도 그대로 넣습니다 — 펌웨어 1.1.0을 올리면 게이트(기본)가 걸러 냅니다.'
    : dsp === 0 ? ' 이상값 제거(despike)가 꺼져 있어 filt_mm에도 들어갑니다 — 장치 설정에서 게이트를 고르세요.'
      : ` filt_mm에는 이상값 제거(${DESPIKE_NAME[dsp] ?? dsp})가 걸러 냅니다 — 아래 "필터 치우침"을 보세요.`;
  out.push({ key: 'outlier', level: outl < 0.02 ? 'ok' : outl < 0.1 ? 'warn' : 'bad', label: '거리 이상값(원측정)', value: outl,
    text: `${fmt(outl * 100, 1)}% = ${rs.n_outlier}/${rs.n} (원측정 dist_mm 중앙값 ${fmt(med, 0)} mm 기준 ±${OUTLIER_MM} mm 밖 또는 20~500 mm 밖). 정상값 σ(MAD) ${fmt(rs.mad_sd, 1)} mm${outl >= 0.02 ? ' — 빔 끝·손·벽 반사를 확인하세요(공을 정지시켜 두고 판정).' + dspNote : ''}`, guide: outl >= 0.02 ? 'sonar' : null });
  // 필터 치우침: filt_mm 중앙값 − 원측정 정상값 중앙값(정지 공 기준)
  const fv = samples.map((d) => d.filt_mm).filter((v) => v >= 0);
  const inl = samples.map((d) => d.dist_mm).filter((v) => v >= 20 && v <= 500 && Math.abs(v - med) <= OUTLIER_MM);
  if (fv.length >= 5 && inl.length >= 5) {
    const bias = median(fv) - median(inl), ab = Math.abs(bias);
    out.push({ key: 'filt_bias', level: ab < 5 ? 'ok' : ab < 15 ? 'warn' : 'bad', label: '필터 치우침(filt − 정상 원측정)', value: bias,
      text: `${bias >= 0 ? '+' : ''}${fmt(bias, 1)} mm (중앙값끼리, 공 정지 기준)${ab >= 5 ? ` — 튄 값이 필터로 새고 있습니다(이상값 제거 ${dsp == null ? '없음: 펌웨어 1.0.0' : DESPIKE_NAME[dsp] ?? dsp}). 제어는 이만큼 틀린 위치를 봅니다` : ''}`, guide: ab >= 5 ? 'sonar' : null });
  }
  // A0: 최근 2 s
  const tEnd = samples[n - 1].t_ms;
  const pw = samples.filter((d) => d.t_ms >= tEnd - 2000).map((d) => d.pot_raw).filter(Number.isFinite);
  const pa = mean(pw), ps = sd(pw), span = pw.length ? Math.max(...pw) - Math.min(...pw) : 0;
  const unstable = ps > 15 || span > 60;
  out.push({ key: 'a0', level: unstable ? 'bad' : ps > 5 ? 'warn' : 'ok', label: 'A0 안정성', value: ps,
    text: `최근 2 s σ ${fmt(ps, 1)} LSB, 폭 ${fmt(span, 0)}${unstable ? ' — 크게 흔들립니다(와이퍼 미연결·부유 의심). 와이퍼 선과 5V/GND를 확인하세요' : ''}`, guide: unstable ? 'wiper' : null });
  const stuck = pa < 5 || pa > 1018;
  out.push({ key: 'a0_stuck', level: stuck ? 'bad' : 'ok', label: 'A0 0/1023 고정', value: pa, text: stuck ? `평균 ${fmt(pa, 0)} — 끝에 붙어 있습니다. 와이퍼가 GND/5V에 단락됐거나 와이퍼 전압이 5V를 넘을 수 있습니다(6V 구동 주의)` : `평균 ${fmt(pa, 0)} (끝에 붙지 않음)`, guide: stuck ? 'wiper' : null });
  // 수신 끊김·하트비트
  const now = opts.now_ms;
  const lastRecv = samples[n - 1].recv_ms;
  const age = now != null && lastRecv != null ? now - lastRecv : null;
  const mode = samples[n - 1].mode;
  const hbE = opts.hb_errors || 0;
  let hbLv = 'ok', hbText = mode === 1 ? 'HOST 모드, 하트비트 만료 없음' : `IDLE(모드 ${mode}) — 하트비트 불필요, 스트림 정상`;
  if (age != null && age > Math.max(1000, 5 * fs)) { hbLv = 'bad'; hbText = `마지막 수신이 ${fmt(age / 1000, 1)} s 전 — 연결이 끊겼거나 장치가 멈췄습니다`; }
  else if (hbE > 0) { hbLv = 'warn'; hbText = `하트비트 만료(E,4) ${hbE}회 — 탭 전환·PC 부하로 B 전송이 늦었거나, 서보 전원 부족으로 보드가 리셋됐을 수 있습니다`; }
  out.push({ key: 'hb', level: hbLv, label: '수신 끊김·하트비트', text: hbText, guide: hbLv === 'ok' ? null : 'power' });
  // 보드 리셋(연결 중 H 재수신): 서보 전원 부족의 대표 증상
  const resets = opts.resets || 0;
  if (resets > 0) out.push({ key: 'reset', level: 'bad', label: '보드 리셋', value: resets, text: `연결 중 보드가 ${resets}회 다시 시작했습니다(H 재수신). ${SERVO_POWER_HINT}`, guide: 'power' });
  return out;
}

/** ④ 센서 연결 기본 확인용(순수): 초음파 값이 들어오는지만 — 수신(rx)·수신 주기(rate)·거리 유실(lost) 판정만 고른다 */
export function basicJudge(js) { return js.filter((j) => j.key === 'rx' || j.key === 'rate' || j.key === 'lost'); }

export function mount(el, props, ctx) {
  checkProps(el, 'signal-monitor', props, accepts);
  const dev = ctx.device;
  const win = (props.window_s ?? 10) * 1000;
  const modeTag = h('span');
  el.appendChild(head('신호 수신 확인', modeTag));
  const ctl = h('div', { class: 'row' });
  const cards = h('div', { class: 'row' });
  const verdict = h('div', { class: 'verdicts' });
  el.append(ctl, cards, verdict);
  const pD = new Plot(el, { height: props.height_px || 180, xLabel: '시간 (s)', yLabel: '거리 (mm)', minYSpan: 10 });
  const pP = props.show_pot !== false ? new Plot(el, { height: 130, xLabel: '시간 (s)', yLabel: 'A0 pot_raw (LSB)', yRange: [0, 1023] }) : null;
  let buf = [], hbErr = 0, raf = null, alive = true, offS = null, offE = null, lastDraw = 0, ver = 0, drawn = -1;

  const attach = () => {
    offS && offS(); offE && offE();
    offS = dev.onSample((d) => { buf.push(d); ver++; const t0 = d.t_ms - win; while (buf.length && buf[0].t_ms < t0) buf.shift(); });
    offE = dev.onError ? dev.onError((e) => { if (e.code === 4) hbErr++; }) : null;
  };
  const start = async () => {
    clear(verdict);
    if (!dev || dev.mode === 'sample') { verdict.appendChild(infoBox('신호 확인은 실제 장치 또는 가상 장치에서 합니다. 실습 패널이나 장치 설정(#/settings)에서 모드를 바꾸세요.')); return; }
    try { if (!dev.connected) await dev.connect(); } catch (e) { verdict.appendChild(errorBox(e.message)); return; }
    buf = []; hbErr = 0;
    attach();
  };
  const paintMode = () => { const m = hwModeNote(dev); clear(modeTag).append(badge(m.text, m.cls), dev && dev.connected ? badge('연결됨', 'b-ok') : badge('연결 안 됨', 'b-unknown')); };
  /**
   * 지금 판정을 하드웨어 점검 기록(settings.hw, hardware-steps)에 남긴다.
   * kind 'full'(⑦ 한 위치 안정성, 키 'signal-monitor'): 이상 하나라도 있으면 불합격, 주의만 있으면 주의.
   * kind 'basic'(④ 센서 연결 기본 확인, 키 'signal-monitor:basic'): 수신·수신 주기·거리 유실만 본다(basicJudge).
   */
  const recordJudge = (kind = 'full') => {
    const js = judgeSignal(buf, { fs_ms: (dev.config && dev.config.fs) || 60, hb_errors: hbErr, despike: despikeOf(), resets: dev.resetCount || 0 });
    if (!ctx.settings || !ctx.settings.hw || buf.length < 5) return null;
    const use = kind === 'basic' ? basicJudge(js) : js;
    const bad = use.filter((j) => j.level === 'bad'), warn = use.filter((j) => j.level === 'warn');
    return ctx.settings.hw.recordResult(kind === 'basic' ? 'signal-monitor:basic' : 'signal-monitor', { verdict: bad.length ? 'fail' : warn.length ? 'warn' : 'pass', provenance: dev.provenance === 'real' ? 'measured' : 'simulated',
      summary: `${kind === 'basic' ? '기본 확인 — ' : ''}${bad.length ? `이상: ${bad.map((j) => j.label).join(', ')}` : warn.length ? `주의: ${warn.map((j) => j.label).join(', ')}` : `정상(${buf.length}개)`}`, data: use.map((j) => ({ key: j.key, level: j.level, value: j.value ?? null })) });
  };
  const rec = (kind) => { const r = recordJudge(kind); if (r) toast(`점검 기록 저장: ${r.summary}`, r.verdict === 'pass' ? 'ok' : 'warn'); else toast('신호가 부족합니다(먼저 모니터 시작)', 'warn'); };
  ctl.append(h('button', { class: 'btn primary', onclick: () => start() }, '연결하고 모니터 시작'), h('button', { class: 'btn', onclick: () => { buf = []; hbErr = 0; } }, '기록 지우기'),
    h('button', { class: 'btn', onclick: () => rec('basic') }, '④ 센서 연결 기본 확인 기록'),
    h('button', { class: 'btn', onclick: () => rec('full') }, '⑦ 한 위치 안정성 기록(공 정지)'),
    h('span', { class: 'muted' }, ` 최근 ${win / 1000} s 기준. 거리 판정은 공을 한 자리에 정지시켜 두고 보세요.`));

  const despikeOf = () => (dev && dev.config && dev.config.despike != null ? dev.config.despike : null);
  let lastForce = 0;
  const render = (force = false) => {
    paintMode();
    if (ver === drawn && !force) return;
    drawn = ver;
    const n = buf.length;
    if (!n) return;
    const t0 = buf[0].t_ms;
    const x = buf.map((d) => (d.t_ms - t0) / 1000);
    pD.setSeries([{ label: '원측정 dist', x, y: buf.map((d) => (d.dist_mm >= 0 ? d.dist_mm : NaN)), ...styleOf(6), width: 1 }, { label: '필터 filt', x, y: buf.map((d) => (d.filt_mm >= 0 ? d.filt_mm : NaN)), ...styleOf(0) }]);
    if (pP) pP.setSeries([{ label: 'pot_raw', x, y: buf.map((d) => d.pot_raw), ...styleOf(1) }]);
    const last = buf[n - 1];
    const fs = (dev.config && dev.config.fs) || 60;
    const rs = robustDistStats(buf.map((d) => d.dist_mm));
    clear(cards).append(kpi('원측정 dist', last.dist_mm >= 0 ? last.dist_mm : '유실', last.dist_mm >= 0 ? 'mm' : ''), kpi('filt', last.filt_mm, 'mm'),
      kpi('원측정 중앙값', rs.median, 'mm'), kpi('튄 값 비율', fmt(rs.outlier_ratio * 100, 1), '%'), kpi('despike', despikeOf() == null ? '없음(1.0.0)' : DESPIKE_NAME[despikeOf()] ?? despikeOf()), kpi('pot_raw', last.pot_raw, 'LSB'),
      kpi('cmd', last.cmd_cdeg / 100, '°'), kpi('mode', { 0: '0 IDLE', 1: '1 HOST', 2: '2 ID' }[last.mode] ?? last.mode), kpi('수신', n, `개/${win / 1000}s`));
    const js = judgeSignal(buf, { fs_ms: fs, now_ms: typeof performance !== 'undefined' ? performance.now() : null, hb_errors: hbErr, despike: despikeOf(), resets: dev.resetCount || 0 });
    clear(verdict).appendChild(h('table', { class: 'tbl' }, h('tbody', null, js.map((j) => {
      const [lab, cls, ic] = LV[j.level];
      return h('tr', null, h('td', null, h('span', { class: `badge ${cls}`, 'aria-label': lab }, `${ic} ${lab}`)), h('td', null, h('b', null, j.label)), h('td', null, j.text,
        j.guide && GUIDE[j.guide] ? h('div', null, h('a', { href: GUIDE[j.guide].href }, `해결 안내: ${GUIDE[j.guide].label}`)) : null));
    }))));
  };
  const loop = () => {
    if (!alive) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastDraw >= 100) { lastDraw = now; const f = now - lastForce >= 1000; if (f) lastForce = now; render(f); }
    raf = requestAnimationFrame(loop);
  };
  if (dev && dev.connected) attach();
  loop();
  const offSt = dev && dev.onStatus ? dev.onStatus(() => paintMode()) : null;
  return {
    unmount() { alive = false; if (raf) cancelAnimationFrame(raf); offS && offS(); offE && offE(); offSt && offSt(); pD.destroy(); pP && pP.destroy(); },
    /** 시험용: 지금 버퍼로 판정 */
    judge: () => judgeSignal(buf, { fs_ms: (dev.config && dev.config.fs) || 60, hb_errors: hbErr, despike: despikeOf(), resets: dev.resetCount || 0 }),
    start,
    recordJudge,
  };
}
