import type { ServerRecord, AccountSnapshot } from '../../api/types';

export type StatusTone = 'ready' | 'waiting' | 'error' | 'inactive';
export interface LiveStatus { tone: StatusTone; label: string }

export function accountLiveStatus(account: AccountSnapshot, serverEnabled: boolean, fresh: boolean): LiveStatus {
  if (!fresh) return { tone: 'waiting', label: '状态待确认' };
  if (!serverEnabled) return { tone: 'inactive', label: '服务器已停用' };
  if (!account.enabled || account.status === 'disabled') return { tone: 'inactive', label: '未登录' };
  switch (account.status) {
    case 'online':
      return account.automation_enabled
        ? { tone: 'ready', label: '在线 · 自动化' }
        : { tone: 'inactive', label: '在线 · 自动化关闭' };
    case 'connecting': return { tone: 'waiting', label: '连接中' };
    case 'reconnecting': return { tone: 'waiting', label: '重连中' };
    case 'failed': return { tone: 'error', label: '连接失败' };
    case 'offline': return { tone: 'error', label: '离线' };
    default: return { tone: 'waiting', label: '状态待确认' };
  }
}

export function serverLiveStatus(server: ServerRecord, fresh: boolean): LiveStatus {
  if (!fresh) return { tone: 'waiting', label: '状态待确认' };
  if (!server.enabled) return { tone: 'inactive', label: '服务器已停用' };
  if (!server.address.trim() || !server.accounts.length) return { tone: 'inactive', label: '待配置' };
  const statuses = server.accounts.map((account) => accountLiveStatus(account, server.enabled, fresh));
  // Surface transitional/error accounts even while another account can automate.
  for (const tone of ['waiting', 'error', 'ready'] as const) {
    const status = statuses.find((item) => item.tone === tone);
    if (status) return tone === 'ready' ? { tone, label: '自动化可用' } : status;
  }
  return statuses.find((item) => item.label === '在线 · 自动化关闭') ?? statuses[0];
}
