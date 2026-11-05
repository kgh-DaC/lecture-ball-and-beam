// DOM 없이 쓰는 HTML 이스케이프(render.js가 Node에서도 돌도록 분리)
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
