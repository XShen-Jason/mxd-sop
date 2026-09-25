import type { AutoAccount, AutoAccountStatus, AutoCredentialType, AutoServer } from '../../types';

export type AccountState = AutoAccountStatus | 'unknown';
export type ServiceDeploymentMode = 'local' | 'remote';
export type ServerMessageType = 'privateChat' | 'scene' | 'world' | 'guild' | 'team';
export type ManagedServiceId = 'mxd-player' | 'game-server';
export type ManagedServiceCategory = 'player' | 'game';
export type ServerHealth = 'healthy' | 'unavailable' | 'not-configured' | 'pending';

export interface ManagedServiceDefinition {
  id: ManagedServiceId;
  name: string;
  product: string;
  description: string;
  category: ManagedServiceCategory;
  kind: 'connected' | 'prototype';
}

export interface ServiceDraft {
  mode: ServiceDeploymentMode;
  localEndpoint: string;
  remoteEndpoint: string;
}

export const managedServiceDefinitions: ManagedServiceDefinition[] = [
  {
    id: 'mxd-player',
    name: '玩家服务',
    product: 'mxd-player',
    description: '负责玩家账号、角色和队伍数据。当前工作台的账号目录与队伍快照都通过这里访问。',
    category: 'player',
    kind: 'connected',
  },
  {
    id: 'game-server',
    name: '游戏服务器',
    product: 'game-server',
    description: '配置游戏服务器 TCP 地址、账号和服务运行位置。',
    category: 'game',
    kind: 'connected',
  },
];

export type ServerAccount = Omit<AutoAccount, 'status'> & { status: AccountState };
export type ConfiguredServer = Omit<AutoServer, 'accounts'> & { accounts: ServerAccount[] };

export function accountCharacterLabel(account: Pick<AutoAccount, 'character_id' | 'character_name'>) {
  return `${account.character_name || '未命名'} · ${account.character_id || '—'}`;
}

export interface ServerFormValue {
  catalogId: string;
  host: string;
  port: string;
  version: string;
}

export const DEFAULT_GAME_PROTOCOL_VERSION = '1.0.2';

export function defaultGameProtocolVersion(serverId: string) {
  return serverId === 'piaopiao-pig' || serverId === 'ppz' ? '1.0.3' : DEFAULT_GAME_PROTOCOL_VERSION;
}

export interface AccountSetupValue {
  username: string;
  password: string;
  credentialType: AutoCredentialType;
  characterId: string;
  characterName: string;
  enabled: boolean;
  sessionId?: string;
}

export const serverMessageTypes: Array<{ id: ServerMessageType; label: string }> = [
  { id: 'privateChat', label: '私聊' },
  { id: 'team', label: '队伍' },
  { id: 'guild', label: '公会' },
  { id: 'world', label: '世界' },
  { id: 'scene', label: '所有人' },
];

export function automationEndpoint(draft: ServiceDraft) {
  return draft.mode === 'local' ? draft.localEndpoint : draft.remoteEndpoint;
}

export function accountStatusLabel(status: AccountState) {
  return status === 'unknown' ? '状态待确认' : status === 'online' ? '在线' : status === 'connecting' ? '连接中' : status === 'reconnecting' ? '自动重连中' : status === 'failed' ? '连接失败' : status === 'disabled' ? '未登录' : '离线';
}

export function accountIsActive(account: ServerAccount) {
  return account.enabled;
}

export function modeLabel(mode: ServiceDeploymentMode) {
  return mode === 'local' ? '本地' : '远程';
}

export function normalizeServiceEndpoint(value: string, mode: ServiceDeploymentMode) {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || (mode === 'remote' && url.protocol !== 'https:') || url.username || url.password) return undefined;
    return url.toString().replace(/\/$/u, '');
  } catch {
    return undefined;
  }
}

export function normalizeGameHost(value: string) {
  const host = value.trim();
  if (!host || /[\s/\\]/u.test(host) || host.includes(':') && !/^[0-9a-f:]+$/iu.test(host)) return undefined;
  return host;
}

export function normalizeGamePort(value: string | number) {
  const port = Number(String(value).trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}
