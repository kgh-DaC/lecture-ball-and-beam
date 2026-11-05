// AI 학습 작업 정의(위젯 → Worker 또는 주 스레드). 계산은 모두 control/ai/* 의 job(ai-extension §2.0)이 한다.
// 여기서는 "어떤 job을 만들고, 끝나면 무엇을 돌려줄지"만 정한다. Worker(worker.js)와 주 스레드 대체 실행(runner.js)이 같은 코드를 쓴다.
//
// spec = { kind: 'nn-id' | 'qlearn' | 'es' | 'imitation', opts }
// 반환 { job, budget, finish(stopped) → payload(구조화 복제 가능한 순수 객체) }

import { generateDataset, createIdTrainer, compareModels } from '../../control/ai/nn-id.js';
import { createQLearner } from '../../control/ai/qlearn.js';
import { createES } from '../../control/ai/es.js';
import { createImitation } from '../../control/ai/imitation.js';

/** budget: Worker에서 한 번에 돌릴 양(진행 메시지 간격). 주 스레드 대체 실행은 main 값을 쓴다 */
const BUDGET = {
  'nn-id': { worker: 1, main: 1 },
  qlearn: { worker: 20, main: 5 },
  es: { worker: 1, main: 1 },
  imitation: { worker: 1, main: 1 },
};

export function buildTask(spec, where = 'worker') {
  const o = spec.opts || {};
  const budget = (BUDGET[spec.kind] || { worker: 1, main: 1 })[where];
  if (spec.kind === 'nn-id') {
    const ds = generateDataset(o.dataset || {});
    const job = createIdTrainer(ds, o.train || {});
    return {
      job, budget,
      finish() {
        const model = job.result();
        const horizons = o.horizons || [1, 5, 20, 50];
        let compare = null;
        try { compare = compareModels(model, ds, { horizons }); } catch (e) { compare = { error: e.message }; }
        return { model, compare, test_traj: ds.test_traj, dataset_meta: ds.meta };
      },
    };
  }
  if (spec.kind === 'qlearn') {
    const job = createQLearner(o);
    return { job, budget, finish: () => ({ table: job.result() }) };
  }
  if (spec.kind === 'es') {
    const job = createES(o);
    return { job, budget, finish: () => ({ policy: job.result() }) };
  }
  if (spec.kind === 'imitation') {
    const job = createImitation(o);
    return { job, budget, finish: () => ({ policy: job.history.length ? job.result() : null }) };
  }
  throw new Error(`알 수 없는 학습 종류: ${spec.kind}`);
}
