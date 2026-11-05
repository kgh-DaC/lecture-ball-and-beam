// nn-policy.js — 신경망 정책 제어기 (ai-extension §5.1, 18·19장)
//
//   관측 o = [e, v, u_prev]  (obs.PolicyObserver, 학습 환경과 같은 코드)
//   u_nn = u_lim·tanh( MLP( o / scale ) )      (policy.js, 가중치는 ai/bundled.js 또는 registerPolicy('user-nn'))
//   최종 u = 안전 래퍼(ai-safety.js): 폴백 PD, 포화, (실기) 각도·변화율 제한
// 번들 정책: es(진화 전략, 18장), bc(행동복제, 19장), dagger(DAgger, 19장) — 모두 가정 서보 모델 위 시뮬레이션 학습.
import { SafePolicyController, aiSafetySpecs, AI_DEBUG_KEYS } from './ai-safety.js';
import { getPolicyJSON, policyFor } from '../ai/policy.js';

export default class NnPolicy extends SafePolicyController {
  static meta = {
    id: 'nn-policy',
    label: '신경망 정책',
    family: 'ai',
    linear: false,
    params: [
      { key: 'policy', label: '정책', unit: '–', type: 'enum', default: 'es',
        options: [
          { value: 'es', label: '진화 전략(ES, 번들)' },
          { value: 'bc', label: '행동복제(BC, 번들)' },
          { value: 'dagger', label: 'DAgger (번들)' },
          { value: 'user', label: '내가 학습한 정책' },
        ],
        help: "user = 이 브라우저에서 학습해 registerPolicy('user-nn')로 올린 정책(없으면 번들 ES 로 대체, debug.policy_source 에 표시)" },
      ...aiSafetySpecs(),
    ],
    debug_keys: [...AI_DEBUG_KEYS],
    needs_model: false,
  };

  _resolvePolicy() {
    const name = this.params.policy;
    const tryGet = (n, src) => { const j = getPolicyJSON(n); return j ? { policy: policyFor(j), source: src } : null; };
    if (name === 'user') return tryGet('user-nn', 'user') || tryGet('es', 'bundled-es') || { policy: null, source: 'none' };
    return tryGet(name, `bundled-${name}`) || tryGet('es', 'bundled-es') || { policy: null, source: 'none' };
  }
}
