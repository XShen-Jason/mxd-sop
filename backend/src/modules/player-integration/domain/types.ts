import type { Identity } from '../../../shared/types.js';
import type { UploadFile } from '../../player-directory/public/index.js';

export type PlayerDeploymentMode = 'local' | 'remote';

export interface PlayerEndpointConfig {
  localUrl?: string;
  remoteUrl?: string;
  serviceToken?: string;
  initialMode?: PlayerDeploymentMode;
  timeoutMs?: number;
}

export interface PlayerIntegrationState {
  mode: PlayerDeploymentMode;
  updatedAt: string;
  updatedBy?: { id: string; displayName: string };
}

export interface PlayerIntegrationRepository {
  get(): PlayerIntegrationState | null;
  save(state: PlayerIntegrationState): void;
}

export interface PlayerImportResult {
  serverId: string;
  rowCount: number;
  skippedRows: number;
  importedAt: string;
}

export interface PlayerIntegrationClient {
  health(endpoint: string, signal?: AbortSignal): Promise<boolean>;
  importAccounts(endpoint: string, token: string, serverId: string, file: UploadFile, signal?: AbortSignal): Promise<PlayerImportResult>;
}

export interface PlayerIntegrationStatus {
  mode: PlayerDeploymentMode;
  activeEndpoint: string | null;
  endpoints: Record<PlayerDeploymentMode, { configured: boolean; available: boolean | null }>;
  checkedAt: string;
}

export interface PlayerAccountSync {
  sync(serverId: string, file: UploadFile, signal?: AbortSignal): Promise<PlayerImportResult>;
}

export type PlayerIntegrationActor = Pick<Identity, 'id' | 'role' | 'displayName'>;
