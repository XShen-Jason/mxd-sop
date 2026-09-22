export interface OperatorSession {
  user: { username: string };
  must_change: boolean;
  expires_at: string;
}

export type AccountStatus = 'disabled' | 'offline' | 'connecting' | 'online' | 'reconnecting' | 'failed';
export type CredentialType = 'password' | 'md5';

export interface AccountSnapshot {
  id: string;
  server_id: string;
  username: string;
  character_id: string;
  character_name?: string;
  credential_type: CredentialType;
  enabled: boolean;
  status: AccountStatus;
  last_error?: string;
  updated_at: string;
}

export interface AutoRole { id: string; name?: string; map_id?: string; opaque_available: boolean }

export interface AutoSession {
  id: string;
  server_id: string;
  state: string;
  roles: AutoRole[];
  character_id?: string;
  map_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ServerRecord {
  id: string;
  name: string;
  address: string;
  version: string;
  map_id: string;
  enabled: boolean;
  keyless_probe_enabled?: boolean;
  accounts: AccountSnapshot[];
}

export interface AutoMessageResult {
  result: {
    status: string;
    message: string;
    delivery_status: string;
    server_response?: string;
    game_server_response_latency_ms?: number;
    game_server_status?: 'success' | 'failure' | 'unknown';
  };
  account: AccountSnapshot;
  auto_process?: { latency_ms: number; status: 'success' | 'failure' | 'unknown' };
}

export interface Overview {
  fetched_at: string;
  servers: ServerRecord[];
  sessions: unknown[];
  logs: unknown[];
}

export interface AuditDetail {
  source?: 'game-server';
  server_id?: string;
  account?: string;
  operation?: number;
  outcome?: string;
  error_code?: string;
  query?: string;
  request?: unknown;
  responses?: unknown[];
  request_body?: unknown;
  response_body?: unknown;
  request_body_truncated?: boolean;
  response_body_truncated?: boolean;
  [key: string]: unknown;
}

export interface AuditEntry {
  id: string;
  created_at: string;
  request_id?: string;
  method: string;
  path: string;
  actor?: string;
  action?: string;
  status: number;
  duration_ms: number;
  detail?: AuditDetail;
}
