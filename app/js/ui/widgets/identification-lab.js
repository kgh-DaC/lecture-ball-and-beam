// identification-lab: ID 모드 기록(I/V/F) 또는 샘플 → 모델 구조별 맞춤 겹침 → 적합도 → result 저장 (chapter-format §6.4).
// 맞춤·시뮬레이션은 identification.js(control-engineer). 이 위젯은 기록·변환(cdeg↔rad)·표시·저장만 한다.

import { h, checkProps, clear, errorBox, infoBox, table, fmt, toast, download, badge } from '../dom.js';
import { Plot, styleOf } from '../plot.js';
import { head, sourceBadges } from './_util.js';
import { cmd } from '../../serial/writer.js';
import { potToCdeg, calibrationMeta } from '../../loop/runner.js';
import { withTrimDir } from '../../config/hw-records.js';
import { newSessionId, isoLocal } from '../../store/session.js';
import { resolveSources } from '../sources.js';
import { simSourceLabel } from '../twin/lib.js';

export const accepts = ['source', 'sample', 'signal', 'structures', 'show_fit'];
const CDEG2RAD = Math.PI / 18000;
const FIT = { fo: 'fitFO', so: 'fitSO', fo_slew: 'fitFOSlew', arx: 'fitARX' };
const NAME = { fo: '1차+지연', so: '2차+지연', fo_slew: '1차+지연+속도 한계', arx: 'ARX' };

/** V 메시지들 → ID 세션 행(data-schema §4.1). 순수 함수 */
export function idRows(vs, cal) {
  return vs.map((v) => { const th = potToCdeg(v.pot_raw, cal); return { idx: v.idx, t_s: v.t_us / 1e6, cmd_cdeg: v.cmd_cdeg, pot_raw: v.pot_raw, theta_cdeg: Number.isFinite(th) ? Math.round(th) : NaN }; });
}
/** 행 → 식별 입력 { t_s, u_rad, y_rad } */
export function idData(rows) {
  const ok = rows.filter((r) => Number.isFinite(r.theta_cdeg));
  return { t_s: ok.map((r) => r.t_s), u_rad: ok.map((r) => r.cmd_cdeg * CDEG2RAD), y_rad: ok.map((r) => r.theta_cdeg * CDEG2RAD) };
}

/** 기록 신호 종류: 메타 id_signal.kind, 없으면 입력 모양(한 번만 바뀌면 step) */
export function signalKind(meta, d, I) {
  const k = meta && meta.id_signal && meta.id_signal.kind;
  if (k) return k;
  return I && I.isStepInput && I.isStepInput(d.u_rad) ? 'step' : 'prbs';
}
/** 맞춤 옵션: PRBS·처프는 기록 직전 명령이 0(중립)이므로 u0 = 0 (identification.js 편차 좌표 규약) */
export function fitOptions(kind) { return kind === 'prbs' || kind === 'chirp' ? { u0: 0 } : {}; }
/** ARX 입력 지연 nk = round(Td_fo / Ts) + 1 (ZOH 한 샘플 포함) */
export function arxDelay(fo, Ts) { return fo && Number.isFinite(fo.Td_s) && Ts > 0 ? Math.round(fo.Td_s / Ts) + 1 : 1; }

export function mount(el, props, ctx) {
  checkProps(el, 'identification-lab', props, accepts);
  const dev = ctx.device;
  const sig = props.signal || { kind: 'step', from_deg: 0, to_deg: 10, hold_ms: 500 };
  const structures = props.structures || ['fo', 'so', 'fo_slew', 'arx'];
  const source = props.source || 'both';
  el.appendChild(head('서보 식별 실험실'));
  if (!ctx.identification) el.appendChild(infoBox('식별 계산(control/identification.js)이 아직 준비되지 않아 기록·그래프까지만 됩니다.'));
  const ctl = h('div', { class: 'row' });
  const msg = h('div');
  const plot = new Plot(el, { height: 230, xLabel: '시간 (s)', yLabel: '각도 (°)' });
  const out = h('div');
  el.append(ctl, msg, out);
  let data = null; // { meta, rows, src }

  const record = async () => {
    clear(msg);
    try {
      if (dev.mode === 'sample') throw new Error('기록은 실제 장치(또는 가상 장치)에서 합니다.');
      if (!dev.connected) await dev.connect();
      if (ctx.runner && ctx.runner.state === 'running') throw new Error('실험 중입니다');
      if (dev.devMode !== 0 && dev.devMode != null) await dev.setDeviceMode(0);
      await dev.setDeviceMode(2);
      const vs = [];
      const off = dev.onLine((m) => { if (m.type === 'V') vs.push(m); });
      const fin = dev.waitFor((m) => m.type === 'F', 40000);
      const line = sig.kind === 'step' ? cmd.idStep(sig.from_deg * 100, sig.to_deg * 100, sig.hold_ms)
        : sig.kind === 'prbs' ? cmd.idPrbs(sig.amp_deg * 100, sig.bit_ms, sig.n_bits) : cmd.idChirp(sig.amp_deg * 100, sig.f0_mhz, sig.f1_mhz, sig.dur_ms);
      const acc = await dev.request(line, (a) => a.cmd === 'I');
      if (!acc.ok) { off(); throw new Error(`ID 시작 거부: ${acc.msg ? acc.msg.text : '응답 없음'}`); }
      msg.appendChild(h('div', { class: 'muted' }, `기록 중… 예정 ${acc.msg.args[1]}개`));
      const f = await fin;
      off();
      await dev.setDeviceMode(0);
      // θ = dir·(혼 각도 − trim): 이 기록을 만든 장치 trim·dir(device.config) 기준
      const cal0 = ctx.getCalibration ? await ctx.getCalibration() : null;
      const cal = cal0 && dev.config ? withTrimDir(cal0, dev.config.trim ?? cal0.trim_cdeg, dev.config.dir ?? cal0.dir) : cal0;
      const rows = idRows(vs, cal);
      const sid = newSessionId(ctx.chapter && ctx.chapter.id);
      const meta = { session_id: sid, kind: 'id', chapter_id: ctx.chapter && ctx.chapter.id, source: dev.mode === 'device' ? 'device' : 'virtual', title: `식별 기록 ${sig.kind}`, controller: null, setpoint_profile: null,
        device: dev.deviceMeta(), id_signal: { kind: sig.kind, from_cdeg: (sig.from_deg ?? 0) * 100, to_cdeg: (sig.to_deg ?? 0) * 100, hold_ms: sig.hold_ms, id_ts_ms: dev.config.id_ts ?? 5 },
        calibration: calibrationMeta(cal),
        stats: { n_planned: Number(acc.msg.args[1]), n_received: vs.length, n_missing: Number(acc.msg.args[1]) - vs.length }, complete: !!f, conditions: { status: 'known' } };
      const saved = await ctx.store.sessions.save(meta, rows);
      data = { meta: saved, rows, src: { provenance: saved.provenance, kind: 'session', badges: simSourceLabel(saved) ? [simSourceLabel(saved)] : [] } };
      clear(msg).appendChild(infoBox(`세션 ${sid} 저장(${vs.length}개${f ? '' : ', F 미수신'}).`));
      show();
    } catch (e) { try { await dev.setDeviceMode(0); } catch { /* */ } msg.appendChild(errorBox(e.message)); }
  };

  const loadSample = async () => {
    clear(msg);
    const refs = props.sample ? [props.sample] : ((ctx.chapter && ctx.chapter.sample_sessions) || []).map((s) => (typeof s === 'string' ? `sample:${s}` : s));
    const list = (await resolveSources(ctx, refs)).filter((s) => s.rows && s.rows.length && (s.meta.kind === 'id' || s.rows[0].cmd_cdeg !== undefined));
    if (!list.length) { msg.appendChild(infoBox('식별 샘플이 없습니다(data/samples의 servo-step 슬롯).')); return; }
    data = { meta: list[0].meta, rows: list[0].rows, src: list[0] };
    show();
  };

  const show = () => {
    clear(out);
    const { rows } = data;
    const t = rows.map((r) => r.t_s);
    const ser = [{ label: '명령각', x: t, y: rows.map((r) => r.cmd_cdeg / 100), ...styleOf(6), step: true, width: 1.4 }, { label: '실제각(pot)', x: t, y: rows.map((r) => r.theta_cdeg / 100), ...styleOf(0) }];
    out.appendChild(h('div', { class: 'row' }, h('b', null, data.meta.title || data.meta.session_id), ...sourceBadges(data.src), data.meta.calibration && data.meta.calibration.source === 'preset' ? badge('프리셋 캘리브레이션(가정값)', 'b-assumed') : null));
    if (!rows.some((r) => Number.isFinite(r.theta_cdeg))) out.appendChild(infoBox('캘리브레이션이 없어 실제각을 계산할 수 없습니다(먼저 캘리브레이션).'));
    const I = ctx.identification;
    if (I && props.show_fit !== false) {
      const d = idData(rows);
      const fits = [];
      const kind = signalKind(data.meta, d, I);
      const fitOpts = fitOptions(kind);
      const Ts = (d.t_s[1] - d.t_s[0]) || 0.005;
      // 1차 맞춤을 먼저 해 2차·속도 한계의 출발점과 ARX 지연(nk)에 쓴다
      let fo = null;
      try { fo = I.fitFO(d, fitOpts); } catch (e) { out.appendChild(errorBox(`1차 맞춤 실패: ${e.message}`)); }
      structures.forEach((s, i) => {
        const fn = I[FIT[s]];
        if (!fn) return;
        try {
          const f = s === 'fo' && fo ? fo : s === 'arx' ? fn(d, { na: 2, nb: 2, nk: arxDelay(fo, Ts), Ts_s: Ts, ...fitOpts }) : fn(d, { ...fitOpts, ...(fo ? { init_fo: fo } : {}) });
          if (s === 'arx' && !f.cont) { out.appendChild(infoBox(`ARX: 연속 시간 모델로 바꾸지 못해 겹쳐 그리지 않습니다${f.warn ? ` (${f.warn})` : ''}. ${kind === 'step' ? '스텝 하나로는 ARX가 잘 정해지지 않습니다 — PRBS 기록을 쓰세요.' : '차수(na)를 줄이거나 기록 주기를 늘려 보세요. 다른 구조의 결과를 쓰세요.'}`)); return; }
          const yhat = I.predictServo(f, d, fitOpts);
          fits.push({ s, f });
          ser.push({ label: `${NAME[s]} (적합도 ${fmt(f.fit_pct, 1)}%)`, x: d.t_s, y: yhat.map((v) => v * 18000 / Math.PI / 100), ...styleOf(i + 1), width: 1.5 });
        } catch (e) { out.appendChild(errorBox(`${NAME[s]} 맞춤 실패: ${e.message}`)); }
      });
      if (fits.length) {
        out.appendChild(table(['구조', 'K', 'τ (s)', 'Td (s)', 'ωn', 'ζ', 'vmax (rad/s)', '적합도 %'], fits.map(({ s, f }) => [NAME[s], fmt(f.K), fmt(f.tau_s), fmt(f.Td_s ?? (f.cont && f.cont.delay_s)), fmt(f.wn_rad_s), fmt(f.zeta), fmt(f.vmax_rad_s), fmt(f.fit_pct, 1)])));
        const best = fits.slice().sort((a, b) => (b.f.fit_pct ?? -1e9) - (a.f.fit_pct ?? -1e9))[0];
        let chosen = best;
        const sel = h('select', { onchange: (e) => { chosen = fits.find((x) => x.s === e.target.value); } }, fits.map(({ s }) => h('option', { value: s, selected: s === best.s }, NAME[s])));
        out.appendChild(h('div', { class: 'row' }, h('label', null, '저장할 모델 ', sel),
          h('button', { class: 'btn primary', onclick: async () => {
            const model = ctx.control && ctx.control.currentModel ? ctx.control.currentModel('ball') : null;
            const res = I.buildResult({ servo: chosen.f, servo_model: (data.meta.device && data.meta.device.servo_model) || ctx.settings.device.servo_model, calibration: data.meta.calibration, K_b: model ? model.K_b : null, data_sessions: [data.meta.session_id], provenance: data.meta.provenance || data.src.provenance });
            const rec = { ...res, created_at: res.created_at || isoLocal() };
            await ctx.db.put('id_results', rec);
            if (ctx.control.refreshIdResult) await ctx.control.refreshIdResult();
            if (ctx.events && data.meta.chapter_id) ctx.events.emit('finished', { meta: data.meta, complete: true, id_saved: true });
            toast('식별 결과를 저장했습니다. 이후 "서보 포함" 모델이 이 결과를 씁니다.', 'ok');
          } }, '식별 결과 저장'),
          h('button', { class: 'btn', onclick: () => download('result.json', JSON.stringify(I.buildResult({ servo: chosen.f, servo_model: ctx.settings.device.servo_model, calibration: data.meta.calibration, K_b: null, data_sessions: [data.meta.session_id], provenance: data.meta.provenance }), null, 2), 'application/json') }, 'result.json 내려받기')));
      }
    }
    plot.setSeries(ser);
  };

  if (source !== 'sample') ctl.appendChild(h('button', { class: 'btn primary', onclick: () => record() }, `장치로 기록(${sig.kind} ${sig.from_deg ?? ''}→${sig.to_deg ?? ''}°)`));
  if (source !== 'device') ctl.appendChild(h('button', { class: 'btn', onclick: () => loadSample() }, '샘플 불러오기'));
  if (source !== 'device') loadSample().catch((e) => msg.appendChild(errorBox(`샘플 불러오기 오류: ${e.message}`)));
  return { unmount() { plot.destroy(); } };
}
