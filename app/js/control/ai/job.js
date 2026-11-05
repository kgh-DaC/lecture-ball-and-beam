// job.js — 학습 작업(job)을 끝까지 돌리는 도우미 (ai-extension §2.0)
// UI는 job.step()을 프레임마다 직접 부르고, Node·도구는 runJob을 쓴다.

/** job을 끝까지 실행. onProgress(progress)는 step마다 한 번. → job.result() */
export function runJob(job, onProgress = null, budget = undefined) {
  let guard = 0;
  while (!job.done) {
    const p = job.step(budget);
    if (onProgress) onProgress(p);
    if (++guard > 1e7) throw new Error('runJob: 끝나지 않는 job');
  }
  return job.result();
}
