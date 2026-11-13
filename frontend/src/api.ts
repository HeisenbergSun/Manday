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
  getBoard: (boardId: string) => request(`/boards/${boardId}`),
  createItem: (boardId: string, name: string, groupId?: string) =>
    request(`/boards/${boardId}/items`, { method: 'POST', body: JSON.stringify({ name, groupId }) }),
  updateItem: (itemId: string, patch: { name?: string; groupId?: string; done?: boolean }) =>
    request(`/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addSubitem: (itemId: string, name: string) =>
    request(`/items/${itemId}/subitems`, { method: 'POST', body: JSON.stringify({ name }) }),
  reorderItems: (orders: { id: string; position: number }[]) =>
    request(`/items/reorder`, { method: 'POST', body: JSON.stringify({ orders }) }),
  listMembers: (boardId: string) => request(`/boards/${boardId}/members`),
  addMember: (boardId: string, userId: string, role: string) =>
    request(`/boards/${boardId}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) }),
  removeMember: (boardId: string, memberId: string) =>
    request(`/boards/${boardId}/members/${memberId}`, { method: 'DELETE' }),
  listUsers: () => request(`/users`),
  recycleBin: (boardId: string) => request(`/boards/${boardId}/recycle-bin`),
  restoreItems: (boardId: string, itemIds: string[]) =>
    request(`/boards/${boardId}/restore`, { method: 'POST', body: JSON.stringify({ itemIds }) }),
  addColumn: (boardId: string, name: string, type: string) =>
    request(`/boards/${boardId}/columns`, { method: 'POST', body: JSON.stringify({ name, type }) }),
  renameColumn: (boardId: string, colId: string, name: string) =>
    request(`/boards/${boardId}/columns/${colId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateColumnSettings: (boardId: string, colId: string, settings: unknown) =>
    request(`/boards/${boardId}/columns/${colId}`, { method: 'PATCH', body: JSON.stringify({ settings }) }),
  deleteColumn: (boardId: string, colId: string) =>
    request(`/boards/${boardId}/columns/${colId}`, { method: 'DELETE' }),
  addGroup: (boardId: string, name: string) =>
    request(`/boards/${boardId}/groups`, { method: 'POST', body: JSON.stringify({ name }) }),
  renameGroup: (boardId: string, gid: string, name: string) =>
    request(`/boards/${boardId}/groups/${gid}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteGroup: (boardId: string, gid: string) =>
    request(`/boards/${boardId}/groups/${gid}`, { method: 'DELETE' }),
  // 视图（P1-3）
  listViews: (boardId: string) => request(`/boards/${boardId}/views`),
  createView: (boardId: string, name: string, viewType: string, config: unknown) =>
    request(`/boards/${boardId}/views`, { method: 'POST', body: JSON.stringify({ name, viewType, config }) }),
  updateView: (boardId: string, viewId: string, patch: { name?: string; viewType?: string; config?: unknown }) =>
    request(`/boards/${boardId}/views/${viewId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteView: (boardId: string, viewId: string) =>
    request(`/boards/${boardId}/views/${viewId}`, { method: 'DELETE' }),
  lockView: (boardId: string, viewId: string, locked: boolean) =>
    request(`/boards/${boardId}/views/${viewId}/${locked ? 'lock' : 'unlock'}`, { method: 'POST' }),
  // 用户偏好（P1-4）
  getPrefs: (boardId: string) => request(`/boards/${boardId}/prefs`),
  putPrefs: (boardId: string, patch: { defaultView?: string; viewId?: string | null; prefs?: unknown }) =>
    request(`/boards/${boardId}/prefs`, { method: 'PUT', body: JSON.stringify(patch) }),
  // 自动化（P1-9）
  autoList: (boardId: string) => request(`/boards/${boardId}/automations`),
  autoCreate: (boardId: string, dto: { trigger: unknown; action: unknown; name?: string; source?: string }) =>
    request(`/boards/${boardId}/automations`, { method: 'POST', body: JSON.stringify(dto) }),
  autoRemove: (boardId: string, autoId: string) =>
    request(`/boards/${boardId}/automations/${autoId}`, { method: 'DELETE' }),
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
