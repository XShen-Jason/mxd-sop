import type { AppOptions, CatalogItem, Group, ManagerGroup, Page, Role, Session, User } from '../types';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

const errorMessages: Record<string, string> = {
  'request-failed': '请求失败，请稍后重试',
  unauthorized: '登录状态已失效，请重新登录',
  forbidden: '无权执行此操作',
  'invalid-input': '输入内容不符合要求',
  'username-taken': '用户名已存在',
  'user-not-found': '账号不存在',
  'last-super-admin': '必须保留至少一个已启用的超级管理账号',
  conflict: '数据状态已变化，请刷新后重试',
  'unknown-server': '服务器不存在',
  'unknown-item': '物品不存在',
  'invalid-quantity': '数量不符合要求',
  'catalog-unavailable': '物品目录暂不可用',
  'idempotency-conflict': '请勿重复提交不同内容',
  'group-not-found': '申请记录不存在',
  'invalid-status-transition': '当前状态无法执行此操作',
  'invalid-cursor': '分页信息已失效，请刷新后重试',
  'invalid-status': '状态筛选无效',
  'generation-failed': '指令生成失败',
  'internal-error': '服务暂时不可用'
};

function displayError(code: string, message?: string) {
  if (message && /[\u3400-\u9fff]/u.test(message)) return message;
  return errorMessages[code] ?? '请求失败，请稍后重试';
}

const GET_CACHE_TTL_MS = 15_000;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const eventConnections = new Map<string, { source: EventSource; users: number; closeTimer?: number }>();
export const OPERATION_GROUPS_LOCAL_CHANGE_EVENT = 'operation-groups-local-change';
let cacheEpoch = 0;

/** Drop cached reads after a mutation or an SSE change notification. */
export function invalidateApiCache() {
  cacheEpoch += 1;
  responseCache.clear();
  inFlightRequests.clear();
}

export function resetApiClientState() {
  invalidateApiCache();
  for (const connection of eventConnections.values()) connection.source.close();
  eventConnections.clear();
}

export class ApiClient {
  constructor(private readonly role: Role = 'customer', private readonly token?: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? 'GET').toUpperCase();
    const cacheable = method === 'GET' && !init.signal;
    const cacheKey = `${this.role}:${this.token ?? 'cookie'}:${path}`;
    if (cacheable) {
      const cached = responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value as T;
      if (cached) responseCache.delete(cacheKey);
      const pending = inFlightRequests.get(cacheKey);
      if (pending) return pending as Promise<T>;
    }
    const requestEpoch = cacheEpoch;
    const requestPromise = this.fetchRequest<T>(path, init, method, cacheable, cacheKey, requestEpoch);
    if (!cacheable) return requestPromise;
    inFlightRequests.set(cacheKey, requestPromise);
    void requestPromise.then(() => this.clearCompletedRequest(cacheKey, requestPromise), () => this.clearCompletedRequest(cacheKey, requestPromise));
    return requestPromise;
  }

  private async fetchRequest<T>(path: string, init: RequestInit, method: string, cacheable: boolean, cacheKey: string, requestEpoch: number): Promise<T> {
    const headers = new Headers(init.headers);
    // Authentication is carried by the same-origin HttpOnly session cookie.
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
      const code = payload.error?.code ?? 'request-failed';
      throw new ApiError(code, displayError(code, payload.error?.message), response.status);
    }
    const value = response.status === 204 ? undefined as T : await response.json() as T;
    if (cacheable && requestEpoch === cacheEpoch) responseCache.set(cacheKey, { expiresAt: Date.now() + GET_CACHE_TTL_MS, value });
    if (method !== 'GET') {
      invalidateApiCache();
      if (path.includes('/operation-groups') && typeof window !== 'undefined') {
        window.dispatchEvent(new Event(OPERATION_GROUPS_LOCAL_CHANGE_EVENT));
      }
    }
    return value;
  }

  private clearCompletedRequest(cacheKey: string, requestPromise: Promise<unknown>) {
    if (inFlightRequests.get(cacheKey) === requestPromise) inFlightRequests.delete(cacheKey);
  }

  login(username: string, password: string) { return this.request<Session>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }); }
  logout() { return this.request<void>('/api/v1/auth/logout', { method: 'POST' }); }
  me() { return this.request<User>('/api/v1/auth/me'); }
  users() { return this.request<{ users: User[] }>('/api/v1/auth/users'); }
  createUser(input: { username: string; password: string; displayName: string; role: Role }) { return this.request<User>('/api/v1/auth/users', { method: 'POST', body: JSON.stringify(input) }); }
  updateUser(id: string, input: Partial<{ password: string; displayName: string; role: Role; active: boolean }>) { return this.request<User>(`/api/v1/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  deleteUser(id: string) { return this.request<User>(`/api/v1/auth/users/${encodeURIComponent(id)}/delete`, { method: 'POST' }); }

  options() { return this.request<AppOptions>('/api/v1/operation-groups/options'); }
  searchItems(query: string, signal?: AbortSignal, cursor?: string, limit = 12) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return this.request<{ items: CatalogItem[]; nextCursor: string | null; totalCount: number }>(`/api/v1/item-catalog/search?${params}`, { signal });
  }
  listItemsByClass(itemClass: string, signal?: AbortSignal, cursor?: string, limit = 8) {
    const params = new URLSearchParams({ class: itemClass, limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return this.request<{ items: CatalogItem[]; nextCursor: string | null; totalCount: number }>(`/api/v1/item-catalog/by-class?${params}`, { signal });
  }
  submit(input: unknown) {
    const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return this.request<Group>('/api/v1/operation-groups', { method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify(input) });
  }
  updateGroup(id: string, input: unknown) { return this.request<Group>(`/api/v1/operation-groups/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }); }
  mine(cursor?: string, limit = 20, status?: string | string[], kind?: 'issuance' | 'regular') { const params = new URLSearchParams({ limit: String(limit) }); if (cursor) params.set('cursor', cursor); if (Array.isArray(status)) status.forEach((value) => params.append('status', value)); else if (status) params.set('status', status); if (kind) params.set('kind', kind); return this.request<Page<Group>>(`/api/v1/operation-groups/mine?${params}`); }
  reminders(cursor?: string, limit = 20, kind?: 'issuance' | 'regular') { const params = new URLSearchParams({ limit: String(limit) }); if (cursor) params.set('cursor', cursor); if (kind) params.set('kind', kind); return this.request<Page<Group>>(`/api/v1/operation-groups/reminders?${params}`); }
  workspaceCounts() { return this.request<{ pending?: number; ready?: number; reminders?: number; reminderIssuance?: number; reminderRegular?: number; ownIssuance?: number; ownRegular?: number }>('/api/v1/operation-groups/workspace-counts'); }
  events() {
    const connectionKey = `${this.role}:${this.token ?? 'cookie'}`;
    let connection = eventConnections.get(connectionKey);
    if (!connection || connection.source.readyState === EventSource.CLOSED) {
      connection = { source: new EventSource('/api/v1/operation-groups/events', { withCredentials: true }), users: 0 };
      eventConnections.set(connectionKey, connection);
    }
    if (connection.closeTimer !== undefined) { window.clearTimeout(connection.closeTimer); delete connection.closeTimer; }
    connection.users += 1;
    const listeners: Array<{ type: string; listener: EventListenerOrEventListenerObject }> = [];
    let closed = false;
    return {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => { listeners.push({ type, listener }); connection!.source.addEventListener(type, listener); },
      close: () => {
        if (closed) return;
        closed = true;
        for (const { type, listener } of listeners) connection!.source.removeEventListener(type, listener);
        if (!connection || --connection.users > 0 || connection.closeTimer !== undefined) return;
        connection.closeTimer = window.setTimeout(() => {
          if (!connection || connection.users > 0) return;
          connection.source.close();
          if (eventConnections.get(connectionKey) === connection) eventConnections.delete(connectionKey);
        }, 50);
      }
    };
  }
  cancel(id: string) { return this.request<Group>(`/api/v1/operation-groups/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); }
  queue(serverId?: string, cursor?: string, limit = 20) { const params = new URLSearchParams({ limit: String(limit) }); if (serverId) params.set('serverId', serverId); if (cursor) params.set('cursor', cursor); return this.request<Page<ManagerGroup>>(`/api/v1/manager/operation-groups/queue?${params}`); }
  reviews(serverId?: string, cursor?: string, limit = 20) { const params = new URLSearchParams({ limit: String(limit) }); if (serverId) params.set('serverId', serverId); if (cursor) params.set('cursor', cursor); return this.request<Page<ManagerGroup>>(`/api/v1/manager/operation-groups/reviews?${params}`); }
  archive(status?: string | string[], serverId?: string, cursor?: string, limit = 20, kind?: 'issuance' | 'regular') { const params = new URLSearchParams({ limit: String(limit) }); if (Array.isArray(status)) status.forEach((value) => params.append('status', value)); else if (status) params.set('status', status); if (serverId) params.set('serverId', serverId); if (cursor) params.set('cursor', cursor); if (kind) params.set('kind', kind); return this.request<Page<ManagerGroup>>(`/api/v1/manager/operation-groups/archive?${params}`); }
  approve(id: string) { return this.request<ManagerGroup>(`/api/v1/manager/operation-groups/${encodeURIComponent(id)}/approve`, { method: 'POST' }); }
  reject(id: string, reason?: string) { return this.request<ManagerGroup>(`/api/v1/manager/operation-groups/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }); }
  issue(id: string, executionNote?: string) { return this.request<ManagerGroup>(`/api/v1/manager/operation-groups/${encodeURIComponent(id)}/issue`, { method: 'POST', body: JSON.stringify(executionNote ? { executionNote } : {}) }); }
  remind(id: string) { return this.request<Group>(`/api/v1/super-admin/operation-groups/${encodeURIComponent(id)}/remind`, { method: 'POST' }); }
  complete(id: string, executionNote?: string) { return this.request<ManagerGroup>(`/api/v1/manager/operation-groups/${encodeURIComponent(id)}/complete`, { method: 'POST', body: JSON.stringify(executionNote ? { executionNote } : {}) }); }
}
