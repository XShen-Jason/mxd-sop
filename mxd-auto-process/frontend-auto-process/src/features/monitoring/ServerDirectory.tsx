import { CircleAlert, CircleCheck, Radio, Server, UserRound } from 'lucide-react';
import type { AccountSnapshot, ServerRecord } from '../../api/types';

export function ServerDirectory({ servers, selectedId, selectedAccountId, onSelect }: { servers: ServerRecord[]; selectedId: string | null; selectedAccountId: string | null; onSelect: (serverId: string, accountId: string) => void }) {
  return <aside className="server-directory" aria-label="服务器与账号">
    <div className="panel-heading"><div><p className="eyebrow">SERVERS</p><h2>服务器与账号</h2></div><span className="count-badge">{servers.length}</span></div>
    <div className="server-list">
      {servers.map((server) => <div key={server.id} className={`server-card ${selectedId === server.id ? 'selected' : ''}`}>
        <span className="server-card-heading"><span className="server-icon"><Server size={17} aria-hidden="true" /></span><span className="server-identity"><strong>{server.name}</strong><code>{server.address}</code></span><ServerState server={server} /></span>
        <div className="account-list">{server.accounts.length ? server.accounts.map((account) => <AccountLine key={account.id} account={account} selected={selectedAccountId === account.id} onSelect={() => onSelect(server.id, account.id)} />) : <span className="empty-account">尚未配置账号</span>}</div>
      </div>)}
      {!servers.length && <div className="directory-empty"><Server size={24} /><span>尚未配置服务器</span></div>}
    </div>
  </aside>;
}

function AccountLine({ account, selected, onSelect }: { account: AccountSnapshot; selected: boolean; onSelect: () => void }) {
  return <button type="button" className={`account-line ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onSelect}><UserRound size={14} aria-hidden="true" /><span><strong>{account.character_name || account.username}</strong><small>{account.username} · {statusLabel(account.status)}</small></span><i className={`account-dot status-${account.status}`} aria-label={statusLabel(account.status)} /></button>;
}

function ServerState({ server }: { server: ServerRecord }) {
  const online = server.enabled && server.accounts.some((account) => account.status === 'online');
  const Icon = online ? CircleCheck : server.enabled ? Radio : CircleAlert;
  return <span className={`server-state ${online ? 'online' : server.enabled ? 'waiting' : 'disabled'}`}><Icon size={13} aria-hidden="true" />{online ? '在线' : server.enabled ? '待连接' : '已停用'}</span>;
}

function statusLabel(status: AccountSnapshot['status']) {
  const labels: Record<AccountSnapshot['status'], string> = { online: '在线', connecting: '连接中', reconnecting: '重连中', offline: '离线', failed: '失败', disabled: '已停用' };
  return labels[status];
}
