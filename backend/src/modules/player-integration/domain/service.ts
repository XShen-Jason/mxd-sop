import { randomUUID } from 'node:crypto';
import { isSuperAdmin } from '../../auth/public/index.js';
import { PlayerIntegrationError } from './errors.js';
import type { PlayerAccountSync, PlayerDeploymentMode, PlayerEndpointConfig, PlayerImportResult, PlayerIntegrationActor, PlayerIntegrationClient, PlayerIntegrationRepository, PlayerIntegrationState, PlayerIntegrationStatus } from './types.js';
import type { UploadFile } from '../../player-directory/public/index.js';

export const SWITCH_CONFIRMATION = 'SWITCH PLAYER SERVER';

export class PlayerIntegrationService implements PlayerAccountSync {
  private readonly config: Required<Pick<PlayerEndpointConfig, 'initialMode' | 'timeoutMs'>> & PlayerEndpointConfig;

  constructor(private readonly repository: PlayerIntegrationRepository, config: PlayerEndpointConfig, private readonly client: PlayerIntegrationClient) {
    this.config = { initialMode: 'local', timeoutMs: 10_000, ...config, localUrl: normalizeEndpoint(config.localUrl, 'local'), remoteUrl: normalizeEndpoint(config.remoteUrl, 'remote') };
    if (this.config.initialMode !== 'local' && this.config.initialMode !== 'remote') this.config.initialMode = 'local';
  }

  activeMode(): PlayerDeploymentMode { return this.repository.get()?.mode ?? this.config.initialMode; }

  activeEndpoint() { return this.endpoint(this.activeMode()); }
  teamSnapshotEndpoint() { const endpoint = this.activeEndpoint(); return endpoint ? `${endpoint}/api/v1/internal/player/teams/snapshot` : undefined; }
  serviceToken() { return this.config.serviceToken ?? ''; }
  hasConfiguredEndpoint() { return this.endpointConfigured(this.activeMode()); }

  async status(actor: PlayerIntegrationActor): Promise<PlayerIntegrationStatus> {
    this.requireSuperAdmin(actor);
    const checkedAt = new Date().toISOString();
    const [local, remote] = await Promise.all([this.check('local'), this.check('remote')]);
    return { mode: this.activeMode(), activeEndpoint: this.activeEndpoint() ?? null, endpoints: { local, remote }, checkedAt };
  }

  async switchMode(actor: PlayerIntegrationActor, mode: unknown, confirmation: unknown) {
    this.requireSuperAdmin(actor);
    if (mode !== 'local' && mode !== 'remote') throw new PlayerIntegrationError('invalid-input', 'mode must be local or remote');
    if (confirmation !== SWITCH_CONFIRMATION) throw new PlayerIntegrationError('confirmation-required', `type ${SWITCH_CONFIRMATION} to confirm`);
    const endpoint = this.endpoint(mode);
    if (!endpoint || !this.serviceToken()) throw new PlayerIntegrationError('endpoint-not-configured', `${mode} player endpoint is not configured`);
    if (!await this.client.health(endpoint)) throw new PlayerIntegrationError('endpoint-unavailable', `${mode} player endpoint is unavailable`);
    const state: PlayerIntegrationState = { mode, updatedAt: new Date().toISOString(), updatedBy: { id: actor.id, displayName: actor.displayName } };
    this.repository.save(state);
    return { mode: state.mode, activeEndpoint: endpoint, updatedAt: state.updatedAt };
  }

  async sync(serverId: string, file: UploadFile, signal?: AbortSignal): Promise<PlayerImportResult> {
    const endpoint = this.activeEndpoint();
    const token = this.serviceToken();
    if (!endpoint || !token) throw new PlayerIntegrationError('endpoint-not-configured', 'player service integration is not configured');
    try {
      return await this.client.importAccounts(endpoint, token, serverId, { name: file.name, content: file.content }, signal);
    } catch (error) {
      if (error instanceof PlayerIntegrationError) throw error;
      throw new PlayerIntegrationError('player-import-failed', 'player account import failed');
    }
  }

  private async check(mode: PlayerDeploymentMode) {
    const endpoint = this.endpoint(mode);
    if (!endpoint || !this.serviceToken()) return { configured: false, available: null };
    return { configured: true, available: await this.client.health(endpoint) };
  }

  private endpoint(mode: PlayerDeploymentMode) { return mode === 'local' ? this.config.localUrl : this.config.remoteUrl; }
  private endpointConfigured(mode: PlayerDeploymentMode) { return Boolean(this.endpoint(mode) && this.serviceToken()); }
  private requireSuperAdmin(actor: PlayerIntegrationActor) { if (!isSuperAdmin(actor)) throw new PlayerIntegrationError('forbidden', 'super admin required'); }
}

export function loadPlayerEndpointConfig(env: NodeJS.ProcessEnv = process.env): PlayerEndpointConfig {
  return { localUrl: normalizeEndpoint(env.MXD_PLAYER_LOCAL_URL, 'local'), remoteUrl: normalizeEndpoint(env.MXD_PLAYER_REMOTE_URL, 'remote'), serviceToken: env.MXD_PLAYER_SERVICE_TOKEN?.trim(), initialMode: env.MXD_PLAYER_DEPLOYMENT_MODE === 'remote' ? 'remote' : 'local' };
}

function normalizeEndpoint(value: string | undefined, mode: PlayerDeploymentMode) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || (mode === 'remote' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    return url.toString().replace(/\/$/u, '');
  } catch { return undefined; }
}

export function newImportRequestId() { return randomUUID(); }
