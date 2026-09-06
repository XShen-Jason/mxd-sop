import { PlayerIntegrationError } from '../domain/errors.js';
import type { PlayerIntegrationClient, PlayerImportResult } from '../domain/types.js';
import type { UploadFile } from '../../player-directory/public/index.js';

export class HttpPlayerIntegrationClient implements PlayerIntegrationClient {
  constructor(private readonly defaultTimeoutMs = 10_000) {}

  async health(endpoint: string, signal?: AbortSignal) {
    try {
      const response = await this.request(endpoint, '/health', { method: 'GET', signal });
      return response.ok;
    } catch { return false; }
  }

  async importAccounts(endpoint: string, token: string, serverId: string, file: UploadFile, signal?: AbortSignal): Promise<PlayerImportResult> {
    const response = await this.request(endpoint, '/api/v1/internal/player/accounts/import', { method: 'POST', signal, headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ serverId, file }) });
    if (!response.ok) throw new PlayerIntegrationError(response.status >= 500 ? 'endpoint-unavailable' : 'player-import-failed', await errorMessage(response));
    const data = await response.json() as Partial<PlayerImportResult>;
    if (data.serverId !== serverId || !Number.isInteger(data.rowCount) || !Number.isInteger(data.skippedRows) || typeof data.importedAt !== 'string') throw new PlayerIntegrationError('player-import-failed', 'player returned an invalid import result');
    return data as PlayerImportResult;
  }

  private async request(endpoint: string, path: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    const cancel = () => controller.abort();
    init.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const url = new URL(path, `${endpoint.replace(/\/$/u, '')}/`);
      return await fetch(url, { ...init, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) }, signal: controller.signal });
    } catch { throw new PlayerIntegrationError('endpoint-unavailable', 'player endpoint request failed'); }
    finally { clearTimeout(timer); init.signal?.removeEventListener('abort', cancel); }
  }
}

async function errorMessage(response: Response) {
  try { const data = await response.json() as { error?: { message?: string }; message?: string }; return data.error?.message ?? data.message ?? `player returned ${response.status}`; }
  catch { return `player returned ${response.status}`; }
}
