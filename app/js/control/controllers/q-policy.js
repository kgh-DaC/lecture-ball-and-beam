// q-policy.js — Q 표 정책 제어기 (ai-extension §5.2, 17장)
//
//   관측 o = [e, v, u_prev] 중 (e, v) 를 칸으로 나눠 탐욕 행동 argmax_a Q(s, a)  (u_prev 는 표에 없다)
//   smooth = true 이면 이웃 칸 중심의 Q 를 쌍선형 보간한 뒤 argmax (구분 경계 비교용)
//   최종 u = 안전 래퍼(ai-safety.js): 폴백 PD, 포화, (실기) 각도·변화율 제한
import { SafePolicyController, aiSafetySpecs, AI_DEBUG_KEYS } from './ai-safety.js';
import { getPolicyJSON, policyFor } from '../ai/policy.js';

export default class QPolicy extends SafePolicyController {
  static meta = {
    id: 'q-policy',
    label: 'Q 표 정책',
    family: 'ai',
    linear: false,
    params: [
      { key: 'policy', label: '정책', unit: '–', type: 'enum', default: 'bundled',
        options: [
          { value: 'bundled', label: '번들 Q 표' },
          { value: 'user', label: '내가 학습한 Q 표' },
        ],
        help: "user = 이 브라우저에서 학습해 registerPolicy('user-q')로 올린 표(없으면 번들 표로 대체, debug.policy_source 에 표시)" },
      ...aiSafetySpecs(),
      { key: 'smooth', label: 'Q 보간', unit: '–', type: 'bool', default: false,
        help: '켜면 이웃 칸 Q 를 쌍선형 보간한 뒤 행동을 고른다(칸 경계에서 행동이 덜 튄다)' },
    ],
    debug_keys: [...AI_DEBUG_KEYS],
    needs_model: false,
  };

  _resolvePolicy() {
    const opts = { smooth: !!this.params.smooth };
    const tryGet = (n, src) => { const j = getPolicyJSON(n); return j ? { policy: policyFor(j, opts), source: src } : null; };
    if (this.params.policy === 'user') return tryGet('user-q', 'user') || tryGet('q', 'bundled-q') || { policy: null, source: 'none' };
    return tryGet('q', 'bundled-q') || { policy: null, source: 'none' };
  }
}
