/**
 * API 客户端 — 统一封装鉴权与 409 冲突处理
 */
const BASE = '/api';
const TOKEN_KEY = 'manday_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function authHeaders(): Record<string, string> {
  return getToken() ? { Authorization: `Bearer ${getToken()}` } : {};
}

async function request(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
    ...init,
  });
  if (res.status === 401) {
    // 会话失效：清 token 回登录页
    clearToken();
    if (location.pathname !== '/login') location.reload();
    throw Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' });
  }
  if (res.status === 409) {
    // LWW 冲突：该行已被他人修改，提示刷新（不静默覆盖）
    throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' });
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  /** 开发登录（后端 DEV_LOGIN=true 时可用）：一键获取演示账号 JWT */
  devLogin: async () => {
    const j = await request('/auth/dev-login', { method: 'POST' });
    setToken(j.token);
    localStorage.setItem('userId', j.user.id);
    return j.user as { id: string; name: string; email: string };
  },
  /** 手动粘贴 token 登录（SSO 未配置时的备用通道） */
  loginWithToken: (token: string) => { setToken(token); },

  getBoards: () => request('/boards'),
  getBoard: (boardId: string) => request(`/boards/${boardId}/items`),
  item: (itemId: string) => request(`/items/${itemId}`),
  itemUpdates: (itemId: string) => request(`/items/${itemId}/updates`),
  itemSubitems: (itemId: string) => request(`/items/${itemId}/subitems`),
  itemHistory: (itemId: string) => request(`/items/${itemId}/history`),
  addItemUpdate: (itemId: string, body: string) =>
    request(`/items/${itemId}/updates`, { method: 'POST', body: JSON.stringify({ body }) }),
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
    fetch(`${BASE}/boards/${boardId}/import`, {
      method: 'POST', body: formData, credentials: 'include', headers: authHeaders(),
    }),

  // ---- Dashboard 预置组件（跨 Board 聚合）----
  dashboardBattery: (boardIds: string[]) =>
    request(`/dashboards/battery?boardIds=${boardIds.join(',')}`),
  dashboardStatusDist: (boardIds: string[]) =>
    request(`/dashboards/status-dist?boardIds=${boardIds.join(',')}`),
  dashboardNumbers: (boardIds: string[]) =>
    request(`/dashboards/numbers?boardIds=${boardIds.join(',')}`),

  // ---- 通知 / 搜索 ----
  unread: () => request('/notifications/unread'),
  search: (q: string) => request(`/search?q=${encodeURIComponent(q)}`),

  // ---- 模板中心 ----
  templates: () => request('/templates'),
  instantiateTemplate: (key: string, name: string) =>
    request(`/templates/${key}/instantiate`, { method: 'POST', body: JSON.stringify({ name }) }),

  // ---- AI（WorkBuddy 企业版网关，SSE）----
  aiConfirmTool: (toolCallId: string, tool: string, payload: unknown) =>
    request('/ai/tool/confirm', { method: 'POST', body: JSON.stringify({ toolCallId, tool, payload }) }),
};

/** AI 流式对话：返回 SSE reader，前端逐段渲染 */
export async function aiChatStream(boardId: string | undefined, message: string) {
  const res = await fetch(`${BASE}/ai/chat/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ boardId, message }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`AI 服务不可用（${res.status}）`);
  }
  return res.body.getReader();
}
