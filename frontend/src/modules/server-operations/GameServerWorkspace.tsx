import { Check, LoaderCircle, Pencil, ServerCog, Trash2, Unplug } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError } from '../../api/client';
import { ConfirmDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import type { AppOptions, AutoMessageResult, AutoOverview } from '../../types';
import { AutomationServiceSettings } from './AutomationServiceSettings';
import { ServerDetailsPanel } from './ServerDetailsPanel';
import { AccountSetupDialog, ServerConfigDialog } from './ServerSetupDialog';
import { type AccountSetupValue, type ConfiguredServer, type ServerAccount, type ServerFormValue, type ServerMessageType } from './types';
import { serverLiveStatus } from './server-status';
import './server-status.css';

type PendingAction = { kind: 'server'; server: ConfiguredServer } | { kind: 'account-delete' | 'account-stop'; server: ConfiguredServer; account: ServerAccount };

export function GameServerWorkspace({ options, userId, token, connectionEnabled, connectionRevision = 0 }: { options: AppOptions; userId?: string; token?: string; connectionEnabled: boolean; connectionRevision?: number }) {
  const client = useMemo(() => new ApiClient(userId ?? 'anonymous', token), [token, userId]);
  const [servers, setServers] = useState<ConfiguredServer[]>([]);
  const [autoStatus, setAutoStatus] = useState<Awaited<ReturnType<ApiClient['autoStatus']>> | null>(null);
  const [overviewFresh, setOverviewFresh] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState<ConfiguredServer | null>(null);
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [accountTarget, setAccountTarget] = useState<{ server: ConfiguredServer; account?: ServerAccount } | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState('');
  const overviewController = useRef<AbortController | null>(null);
  const statusController = useRef<AbortController | null>(null);
  const selected = servers.find((server) => server.id === selectedId) ?? servers[0] ?? null;

  const loadStatus = useCallback(async (showLoading = false) => {
    if (statusController.current) return;
    const controller = new AbortController();
    statusController.current = controller;
    if (showLoading) setStatusLoading(true);
    try {
      const value = await client.autoStatus(controller.signal);
      if (!controller.signal.aborted) {
        setAutoStatus(value);
      }
      return value;
    } catch (reason) {
      if (!controller.signal.aborted) { setAutoStatus(null); setError(errorMessage(reason)); }
      return null;
    } finally {
      if (statusController.current === controller) statusController.current = null;
      if (showLoading && statusController.current === null) setStatusLoading(false);
    }
  }, [client]);
  const loadOverview = useCallback(async (showLoading = false) => {
    if (overviewController.current) return;
    const controller = new AbortController();
    overviewController.current = controller;
    if (showLoading) setLoading(true);
    try {
      const value: AutoOverview = await client.autoOverview(controller.signal);
      if (!controller.signal.aborted) {
        setServers(value.servers);
        setOverviewFresh(true);
        setSelectedId((current) => current && value.servers.some((server) => server.id === current) ? current : value.servers[0]?.id ?? null);
        setError('');
      }
    } catch (reason) { if (!controller.signal.aborted) { setOverviewFresh(false); setError(errorMessage(reason)); } }
    finally {
      if (overviewController.current === controller) overviewController.current = null;
      if (showLoading && overviewController.current === null) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!connectionEnabled) {
      setAutoStatus((current) => current ? { ...current, enabled: false, available: null } : null);
      setOverviewFresh(false);
      setError('');
      setLoading(false);
      setStatusLoading(false);
      return;
    }
    let active = true;
    const refresh = async () => {
      if (!active || document.visibilityState === 'hidden') return;
      const status = await loadStatus();
      if (status?.enabled) await loadOverview();
    };
    const initial = async () => {
      const status = await loadStatus(true);
      if (status?.enabled) await loadOverview(true);
      else setLoading(false);
    };
    void initial();
    const timer = window.setInterval(refresh, 2_000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      overviewController.current?.abort();
      statusController.current?.abort();
      overviewController.current = null;
      statusController.current = null;
    };
  }, [client, connectionEnabled, connectionRevision, loadOverview, loadStatus]);

  const run = async <T,>(key: string, action: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(key);
    try { const result = await action(); if (success) setNotice(success); await loadOverview(); return result; } catch (reason) { setError(errorMessage(reason)); return undefined; } finally { setBusy(''); }
  };
  const saveServer = async (value: ServerFormValue) => {
    const catalog = options.servers.find((item) => item.id === value.catalogId);
    const name = editingServer?.name ?? catalog?.displayName;
    if (!name) return setError('请选择服务器');
    const address = formatAddress(value.host, Number(value.port));
    const action = editingServer ? () => client.updateAutoServer(editingServer.id, { name, address, version: value.version }) : () => client.createAutoServer({ id: value.catalogId, name, address, version: value.version, map_id: '211000000', enabled: true });
    if (await run(`server-${value.catalogId}`, action, editingServer ? '服务器配置已更新' : '服务器已添加')) { setEditingServer(null); setServerDialogOpen(false); }
  };
  const cancelAccountSetup = (sessionId?: string) => {
    setAccountTarget(null);
    if (sessionId) void client.stopAutoSession(sessionId).catch(() => undefined);
  };
  const resetAccountSetup = (sessionId: string) => client.stopAutoSession(sessionId);
  const saveAccount = async (value: AccountSetupValue) => {
    if (!accountTarget) return false;
    const { server, account } = accountTarget;
    const input = { username: value.username, ...(value.password ? { password: value.password, credential_type: value.credentialType } : {}), character_id: value.characterId, character_name: value.characterName, enabled: value.enabled };
    const action = account ? () => client.updateAutoAccount(server.id, account.id, input) : () => client.createAutoAccount(server.id, { ...input, password: value.password, credential_type: value.credentialType, ...(value.sessionId ? { session_id: value.sessionId } : {}) });
    const success = account ? (value.enabled ? '账号配置已保存，正在重新登录' : '账号已更新') : '账号已进入游戏并完成保存';
    const saved = await run(`account-${account?.id ?? 'new'}`, action, success);
    if (saved) setAccountTarget(null);
    return Boolean(saved);
  };
  const toggleAccount = (serverId: string, accountId: string, enabled: boolean) => {
    const server = servers.find((item) => item.id === serverId);
    const account = server?.accounts.find((item) => item.id === accountId);
    if (!server || !account) return;
    if (!enabled) return setPendingAction({ kind: 'account-stop', server, account });
    void run(`account-${accountId}`, () => client.startAutoAccount(serverId, accountId), '账号登录请求已发送');
  };
  const toggleAutomation = (account: ServerAccount) => void run(`account-${account.id}`, () => client.updateAutoAccount(account.server_id, account.id, { automation_enabled: !account.automation_enabled }), account.automation_enabled ? '自动化已关闭，登录状态不变' : '自动化已启用，在线时参与执行');
  const confirmAction = () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    if (action.kind === 'server') void run(`server-${action.server.id}`, () => client.deleteAutoServer(action.server.id), '服务器已删除');
    if (action.kind === 'account-delete') void run(`account-${action.account.id}`, () => client.deleteAutoAccount(action.server.id, action.account.id), '账号已删除');
    if (action.kind === 'account-stop') void run(`account-${action.account.id}`, () => client.stopAutoAccount(action.server.id, action.account.id), '账号已退出');
  };
  const sendMessage = (server: ConfiguredServer, account: ServerAccount, type: ServerMessageType, message: string): Promise<AutoMessageResult | undefined> => run(`message-${account.id}`, () => client.sendAutoMessage(server.id, account.id, { message, mode: type }));
  const reconnect = (account: ServerAccount) => void run(`account-${account.id}`, () => client.reconnectAutoAccount(account.server_id, account.id), '手动重连请求已发送');
  const canAddServer = options.servers.some((item) => !servers.some((server) => server.id === item.id));
  const statusFresh = overviewFresh && !statusLoading && autoStatus?.enabled === true && autoStatus.available === true;
  const settings = <AutomationServiceSettings status={autoStatus} loading={statusLoading} connectionEnabled={connectionEnabled} onRefresh={() => void loadStatus(true)} />;
  if (!connectionEnabled) return <section className="game-server-workspace connection-paused" aria-labelledby="game-server-page-title">{settings}<div className="server-connection-paused panel-surface" role="status"><Unplug size={26} aria-hidden="true" /><h2 id="game-server-page-title">游戏服务器连接已暂停</h2><p>mxd-auto-process 和现有游戏会话仍在运行。</p></div></section>;
  return <section className="game-server-workspace" aria-labelledby="game-server-page-title">{settings}{error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} actionLabel="重试" onAction={() => { void loadStatus(true); void loadOverview(); }} />}{notice && <FloatingNotice kind="success" text={notice} onDismiss={() => setNotice('')} />}<section className="server-management-layout" aria-label="游戏服务器管理"><section className="server-list-panel panel-surface" aria-labelledby="game-server-page-title"><div className="server-list-heading"><div><h2 id="game-server-page-title">服务器列表</h2><span>状态来自 mxd-auto-process，每 2 秒同步一次。</span></div><button type="button" className="primary-button server-configure-button" disabled={!canAddServer || loading || Boolean(busy)} onClick={() => { setEditingServer(null); setServerDialogOpen(true); }}><ServerCog size={18} />配置服务器</button></div>{loading ? <div className="server-empty"><LoaderCircle className="spin" size={24} /><span>正在读取 auto 数据…</span></div> : <div className="server-list">{servers.length ? servers.map((server) => <ServerListItem key={server.id} server={server} live={statusFresh} selected={selected?.id === server.id} busy={Boolean(busy)} onSelect={() => setSelectedId(server.id)} onEdit={() => { setEditingServer(server); setServerDialogOpen(true); }} onDelete={() => setPendingAction({ kind: 'server', server })} />) : <div className="server-empty"><ServerCog size={24} /><strong>还没有游戏服务器</strong><span>点击配置服务器并选择一个服务器标识。</span></div>}</div>}</section>{selected ? <ServerDetailsPanel server={selected} statusFresh={statusFresh} busy={Boolean(busy)} onToggleAutomation={toggleAutomation} onAddAccount={() => setAccountTarget({ server: selected })} onToggleAccount={toggleAccount} onEditAccount={(account) => setAccountTarget({ server: selected, account })} onDeleteAccount={(account) => setPendingAction({ kind: 'account-delete', server: selected, account })} onReconnectAccount={reconnect} onSendMessage={sendMessage} /> : <div className="server-detail-empty panel-surface"><ServerCog size={25} /><strong>选择或配置一台服务器</strong><span>服务器配置完成后，可在这里管理账号并发送消息。</span></div>}</section>{serverDialogOpen && <ServerConfigDialog options={options} server={editingServer} configuredIds={servers.map((server) => server.id)} onCancel={() => { setEditingServer(null); setServerDialogOpen(false); }} onSave={(value) => void saveServer(value)} />}{accountTarget && <AccountSetupDialog server={accountTarget.server} account={accountTarget.account} onCancel={cancelAccountSetup} onResetLogin={resetAccountSetup} onLogin={(username, password, credentialType) => client.startAutoSession(accountTarget.server.id, { account: username, password, credential_type: credentialType })} onEnterGame={(sessionId, characterId) => client.selectAndEnterAutoSession(sessionId, characterId)} onComplete={(value) => saveAccount(value)} />}{pendingAction && <ConfirmDialog danger busy={Boolean(busy)} title={pendingTitle(pendingAction)} description={pendingDescription(pendingAction)} confirmLabel={pendingAction.kind === 'account-stop' ? '确认退出' : '确认删除'} onCancel={() => setPendingAction(null)} onConfirm={confirmAction} />}</section>;
}

function ServerListItem({ server, live, selected, busy, onSelect, onEdit, onDelete }: { server: ConfiguredServer; live: boolean; selected: boolean; busy: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const status = serverLiveStatus(server, live);
  return <article className={`server-list-item ${selected ? 'selected' : ''}`}><button type="button" className="server-list-select" onClick={onSelect} aria-pressed={selected}><span className="server-live-dot" data-server-status data-status-tone={status.tone} aria-label={status.label} /><span className="server-list-copy"><strong>{server.name}</strong><span>{server.address}</span></span>{selected && <Check className="server-list-check" size={17} aria-label="当前选择" />}</button><div className="server-list-item-actions"><button type="button" className="icon-button" title="修改服务器" aria-label={`修改 ${server.name}`} onClick={onEdit} disabled={busy}><Pencil size={16} /></button><button type="button" className="icon-button danger-button" title="删除服务器" aria-label={`删除 ${server.name}`} onClick={onDelete} disabled={busy}><Trash2 size={16} /></button></div></article>;
}

function formatAddress(host: string, port: number) { return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`; }
function pendingTitle(action: PendingAction) { return action.kind === 'server' ? `删除 ${action.server.name}？` : action.kind === 'account-delete' ? `删除账号 ${action.account.username}？` : `退出账号 ${action.account.username}？`; }
function pendingDescription(action: PendingAction) { return action.kind === 'server' ? '删除后 auto 中的服务器配置和其账号都会被移除。' : action.kind === 'account-delete' ? '删除后 auto 中保存的加密凭据和运行会话都会被移除。' : '退出会断开游戏服务器连接，停止自动重连；自动化开关的设置将保留。'; }
function errorMessage(reason: unknown) { return reason instanceof ApiError ? reason.message : '无法连接 mxd-auto-process'; }
