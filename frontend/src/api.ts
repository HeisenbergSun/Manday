/**
 * API 客户端 — 统一封装鉴权与 409 冲突处理
 */
const BASE = '/api';

async function request(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (res.status === 409) {
    // LWW 冲突：该行已被他人修改，提示刷新（不静默覆盖）
    throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  getBoard: (boardId: string) => request(`/boards/${boardId}/items`),
  updateCell: (itemId: string, columnId: string, value: unknown, version: number) =>
    request(`/items/${itemId}/cell`, {
      method: 'PATCH',
      body: JSON.stringify({ columnId, value, version }),
    }),
  batchUpdate: (changes: { itemId: string; columnId: string; value: unknown }[]) =>
    request('/items/batch', { method: 'POST', body: JSON.stringify({ changes }) }),
  softDelete: (itemIds: string[]) =>
    request('/items/soft-delete', { method: 'POST', body: JSON.stringify({ itemIds }) }),
  importExcel: (boardId: string, formData: FormData) =>
    fetch(`${BASE}/boards/${boardId}/import`, { method: 'POST', body: formData }),

  // ---- AI（WorkBuddy 企业版网关，SSE）----
  aiConfirmTool: (toolCallId: string, tool: string, payload: unknown) =>
    request('/ai/tool/confirm', { method: 'POST', body: JSON.stringify({ toolCallId, tool, payload }) }),
};

/** AI 流式对话：返回 SSE reader，前端逐段渲染 */
export function aiChatStream(boardId: string | undefined, message: string) {
  return fetch('/ai/chat/stream', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boardId, message }),
  }).then((r) => r.body!.getReader());
}
