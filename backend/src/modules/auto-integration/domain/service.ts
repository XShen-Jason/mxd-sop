import { hasWorkspaceAccess } from '../../auth/public/index.js';
import { AutoIntegrationError } from './errors.js';
import type { AutoAccountInput, AutoEndpointConfig, AutoExecutionInput, AutoExecutionResult, AutoIntegrationActor, AutoIntegrationClient, AutoIntegrationRepository, AutoIntegrationState, AutoLoginInput, AutoMessageInput, AutoMessageResult, AutoServerInput, AutoServiceStatus, AutoSessionMessageResult } from './types.js';

export const AUTO_CONNECTION_CONFIRMATION = 'CHANGE AUTO CONNECTION';

export class AutoIntegrationService {
  private readonly endpoint?: string;
  private readonly token: string;

  constructor(config: AutoEndpointConfig, private readonly client: AutoIntegrationClient, private readonly repository: AutoIntegrationRepository) {
    this.endpoint = normalizeEndpoint(config.localUrl ?? 'http://127.0.0.1:26909');
    this.token = config.serviceToken?.trim() ?? '';
  }

  async status(actor: AutoIntegrationActor, signal?: AbortSignal): Promise<AutoServiceStatus> {
    this.requireActor(actor);
    const checkedAt = new Date().toISOString();
    const enabled = this.isEnabled();
    if (!this.endpoint || !this.token) return { enabled, endpoint: this.endpoint ?? null, configured: false, available: null, checkedAt };
    return { enabled, endpoint: this.endpoint, configured: true, available: enabled ? await this.client.health(signal) : null, checkedAt };
  }

  isEnabled() { return this.repository.get()?.enabled ?? true; }

  async setConnection(actor: AutoIntegrationActor, enabled: unknown, confirmation: unknown) {
    this.requireActor(actor);
    if (typeof enabled !== 'boolean') throw new AutoIntegrationError('invalid-input', 'enabled must be a boolean');
    if (confirmation !== AUTO_CONNECTION_CONFIRMATION) throw new AutoIntegrationError('confirmation-required', `type ${AUTO_CONNECTION_CONFIRMATION} to confirm`);
    if (enabled) {
      if (!this.endpoint || !this.token) throw new AutoIntegrationError('endpoint-not-configured', 'auto process endpoint is not configured');
      if (!await this.client.health()) throw new AutoIntegrationError('endpoint-unavailable', 'auto process endpoint is unavailable');
    }
    const state: AutoIntegrationState = { enabled, updatedAt: new Date().toISOString(), updatedBy: { id: actor.id, displayName: actor.displayName } };
    this.repository.save(state);
    return { enabled, endpoint: this.endpoint ?? null, updatedAt: state.updatedAt };
  }

  async overview(actor: AutoIntegrationActor, signal?: AbortSignal) { this.requireAccess(actor); return this.client.overview(actor, signal); }
  async startSession(actor: AutoIntegrationActor, serverId: string, input: AutoLoginInput) { this.requireAccess(actor); return this.client.startSession(actor, serverId, input); }
  async getSession(actor: AutoIntegrationActor, sessionId: string) { this.requireAccess(actor); if (!this.client.getSession) throw new AutoIntegrationError('auto-request-failed', 'session status is unavailable'); return this.client.getSession(actor, sessionId); }
  async selectAndEnterSession(actor: AutoIntegrationActor, sessionId: string, characterId: string) { this.requireAccess(actor); return this.client.selectAndEnterSession(actor, sessionId, characterId); }
  async stopSession(actor: AutoIntegrationActor, sessionId: string) { this.requireAccess(actor); return this.client.stopSession(actor, sessionId); }
  async sendSessionMessage(actor: AutoIntegrationActor, sessionId: string, input: AutoMessageInput): Promise<AutoSessionMessageResult> { this.requireAccess(actor); if (!this.client.sendSessionMessage) throw new AutoIntegrationError('auto-request-failed', 'session chat is unavailable'); return this.client.sendSessionMessage(actor, sessionId, input); }
  async createServer(actor: AutoIntegrationActor, input: AutoServerInput) { this.requireAccess(actor); return this.client.createServer(actor, input); }
  async updateServer(actor: AutoIntegrationActor, id: string, input: Partial<AutoServerInput>) { this.requireAccess(actor); return this.client.updateServer(actor, id, input); }
  async deleteServer(actor: AutoIntegrationActor, id: string) { this.requireAccess(actor); return this.client.deleteServer(actor, id); }
  async createAccount(actor: AutoIntegrationActor, serverId: string, input: AutoAccountInput) { this.requireAccess(actor); return this.client.createAccount(actor, serverId, input); }
  async updateAccount(actor: AutoIntegrationActor, serverId: string, id: string, input: Partial<AutoAccountInput>) { this.requireAccess(actor); return this.client.updateAccount(actor, serverId, id, input); }
  async deleteAccount(actor: AutoIntegrationActor, serverId: string, id: string) { this.requireAccess(actor); return this.client.deleteAccount(actor, serverId, id); }
  async startAccount(actor: AutoIntegrationActor, serverId: string, id: string) { this.requireAccess(actor); return this.client.startAccount(actor, serverId, id); }
  async stopAccount(actor: AutoIntegrationActor, serverId: string, id: string) { this.requireAccess(actor); return this.client.stopAccount(actor, serverId, id); }
  async reconnectAccount(actor: AutoIntegrationActor, serverId: string, id: string) { this.requireAccess(actor); return this.client.reconnectAccount(actor, serverId, id); }
  async sendMessage(actor: AutoIntegrationActor, serverId: string, id: string, input: AutoMessageInput): Promise<AutoMessageResult> {
    this.requireAccess(actor);
    const startedAt = Date.now();
    const response = await this.client.sendMessage(actor, serverId, id, input);
    return {
      ...response,
      auto_process: {
        latency_ms: Math.max(0, Date.now() - startedAt),
        status: 'success',
      },
    };
  }

  async execute(actor: AutoIntegrationActor, serverId: string, input: AutoExecutionInput): Promise<AutoExecutionResult> {
    this.requireActor(actor);
    this.requireEnabled();
    if (!this.endpoint || !this.token) throw new AutoIntegrationError('endpoint-not-configured', 'auto process endpoint is not configured');
    return this.client.execute(actor, serverId, input);
  }

  private requireAccess(actor: AutoIntegrationActor) {
    this.requireActor(actor);
    this.requireEnabled();
    if (!this.endpoint || !this.token) throw new AutoIntegrationError('endpoint-not-configured', 'auto process endpoint is not configured');
  }

  private requireEnabled() {
    if (!this.isEnabled()) throw new AutoIntegrationError('connection-disabled', 'auto process connection is disabled');
  }

  private requireActor(actor: AutoIntegrationActor) {
    if (!actor?.id || !hasWorkspaceAccess(actor, 'server-operations')) throw new AutoIntegrationError('forbidden');
  }
}

export function loadAutoEndpointConfig(env: NodeJS.ProcessEnv = process.env): AutoEndpointConfig {
  return { localUrl: env.MXD_AUTO_LOCAL_URL?.trim() || 'http://127.0.0.1:26909', serviceToken: env.MXD_AUTO_SERVICE_TOKEN?.trim() || 'local-auto-service-token', timeoutMs: Number(env.MXD_AUTO_TIMEOUT_MS) || 10_000 };
}

function normalizeEndpoint(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.toString().replace(/\/$/u, '');
  } catch { return undefined; }
}
