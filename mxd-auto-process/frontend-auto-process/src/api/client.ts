import type { AccountSnapshot, AuditEntry, AutoMessageResult, AutoSession, CredentialType, OperatorSession, Overview, ServerRecord } from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(response.status, payload.error ?? 'request_failed');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: (signal?: AbortSignal) => request<OperatorSession>('/api/v1/operator/me', { signal }),
  login: (username: string, password: string) => request<OperatorSession>('/api/v1/operator/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  }),
  logout: () => request<void>('/api/v1/operator/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) => request<OperatorSession>('/api/v1/operator/password', {
    method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  }),
  overview: (signal?: AbortSignal) => request<Overview>('/api/v1/overview?include_logs=false', { signal }),
  logs: (serverId: string, accountId: string, signal?: AbortSignal) => request<{ logs: AuditEntry[] }>(
    `/api/v1/logs?server_id=${encodeURIComponent(serverId)}&account_id=${encodeURIComponent(accountId)}&limit=200`, { signal },
  ),
  createServer: (input: { id: string; name: string; address: string; version: string; map_id: string; enabled: boolean; spawn_rate: number; exp_rate: number; exp_max: number; drop_rate: number; meso_rate: number; domain_times: number }) => request<ServerRecord>('/api/v1/servers', { method: 'POST', body: JSON.stringify(input) }),
  updateServer: (id: string, input: Partial<{ name: string; address: string; version: string; map_id: string; enabled: boolean; spawn_rate: number; exp_rate: number; exp_max: number; drop_rate: number; meso_rate: number; domain_times: number }>) => request<ServerRecord>(`/api/v1/servers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteServer: (id: string) => request<void>(`/api/v1/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  startSession: (serverId: string, account: string, password: string, credentialType: CredentialType) => request<AutoSession>(`/api/v1/servers/${encodeURIComponent(serverId)}/sessions`, { method: 'POST', body: JSON.stringify({ account, password, credential_type: credentialType }) }),
  selectAndEnter: (sessionId: string, characterId: string) => request<AutoSession>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/select-and-enter`, { method: 'POST', body: JSON.stringify({ character_id: characterId }) }),
  stopSession: (sessionId: string) => request<void>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  createAccount: (serverId: string, input: { username: string; password: string; credential_type: CredentialType; character_id: string; character_name?: string; automation_enabled?: boolean; enabled?: boolean; session_id?: string }) => request<AccountSnapshot>(`/api/v1/servers/${encodeURIComponent(serverId)}/accounts`, { method: 'POST', body: JSON.stringify(input) }),
  updateAccount: (serverId: string, accountId: string, input: Partial<{ username: string; password: string; credential_type: CredentialType; character_id: string; character_name: string; automation_enabled: boolean; enabled: boolean }>) => request<AccountSnapshot>(`/api/v1/servers/${encodeURIComponent(serverId)}/accounts/${encodeURIComponent(accountId)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteAccount: (serverId: string, accountId: string) => request<void>(`/api/v1/servers/${encodeURIComponent(serverId)}/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
  startAccount: (serverId: string, accountId: string) => request<AccountSnapshot>(`/api/v1/servers/${encodeURIComponent(serverId)}/accounts/${encodeURIComponent(accountId)}/start`, { method: 'POST', body: '{}' }),
  stopAccount: (serverId: string, accountId: string) => request<AccountSnapshot>(`/api/v1/servers/${encodeURIComponent(serverId)}/accounts/${encodeURIComponent(accountId)}/stop`, { method: 'POST', body: '{}' }),
  reconnectAccount: (serverId: string, accountId: string) => request<AccountSnapshot>(`/api/v1/servers/${encodeURIComponent(serverId)}/accounts/${encodeURIComponent(accountId)}/reconnect`, { method: 'POST', body: '{}' }),
  sendMessage: (serverId: string, accountId: string, input: { message: string; mode: string }) => request<AutoMessageResult>(`/api/v1/servers/${encodeURIComponent(serverId)}/accounts/${encodeURIComponent(accountId)}/message`, { method: 'POST', body: JSON.stringify(input) }),
};
