import { Pencil, Power, RefreshCw, ServerCog, Trash2, UserPlus, UserRound } from 'lucide-react';
import type { AutoMessageResult } from '../../types';
import { ServerMessagePanel } from './ServerMessagePanel';
import { accountCharacterLabel, accountIsActive, accountStatusLabel, serverHealth, serverHealthLabel, type ConfiguredServer, type ServerAccount, type ServerMessageType } from './types';

interface ServerDetailsPanelProps {
  server: ConfiguredServer;
  onAddAccount: () => void;
  onToggleAccount: (serverId: string, accountId: string, enabled: boolean) => void;
  onEditAccount: (account: ServerAccount) => void;
  onDeleteAccount: (account: ServerAccount) => void;
  onReconnectAccount: (account: ServerAccount) => void;
  onSendMessage: (server: ConfiguredServer, account: ServerAccount, type: ServerMessageType, message: string) => Promise<AutoMessageResult | undefined>;
  statusFresh: boolean;
}

export function ServerDetailsPanel({ server, onAddAccount, onToggleAccount, onEditAccount, onDeleteAccount, onReconnectAccount, onSendMessage, statusFresh }: ServerDetailsPanelProps) {
  const health = statusFresh ? serverHealth(server) : 'pending';
  return <section className="server-detail-panel panel-surface" aria-labelledby="selected-server-title">
    <header className="server-detail-header">
      <div className="server-detail-title"><span className="server-detail-icon"><ServerCog size={20} /></span><h2 id="selected-server-title">{server.name}</h2></div><code className="server-detail-address">{server.address}</code>
      <div className="server-detail-actions"><span className={`server-detail-status health-${health}`}><span className={`server-status-dot health-${health}`} />{serverHealthLabel(health)}</span></div>
    </header>
    <section className="server-accounts-section" aria-labelledby="server-accounts-title">
      <div className="server-section-heading"><div><h3 id="server-accounts-title">已配置账号</h3></div><button type="button" className="primary-button server-add-account" onClick={onAddAccount}><UserPlus size={16} />添加账号</button></div>
      <div className="server-account-list" role="list">{server.accounts.length ? server.accounts.map((account) => <AccountRow key={account.id} account={account} serverId={server.id} live={statusFresh} onToggle={onToggleAccount} onEdit={onEditAccount} onDelete={onDeleteAccount} onReconnect={onReconnectAccount} />) : <div className="server-account-empty server-detail-account-empty"><UserRound size={19} /><div><strong>暂未配置账号</strong><span>使用上方“添加账号”开始登录并选择角色。</span></div></div>}</div>
    </section>
    <ServerMessagePanel key={server.id} server={server} statusFresh={statusFresh} onSend={onSendMessage} />
  </section>;
}

function AccountRow({ account, serverId, live, onToggle, onEdit, onDelete, onReconnect }: { account: ServerAccount; serverId: string; live: boolean; onToggle: ServerDetailsPanelProps['onToggleAccount']; onEdit: (account: ServerAccount) => void; onDelete: (account: ServerAccount) => void; onReconnect: (account: ServerAccount) => void }) {
  const active = accountIsActive(account);
  const status = live ? account.status : 'unknown';
  const reconnectable = live && active && (status === 'offline' || status === 'failed');
  return <div className="server-account-row" role="listitem">
    <div className="server-account-identity"><span className="server-account-avatar"><UserRound size={15} /></span><div className="server-account-copy"><strong>{account.username}</strong><small>角色 · {accountCharacterLabel(account)}</small></div></div>
    <span className={`server-account-state state-${status}`}><span className="server-account-state-dot" />{accountStatusLabel(status)}</span>
    <div className="server-account-row-actions"><button type="button" className="icon-button" title="编辑账号" aria-label={`编辑 ${account.username}`} onClick={() => onEdit(account)}><Pencil size={15} /></button><button type="button" className="icon-button danger-button" title="删除账号" aria-label={`删除 ${account.username}`} onClick={() => onDelete(account)}><Trash2 size={15} /></button>{reconnectable && <button type="button" className="icon-button" title="手动重连" aria-label={`重连 ${account.username}`} onClick={() => onReconnect(account)}><RefreshCw size={15} /></button>}<label className="account-toggle"><input type="checkbox" checked={active} onChange={(event) => onToggle(serverId, account.id, event.target.checked)} /><span className="account-toggle-track"><Power size={13} /><b>{active ? '关闭' : '启动'}</b></span></label></div>
  </div>;
}
