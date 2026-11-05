// registry.js — 제어기 목록 (러너·UI는 이 목록에서 동적으로 만든다; 이름 하드코딩 금지)
import OpenLoop from './controllers/openloop.js';
import Pid from './controllers/pid.js';
import Relay from './controllers/relay.js';
import GainSchedule from './controllers/gain-schedule.js';
import Mrac from './controllers/mrac.js';
import Lqr from './controllers/lqr.js';
import Smc from './controllers/smc.js';
import NnPolicy from './controllers/nn-policy.js';
import QPolicy from './controllers/q-policy.js';

export const controllers = [OpenLoop, Pid, Relay, GainSchedule, Mrac, Lqr, Smc, NnPolicy, QPolicy];

export function getController(id) {
  const C = controllers.find((c) => c.meta.id === id);
  if (!C) throw new Error(`알 수 없는 제어기 id: ${id}`);
  return C;
}
