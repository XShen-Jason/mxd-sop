import type { AuditEntry } from '../../api/types';

export function logSummary(entry: AuditEntry) {
  if (entry.action && !/^\w+\s/u.test(entry.action)) return entry.action;
  const path = entry.path;
  if (entry.method === 'TCP') return gameOperationLabel(entry.detail?.operation);
  if (path.includes('/sessions') && path.endsWith('/select-and-enter')) return '选择角色并进入地图';
  if (path.endsWith('/sessions')) return '登录游戏账号';
  if (path.endsWith('/message') || path.endsWith('/chat')) return '发送游戏消息';
  if (path.endsWith('/reconnect')) return '重新连接游戏账号';
  if (path.endsWith('/start')) return '启动游戏账号';
  if (path.endsWith('/stop')) return '停止游戏账号';
  if (path.includes('/accounts')) return `${methodVerb(entry.method)}游戏账号`;
  if (path.includes('/servers')) return `${methodVerb(entry.method)}游戏服务器`;
  return '访问自动化服务';
}

export function logSource(entry: AuditEntry) {
  return entry.method === 'TCP' || entry.detail?.source === 'game-server' ? '游戏协议' : '控制接口';
}

export function logOutcome(entry: AuditEntry) {
  if (entry.detail?.outcome === 'unknown' || entry.detail?.outcome === 'unconfirmed') return { label: '待确认', tone: 'pending' };
  if (entry.status >= 200 && entry.status < 300) return { label: '成功', tone: 'success' };
  return { label: `失败 ${entry.status}`, tone: 'failure' };
}

export function requestPayload(entry: AuditEntry) {
  return entry.detail?.request ?? entry.detail?.request_body ?? emptyPayload('此请求没有消息体');
}

export function responsePayload(entry: AuditEntry) {
  if (entry.detail?.responses) return entry.detail.responses;
  return entry.detail?.response_body ?? emptyPayload(entry.status === 204 ? '服务端未返回消息体' : '没有捕获到返回信息');
}

export function prettyJSON(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function gameOperationLabel(operation: unknown) {
  const labels: Record<number, string> = { 0: '登录游戏服务器', 6: '选择游戏角色', 7: '进入游戏地图', 8: '初始化地图状态', 10: '发送游戏消息' };
  return typeof operation === 'number' ? labels[operation] ?? `发送游戏协议请求（操作 ${operation}）` : '发送游戏协议请求';
}

function methodVerb(method: string) {
  return method === 'POST' ? '添加或操作' : method === 'PATCH' ? '更新' : method === 'DELETE' ? '删除' : '读取';
}

function emptyPayload(message: string) {
  return { message };
}
