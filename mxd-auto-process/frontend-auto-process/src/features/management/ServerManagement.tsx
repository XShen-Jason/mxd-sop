import { Activity, CircleAlert, CircleCheck, LoaderCircle, Pencil, Power, RefreshCw, ServerCog, Trash2, UserPlus, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api/client';
import type { AccountSnapshot, AutoMessageResult, AutoSession, ServerRecord } from '../../api/types';
import { AccountFormDialog, type AccountFormValue } from './AccountFormDialog';
import { MessagePanel } from './MessagePanel';
import { ServerFormDialog, type ServerFormValue } from './ServerFormDialog';

type Dialog = { kind: 'server'; server?: ServerRecord } | { kind: 'account'; server: ServerRecord; account?: AccountSnapshot };

export function ServerManagement({ onBack }: { onBack: () => void }) {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = servers.find((server) => server.id === selectedId) ?? servers[0];

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const value = await api.overview();
      setServers(value.servers);
      setSelectedId((current) => current && value.servers.some((server) => server.id === current) ? current : value.servers[0]?.id);
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { if (showLoading) setLoading(false); }
  }, []);

  useEffect(() => { void load(true); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 2_000); return () => window.clearInterval(timer); }, [load]);

  const run = async <T,>(key: string, action: () => Promise<T>, message: string) => {
    setBusy(key); setError('');
    try { const result = await action(); setNotice(message); await load(); return result; }
    catch (reason) { setError(errorMessage(reason)); return undefined; }
    finally { setBusy(''); }
  };

  const saveServer = async (value: ServerFormValue) => {
    const action = dialog?.kind === 'server' && dialog.server
      ? () => api.updateServer(dialog.server!.id, value)
      : () => api.createServer(value);
    const saved = await run('server', action, dialog?.kind === 'server' ? '服务器配置已更新' : '服务器已添加');
    if (saved) setDialog(undefined);
    return Boolean(saved);
  };

  const saveAccount = async (value: AccountFormValue) => {
    if (dialog?.kind !== 'account') return false;
    const { server, account } = dialog;
    const input = { username: value.username, ...(value.password ? { password: value.password, credential_type: value.credential_type } : {}), character_id: value.character_id, character_name: value.character_name, enabled: value.enabled };
    const action = account
      ? () => api.updateAccount(server.id, account.id, input)
      : () => api.createAccount(server.id, { ...input, password: value.password, credential_type: value.credential_type, session_id: value.session_id });
    const saved = await run('account', action, account ? '账号配置已更新' : '账号已添加');
    if (saved) setDialog(undefined);
    return Boolean(saved);
  };

  const removeServer = async (server: ServerRecord) => { if (window.confirm(`确定删除“${server.name}”及其账号吗？`)) await run(`delete-server-${server.id}`, () => api.deleteServer(server.id), '服务器及其账号已删除'); };
  const removeAccount = async (server: ServerRecord, account: AccountSnapshot) => { if (window.confirm(`确定删除账号“${account.username}”吗？`)) await run(`delete-account-${account.id}`, () => api.deleteAccount(server.id, account.id), '账号已删除'); };
  const toggleAccount = (server: ServerRecord, account: AccountSnapshot) => void run(`account-${account.id}`, () => account.enabled ? api.stopAccount(server.id, account.id) : api.startAccount(server.id, account.id), account.enabled ? '账号已停止' : '账号启动请求已发送');
  const reconnect = (server: ServerRecord, account: AccountSnapshot) => void run(`account-${account.id}`, () => api.reconnectAccount(server.id, account.id), '重连请求已发送');
  const sendMessage = (server: ServerRecord, account: AccountSnapshot, mode: string, message: string) => run(`message-${account.id}`, () => api.sendMessage(server.id, account.id, { mode, message }), '消息已发送');
  const login = (serverId: string, username: string, password: string, credentialType: 'password' | 'md5') => api.startSession(serverId, username, password, credentialType);
  const enter = (sessionId: string, characterId: string) => api.selectAndEnter(sessionId, characterId);
  const cancelAccount = (sessionId?: string) => { setDialog(undefined); if (sessionId) void api.stopSession(sessionId).catch(() => undefined); };

  return <section className="management-page" aria-labelledby="management-title">
    <header className="management-heading"><div><p className="eyebrow">AUTO CONTROL</p><h1 id="management-title">服务器管理</h1><p>此页面只管理 mxd-auto-process 自己的服务器、账号和运行会话。</p></div><div className="management-heading-actions"><button type="button" className="secondary-button" onClick={onBack}>返回监控</button><button type="button" className="primary-button" onClick={() => setDialog({ kind: 'server' })}><ServerCog size={17} />添加服务器</button></div></header>
    {error && <div className="management-alert error" role="alert"><CircleAlert size={16} />{error}<button type="button" onClick={() => setError('')}>关闭</button></div>}
    {notice && <div className="management-alert success" role="status"><CircleCheck size={16} />{notice}<button type="button" onClick={() => setNotice('')}>关闭</button></div>}
    <div className="management-layout"><aside className="management-server-list panel-surface"><div className="management-list-heading"><div><strong>服务器与账号</strong><span>{servers.length} 台 · auto 独立数据</span></div><button type="button" className="icon-button" onClick={() => void load(true)} aria-label="刷新服务器列表" disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div>{loading ? <div className="management-empty"><LoaderCircle size={24} className="spin" />正在读取 auto 配置…</div> : servers.length ? servers.map((server) => <ManagementServerRow key={server.id} server={server} selected={selected?.id === server.id} onSelect={() => setSelectedId(server.id)} onEdit={() => setDialog({ kind: 'server', server })} onDelete={() => void removeServer(server)} />) : <div className="management-empty"><ServerCog size={25} /><strong>尚未配置服务器</strong><span>点击右上角添加一台 auto 专属服务器。</span></div>}</aside>{selected ? <ManagementDetails server={selected} busy={busy} onAddAccount={() => setDialog({ kind: 'account', server: selected })} onEditAccount={(account) => setDialog({ kind: 'account', server: selected, account })} onDeleteAccount={(account) => void removeAccount(selected, account)} onToggleAccount={(account) => toggleAccount(selected, account)} onReconnect={(account) => reconnect(selected, account)} onSendMessage={sendMessage} /> : <div className="management-detail-empty panel-surface"><ServerCog size={30} /><strong>选择或添加服务器</strong><span>服务器和账号数据完全保存在 auto 项目中。</span></div>}</div>
    {dialog?.kind === 'server' && <ServerFormDialog server={dialog.server} onClose={() => setDialog(undefined)} onSave={saveServer} />}
    {dialog?.kind === 'account' && <AccountFormDialog server={dialog.server} account={dialog.account} onClose={cancelAccount} onLogin={login} onEnter={enter} onSave={saveAccount} />}
  </section>;
}

function ManagementServerRow({ server, selected, onSelect, onEdit, onDelete }: { server: ServerRecord; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const online = server.enabled && server.accounts.some((account) => account.status === 'online');
  return <article className={`management-server-row${selected ? ' selected' : ''}`}><button type="button" className="management-server-select" onClick={onSelect} aria-pressed={selected}><span className={`management-status-dot ${online ? 'online' : server.enabled ? 'waiting' : 'disabled'}`} /><span><strong>{server.name}</strong><code>{server.address}</code><small>{server.accounts.length} 个账号 · {online ? '在线' : server.enabled ? '待连接' : '已停用'}</small></span></button><div className="management-row-actions"><button type="button" className="icon-button" aria-label={`编辑 ${server.name}`} onClick={onEdit}><Pencil size={15} /></button><button type="button" className="icon-button danger-button" aria-label={`删除 ${server.name}`} onClick={onDelete}><Trash2 size={15} /></button></div></article>;
}

function ManagementDetails({ server, busy, onAddAccount, onEditAccount, onDeleteAccount, onToggleAccount, onReconnect, onSendMessage }: { server: ServerRecord; busy: string; onAddAccount: () => void; onEditAccount: (account: AccountSnapshot) => void; onDeleteAccount: (account: AccountSnapshot) => void; onToggleAccount: (account: AccountSnapshot) => void; onReconnect: (account: AccountSnapshot) => void; onSendMessage: (server: ServerRecord, account: AccountSnapshot, mode: string, message: string) => Promise<AutoMessageResult | undefined> }) {
  return <section className="management-details panel-surface"><header className="management-details-heading"><div><p className="eyebrow">SERVER CONFIGURATION</p><h2>{server.name}</h2><code>{server.address} · 协议 {server.version} · 地图 {server.map_id}</code></div><span className={`management-enabled ${server.enabled ? 'on' : 'off'}`}>{server.enabled ? '已启用' : '已停用'}</span></header><section className="management-accounts"><div className="management-section-heading"><div><h3>已配置账号</h3><span>账号凭据只保存于 auto 本地数据库。</span></div><button type="button" className="primary-button" onClick={onAddAccount}><UserPlus size={16} />添加账号</button></div>{server.accounts.length ? <div className="management-account-list">{server.accounts.map((account) => <ManagementAccountRow key={account.id} account={account} busy={busy === `account-${account.id}`} onEdit={() => onEditAccount(account)} onDelete={() => onDeleteAccount(account)} onToggle={() => onToggleAccount(account)} onReconnect={() => onReconnect(account)} />)}</div> : <div className="management-account-empty"><UserRound size={21} /><span>尚未配置账号</span></div>}</section><MessagePanel server={server} busy={busy} onSend={onSendMessage} /></section>;
}

function ManagementAccountRow({ account, busy, onEdit, onDelete, onToggle, onReconnect }: { account: AccountSnapshot; busy: boolean; onEdit: () => void; onDelete: () => void; onToggle: () => void; onReconnect: () => void }) {
  const reconnectable = account.enabled && ['offline', 'failed'].includes(account.status);
  return <div className="management-account-row"><span className="management-account-icon"><UserRound size={16} /></span><div className="management-account-copy"><strong>{account.username}</strong><span>{account.character_name || '未命名角色'} · {account.character_id}</span></div><span className={`management-account-status status-${account.status}`}><i />{statusLabel(account.status)}</span><div className="management-account-actions"><button type="button" className="icon-button" aria-label={`编辑 ${account.username}`} onClick={onEdit} disabled={busy}><Pencil size={15} /></button><button type="button" className="icon-button danger-button" aria-label={`删除 ${account.username}`} onClick={onDelete} disabled={busy}><Trash2 size={15} /></button>{reconnectable && <button type="button" className="icon-button" aria-label={`重连 ${account.username}`} onClick={onReconnect} disabled={busy}><RefreshCw size={15} /></button>}<button type="button" className={`account-power ${account.enabled ? 'enabled' : ''}`} onClick={onToggle} disabled={busy} aria-label={account.enabled ? `停止 ${account.username}` : `启动 ${account.username}`}>{busy ? <LoaderCircle size={15} className="spin" /> : <Power size={15} />}{account.enabled ? '停止' : '启动'}</button></div></div>;
}

function statusLabel(status: AccountSnapshot['status']) { return { online: '在线', connecting: '连接中', reconnecting: '重连中', offline: '离线', failed: '失败', disabled: '已停用' }[status]; }
function errorMessage(reason: unknown) { return reason instanceof ApiError ? ({ server_exists: '服务器标识已存在', server_not_found: '服务器不存在', account_exists: '账号已存在', invalid_account: '账号信息不完整或无效', invalid_password: '密码不符合要求', server_disabled: '服务器已停用' }[reason.code] ?? reason.code) : '无法连接 auto 服务'; }
