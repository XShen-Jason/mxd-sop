import { AutoIntegrationError } from '../domain/errors.js';
import type { AutoAccount, AutoAccountInput, AutoEndpointConfig, AutoExecutionInput, AutoExecutionResult, AutoIntegrationActor, AutoIntegrationClient, AutoLoginInput, AutoMessageInput, AutoMessageResult, AutoOverview, AutoServer, AutoServerInput, AutoSession } from '../domain/types.js';

export class HttpAutoIntegrationClient implements AutoIntegrationClient {
  private readonly endpoint?: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: AutoEndpointConfig) {
    this.endpoint = normalizeEndpoint(config.localUrl ?? 'http://127.0.0.1:26909');
    this.token = config.serviceToken?.trim() ?? '';
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async health(signal?: AbortSignal) {
    if (!this.endpoint || !this.token) return false;
    try { return (await this.request<{ status: string }>('/api/v1/healthz', { method: 'GET', signal })).status === 'ok'; } catch { return false; }
  }

  overview(actor: AutoIntegrationActor, signal?: AbortSignal) { return this.request<AutoOverview>('/api/v1/overview?include_logs=false', { method: 'GET', signal, actor }); }
  startSession(actor: AutoIntegrationActor, serverId: string, input: AutoLoginInput) { return this.request<AutoSession>(`/api/v1/servers/${encodeURIComponent(serverId)}/sessions`, { method: 'POST', body: JSON.stringify(input), actor }); }
  selectAndEnterSession(actor: AutoIntegrationActor, sessionId: string, characterId: string) { return this.request<AutoSession>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/select-and-enter`, { method: 'POST', body: JSON.stringify({ character_id: characterId }), actor }); }
  stopSession(actor: AutoIntegrationActor, sessionId: string) { return this.request<void>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', actor }); }
  createServer(actor: AutoIntegrationActor, input: AutoServerInput) { return this.request<AutoServer>('/api/v1/servers', { method: 'POST', body: JSON.stringify(input), actor }); }
  updateServer(actor: AutoIntegrationActor, id: string, input: Partial<AutoServerInput>) { return this.request<AutoServer>(`/api/v1/servers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input), actor }); }
  deleteServer(actor: AutoIntegrationActor, id: string) { return this.request<void>(`/api/v1/servers/${encodeURIComponent(id)}`, { method: 'DELETE', actor }); }
  createAccount(actor: AutoIntegrationActor, serverId: string, input: AutoAccountInput) { return this.request<AutoAccount>(`/api/v1/servers/${encodeURIComponent(serverId)}/accounts`, { method: 'POST', body: JSON.stringify(input), actor }); }
  updateAccount(actor: AutoIntegrationActor, serverId: string, id: string, input: Partial<AutoAccountInput>) { return this.request<AutoAccount>(this.accountPath(serverId, id), { method: 'PATCH', body: JSON.stringify(input), actor }); }
  deleteAccount(actor: AutoIntegrationActor, serverId: string, id: string) { return this.request<void>(this.accountPath(serverId, id), { method: 'DELETE', actor }); }
  startAccount(actor: AutoIntegrationActor, serverId: string, id: string) { return this.request<AutoAccount>(`${this.accountPath(serverId, id)}/start`, { method: 'POST', body: '{}', actor }); }
  stopAccount(actor: AutoIntegrationActor, serverId: string, id: string) { return this.request<AutoAccount>(`${this.accountPath(serverId, id)}/stop`, { method: 'POST', body: '{}', actor }); }
  reconnectAccount(actor: AutoIntegrationActor, serverId: string, id: string) { return this.request<AutoAccount>(`${this.accountPath(serverId, id)}/reconnect`, { method: 'POST', body: '{}', actor }); }
  sendMessage(actor: AutoIntegrationActor, serverId: string, id: string, input: AutoMessageInput) { return this.request<AutoMessageResult>(`${this.accountPath(serverId, id)}/message`, { method: 'POST', body: JSON.stringify(input), actor }); }
  execute(actor: AutoIntegrationActor, serverId: string, input: AutoExecutionInput) { return this.request<AutoExecutionResult>(`/api/v1/servers/${encodeURIComponent(serverId)}/executions`, { method: 'POST', body: JSON.stringify(input), actor }); }

  private accountPath(serverId: string, accountId: string) { return `/api/v1/servers/${encodeURIComponent(serverId)}/accounts/${encodeURIComponent(accountId)}`; }

  private async request<T>(path: string, init: RequestInit & { actor?: AutoIntegrationActor } = {}): Promise<T> {
    if (!this.endpoint || !this.token) throw new AutoIntegrationError('endpoint-not-configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const cancel = () => controller.abort();
    init.signal?.addEventListener('abort', cancel, { once: true });
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    headers.set('authorization', `Bearer ${this.token}`);
    if (init.actor) { headers.set('x-ops-actor-id', init.actor.id); headers.set('x-ops-actor-name', init.actor.displayName); }
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    try {
      const response = await fetch(new URL(path, `${this.endpoint}/`), { ...init, headers, signal: controller.signal });
      if (!response.ok) throw await this.error(response);
      return response.status === 204 ? undefined as T : await response.json() as T;
    } catch (error) {
      if (error instanceof AutoIntegrationError) throw error;
      throw new AutoIntegrationError('endpoint-unavailable', 'auto process request failed');
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', cancel);
    }
  }

  private async error(response: Response) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } | string };
    const value = payload.error;
    const code = typeof value === 'string' ? value : value?.code ?? 'auto-request-failed';
    const message = typeof value === 'string' ? value : value?.message ?? code;
    return new AutoIntegrationError(code, message);
  }
}

function normalizeEndpoint(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.toString().replace(/\/$/u, '');
  } catch { return undefined; }
}
