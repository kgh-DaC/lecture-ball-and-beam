// 세션·샘플·슬롯·시뮬레이션 참조 문자열 해석 (chapter-format §3.1, §5.3).
// 위젯(overlay-plot, metrics-table, compare-bars, sample-compare)이 같은 해석을 쓴다.
// 참조: "chapter" | "session:<id>" | "sample:<id>" | "slot:<slot_id>" | "sim:<controller_id>" | { slot } | "<sample_id>"

import { practiceParamsFor } from './practice.js';
import { simSourceLabel } from './twin/lib.js';

const RAD2CDEG = 18000 / Math.PI;

/** simulate 결과 → 세션 행 형식(mm, cdeg). y_mm = 실제 위치, y_filt_mm = 측정(필터) */
export function simToRows(sim) {
  const rows = [];
  for (let k = 0; k < sim.t_s.length; k++) {
    const r = {
      t_s: sim.t_s[k],
      ref_mm: sim.ref_m[k] * 1000,
      y_mm: sim.y_m[k] * 1000,
      y_filt_mm: Number.isFinite(sim.y_meas_m[k]) ? sim.y_meas_m[k] * 1000 : NaN,
      u_cdeg: Math.round(sim.u_rad[k] * RAD2CDEG),
      servo_pot_cdeg: Number.isFinite(sim.theta_rad[k]) ? Math.round(sim.theta_rad[k] * RAD2CDEG) : NaN,
      lost: Number.isFinite(sim.y_meas_m[k]) ? 0 : 1,
    };
    const d = sim.debug && sim.debug[k];
    if (d) for (const [key, v] of Object.entries(d)) r[`dbg_${key}`] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    rows.push(r);
  }
  return rows;
}

/** 모델 예측(잡음 없음). 반환 { rows, meta } 또는 null */
export function predict(ctx, { controller, plant = 'ball', profile, t_end_s, y0_m, lim_cdeg }) {
  const c = ctx.control;
  if (!c || !c.simulate || !c.currentModel || !controller || !profile) return null;
  let model = c.currentModel(plant === 'ball+servo' || plant === 'ball_servo' ? 'ball+servo' : 'ball');
  if (lim_cdeg != null && model) model = { ...model, u_lim_rad: lim_cdeg * Math.PI / 18000 };
  const sim = c.simulate(model, { id: controller.id, params: controller.params || {} }, profile, { noise: false, ...(t_end_s ? { t_end_s } : {}), ...(y0_m != null ? { y0_m } : {}) });
  const meta = {
    session_id: `pred-${controller.id}`, title: `모델 예측(${plant === 'ball+servo' ? '서보 포함' : '서보 무시'})`, provenance: 'simulated', source: 'prediction',
    controller: { id: controller.id, params: controller.params }, setpoint_profile: profile, model_kind: model.kind, device: { lim_cdeg: lim_cdeg ?? Math.round(model.u_lim_rad * RAD2CDEG) },
  };
  return { rows: simToRows(sim), meta };
}

function parseRef(ref) {
  if (ref && typeof ref === 'object') { if (ref.slot) return { kind: 'slot', id: ref.slot }; if (ref.session) return { kind: 'session', id: ref.session }; if (ref.sample) return { kind: 'sample', id: ref.sample }; }
  const s = String(ref);
  if (s === 'chapter') return { kind: 'chapter' };
  const m = s.match(/^(session|sample|slot|sim):(.+)$/);
  if (m) return { kind: m[1], id: m[2] };
  return { kind: 'sample', id: s };
}

function fromSession(s, ref) {
  return {
    ref, kind: 'session', id: s.meta.session_id, label: s.meta.title || s.meta.session_id, meta: s.meta, rows: s.rows,
    provenance: s.meta.provenance, tier: null, badges: simSourceLabel(s.meta) ? [simSourceLabel(s.meta)] : [],
    conditionsUnknown: s.meta.conditions && s.meta.conditions.status === 'unknown',
  };
}

function fromSample(full, ref, extra = {}) {
  const e = full.entry || {};
  return {
    ref, kind: 'sample', id: full.id || e.id, label: e.title || e.id, meta: full.meta, rows: full.rows, entry: e,
    provenance: e.provenance || full.meta.provenance, tier: full.tier || e.tier, badges: e.badges || [],
    conditionsUnknown: (e.conditions && e.conditions.status === 'unknown') || (full.meta.conditions && full.meta.conditions.status === 'unknown'),
    ...extra,
  };
}

/**
 * 참조 목록 해석. 반환 배열(입력 순서, "chapter"는 여러 개로 펼침). 실패 항목은 { error } 또는 { empty }.
 * opts: { chapterLimit = 3, chapterKind = 'control', includeIncomplete = false }
 */
export async function resolveSources(ctx, refs, opts = {}) {
  const out = [];
  const list = Array.isArray(refs) ? refs : [refs];
  for (const ref of list) {
    const r = parseRef(ref);
    try {
      if (r.kind === 'chapter') {
        if (!ctx.chapter || !ctx.store) continue;
        let ss = await ctx.store.sessions.list({ chapter_id: ctx.chapter.id, kind: opts.chapterKind || undefined });
        if (!opts.includeIncomplete) ss = ss.filter((m) => m.complete !== false || (m.stats && m.stats.n > 5));
        ss = ss.slice(0, opts.chapterLimit ?? 3);
        for (const m of ss) { const s = await ctx.store.sessions.get(m.session_id); if (s) out.push(fromSession(s, 'chapter')); }
        if (!ss.length) out.push({ ref, kind: 'chapter', empty: true, label: '이 챕터의 내 세션', message: '아직 이 챕터에서 저장한 세션이 없습니다.' });
      } else if (r.kind === 'session') {
        const s = await ctx.store.sessions.get(r.id);
        out.push(s ? fromSession(s, ref) : { ref, error: `세션 ${r.id} 이 없습니다` });
      } else if (r.kind === 'sample') {
        out.push(fromSample(await ctx.samples.get(r.id), ref));
      } else if (r.kind === 'slot') {
        const res = await ctx.samples.resolveSlot(r.id);
        if (res.empty) out.push({ ref, kind: 'slot', slot: r.id, empty: true, label: `슬롯 ${(res.slot && res.slot.label) || r.id}`, message: '아직 샘플이 없습니다 — 실습 후 승격할 수 있습니다.' });
        else if (res.error) out.push({ ref, kind: 'slot', slot: r.id, error: res.error });
        else out.push(fromSample(res, ref, { slot: r.id, slotLabel: res.slot && res.slot.label, candidates: res.candidates, mismatched: res.mismatched }));
      } else if (r.kind === 'sim') {
        const p = ctx.chapter && ctx.chapter.practice;
        const C = ctx.control && ctx.control.getController ? ctx.control.getController(r.id) : null;
        const params = practiceParamsFor(p, r.id).safe;
        const pr = C && p ? predict(ctx, { controller: { id: r.id, params }, plant: p.model || 'ball', profile: p.setpoint_profile }) : null;
        out.push(pr ? { ref, kind: 'prediction', id: `sim:${r.id}`, label: pr.meta.title, meta: pr.meta, rows: pr.rows, provenance: 'simulated' } : { ref, error: `시뮬레이션 ${r.id} 을 만들 수 없습니다` });
      }
    } catch (e) {
      out.push({ ref, error: e.message });
    }
  }
  return out;
}

/** 스텝 시작 시각(첫 ref 변화). 없으면 0 */
export function stepTime(rows) {
  let prev = null;
  for (const r of rows) {
    const v = r.ref_mm;
    if (!Number.isFinite(v)) continue;
    if (prev != null && Math.abs(v - prev) > 0.5) return r.t_s;
    prev = v;
  }
  return 0;
}

/** 신호 → 단위 묶음(같은 그래프에 단위가 같은 것만) */
export const SIGNAL_INFO = {
  y_mm: { label: '측정 거리 y(표면)', unit: 'mm' }, y_filt_mm: { label: '필터 측정 거리', unit: 'mm' }, ref_mm: { label: '설정값(측정 거리)', unit: 'mm' },
  u_cdeg: { label: '명령각 u', unit: 'cdeg' }, servo_pot_cdeg: { label: '서보 실제각(pot)', unit: 'cdeg' }, cmd_echo_cdeg: { label: '적용 명령', unit: 'cdeg' },
  cmd_cdeg: { label: '명령각', unit: 'cdeg' }, theta_cdeg: { label: '실제각(pot)', unit: 'cdeg' }, pot_raw: { label: 'pot 원값', unit: 'LSB' },
};
export function unitOf(sig) { return (SIGNAL_INFO[sig] && SIGNAL_INFO[sig].unit) || (sig.startsWith('dbg_') ? 'SI' : ''); }
