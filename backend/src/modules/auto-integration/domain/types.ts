import type { Identity } from '../../../shared/types.js';

export interface AutoEndpointConfig {
  localUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
}

export type AutoAccountStatus = 'disabled' | 'offline' | 'connecting' | 'online' | 'reconnecting' | 'failed';
export type AutoCredentialType = 'password' | 'md5';

export interface AutoRole {
  id: string;
  name?: string;
  map_id?: string;
  opaque_available: boolean;
}

export interface AutoSession {
  id: string;
  server_id: string;
  state: string;
  character_id?: string;
  map_id?: string;
  roles: AutoRole[];
  sent_messages: number;
  chat_success_count: number;
  chat_failure_count: number;
  chat_unknown_count: number;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface AutoAccount {
  id: string;
  server_id: string;
  username: string;
  character_id: string;
  character_name?: string;
  credential_type: AutoCredentialType;
  enabled: boolean;
  automation_enabled: boolean;
  status: AutoAccountStatus;
  session_id?: string;
  session?: AutoSession;
  last_error?: string;
  updated_at: string;
}

export interface AutoServer {
  id: string;
  name: string;
  address: string;
  version: string;
  map_id: string;
  enabled: boolean;
  keyless_probe_enabled?: boolean;
  spawn_rate: number;
  exp_rate: number;
  /** Legacy wire name: EXP duration in minutes, not an experience cap. */
  exp_max: number;
  drop_rate: number;
  meso_rate: number;
  domain_times: number;
  accounts: AutoAccount[];
}

export interface AutoAuditEntry {
  id: string;
  created_at: string;
  request_id?: string;
  method: string;
  path: string;
  actor?: string;
  action?: string;
  status: number;
  duration_ms: number;
  detail?: Record<string, unknown>;
}

export interface AutoOverview {
  fetched_at: string;
  servers: AutoServer[];
  sessions: AutoSession[];
  logs: AutoAuditEntry[];
}

export interface AutoServiceStatus {
  enabled: boolean;
  endpoint: string | null;
  configured: boolean;
  available: boolean | null;
  checkedAt: string;
}

export interface AutoIntegrationState {
  enabled: boolean;
  updatedAt: string;
  updatedBy?: { id: string; displayName: string };
}

export interface AutoIntegrationRepository {
  get(): AutoIntegrationState | null;
  save(state: AutoIntegrationState): void;
}

export interface AutoLoginInput {
  account: string;
  password: string;
  credential_type?: AutoCredentialType;
}

export interface AutoServerInput {
  id?: string;
  name: string;
  address: string;
  version?: string;
  map_id: string;
  enabled?: boolean;
  spawn_rate?: number;
  exp_rate?: number;
  exp_max?: number;
  drop_rate?: number;
  meso_rate?: number;
  domain_times?: number;
}

export interface AutoAccountInput {
  username: string;
  password?: string;
  credential_type?: AutoCredentialType;
  character_id: string;
  character_name?: string;
  enabled?: boolean;
  automation_enabled?: boolean;
  session_id?: string;
}

export interface AutoMessageInput {
  message: string;
  mode: 'scene' | 'guild' | 'team' | 'world' | 'privateChat';
}

export type AutoResponseStatus = 'success' | 'failure' | 'unknown';

export interface AutoProcessResponse {
  latency_ms: number;
  status: AutoResponseStatus;
}

export interface AutoMessageResult {
  result: {
    status: string;
    message: string;
    delivery_status: string;
    server_response?: string;
    server_response_type?: string;
    server_response_observed?: boolean;
    server_response_code?: number;
    server_event?: number;
    server_key_included?: boolean;
    connection_mode?: string;
    game_server_response_latency_ms?: number;
    game_server_status?: AutoResponseStatus;
  };
  account: AutoAccount;
  auto_process?: AutoProcessResponse;
}

export interface AutoSessionMessageResult {
  status: string;
  message: string;
  delivery_status: string;
  server_response?: string;
  server_response_type?: string;
  server_response_observed?: boolean;
  server_response_code?: number;
  server_event?: number;
  game_server_status?: AutoResponseStatus;
  session: AutoSession;
}

export interface AutoExecutionCommand { id: string; text: string; }
export interface AutoExecutionInput { execution_id: string; commands: AutoExecutionCommand[]; retry?: boolean; }
export interface AutoExecutionCommandResult extends AutoExecutionCommand { status: string; account_id?: string; delivery_status?: string; message?: string; }
export interface AutoExecutionResult { execution_id: string; status: 'running' | 'success' | 'failure'; attempts: number; selected_account_id?: string; failure_reason?: 'no_online_accounts' | 'execution_failed'; commands: AutoExecutionCommandResult[]; }

export type AutoIntegrationActor = Pick<Identity, 'id' | 'role' | 'displayName' | 'workspacePermissions'>;

export interface AutoIntegrationClient {
  health(signal?: AbortSignal): Promise<boolean>;
  overview(actor: AutoIntegrationActor, signal?: AbortSignal): Promise<AutoOverview>;
  startSession(actor: AutoIntegrationActor, serverId: string, input: AutoLoginInput): Promise<AutoSession>;
  getSession?(actor: AutoIntegrationActor, sessionId: string): Promise<AutoSession>;
  selectAndEnterSession(actor: AutoIntegrationActor, sessionId: string, characterId: string): Promise<AutoSession>;
  stopSession(actor: AutoIntegrationActor, sessionId: string): Promise<void>;
  sendSessionMessage?(actor: AutoIntegrationActor, sessionId: string, input: AutoMessageInput): Promise<AutoSessionMessageResult>;
  createServer(actor: AutoIntegrationActor, input: AutoServerInput): Promise<AutoServer>;
  updateServer(actor: AutoIntegrationActor, serverId: string, input: Partial<AutoServerInput>): Promise<AutoServer>;
  deleteServer(actor: AutoIntegrationActor, serverId: string): Promise<void>;
  createAccount(actor: AutoIntegrationActor, serverId: string, input: AutoAccountInput): Promise<AutoAccount>;
  updateAccount(actor: AutoIntegrationActor, serverId: string, accountId: string, input: Partial<AutoAccountInput>): Promise<AutoAccount>;
  deleteAccount(actor: AutoIntegrationActor, serverId: string, accountId: string): Promise<void>;
  startAccount(actor: AutoIntegrationActor, serverId: string, accountId: string): Promise<AutoAccount>;
  stopAccount(actor: AutoIntegrationActor, serverId: string, accountId: string): Promise<AutoAccount>;
  reconnectAccount(actor: AutoIntegrationActor, serverId: string, accountId: string): Promise<AutoAccount>;
  sendMessage(actor: AutoIntegrationActor, serverId: string, accountId: string, input: AutoMessageInput): Promise<AutoMessageResult>;
  execute(actor: AutoIntegrationActor, serverId: string, input: AutoExecutionInput): Promise<AutoExecutionResult>;
}
