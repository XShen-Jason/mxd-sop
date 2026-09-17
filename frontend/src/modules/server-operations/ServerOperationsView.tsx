import { Gamepad2, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError } from '../../api/client';
import { ConfirmDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import type { AppOptions } from '../../types';
import { GameServerWorkspace } from './GameServerWorkspace';
import { ServiceConnectionsPanel } from './ServiceConnectionsPanel';
import { managedServiceDefinitions, type ManagedServiceCategory, type ManagedServiceDefinition, type ManagedServiceId } from './types';

export function ServerOperationsView({ options, userId, token }: { options: AppOptions; userId?: string; token?: string }) {
  const client = useMemo(() => new ApiClient(userId ?? 'anonymous', token), [token, userId]);
  const [activeService, setActiveService] = useState<ManagedServiceId>('mxd-player');
  const [connections, setConnections] = useState<Partial<Record<ManagedServiceId, boolean>>>({});
  const [pendingConnection, setPendingConnection] = useState<{ id: ManagedServiceId; enabled: boolean } | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const service = managedServiceDefinitions.find((item) => item.id === activeService) ?? managedServiceDefinitions[0];

  useEffect(() => {
    let active = true;
    Promise.allSettled([client.playerIntegrationStatus(), client.autoStatus()]).then(([player, auto]) => {
      if (!active) return;
      setConnections({
        ...(player.status === 'fulfilled' ? { 'mxd-player': player.value.enabled } : {}),
        ...(auto.status === 'fulfilled' ? { 'game-server': auto.value.enabled } : {}),
      });
      const failure = player.status === 'rejected' ? player.reason : auto.status === 'rejected' ? auto.reason : undefined;
      if (failure) setError(failure instanceof ApiError ? failure.message : '无法读取服务连接状态');
    });
    return () => { active = false; };
  }, [client]);

  const confirmConnection = async () => {
    if (!pendingConnection) return;
    const target = pendingConnection;
    setConnectionBusy(true);
    setError('');
    try {
      if (target.id === 'mxd-player') await client.setPlayerIntegrationConnection(target.enabled);
      else await client.setAutoConnection(target.enabled);
      setConnections((current) => ({ ...current, [target.id]: target.enabled }));
      setConnectionRevision((value) => value + 1);
      setNotice(`${serviceName(target.id)}连接已${target.enabled ? '开启' : '关闭'}`);
      setPendingConnection(null);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '连接状态更新失败');
      setPendingConnection(null);
    } finally {
      setConnectionBusy(false);
    }
  };

  return <section className="workspace server-operations-workspace">
    <div className="page-heading server-operations-heading">
      <div>
        <h1>服务器管理</h1>
        <p className="heading-copy">管理服务运行位置和游戏服务器配置。</p>
      </div>
    </div>
    <nav className="service-directory" role="tablist" aria-label="服务器管理服务">
      {managedServiceDefinitions.map((item) => <ServiceDirectoryItem key={item.id} item={item} selected={item.id === service.id} enabled={connections[item.id]} busy={connectionBusy && pendingConnection?.id === item.id} onSelect={() => setActiveService(item.id)} onConnectionRequest={(enabled) => setPendingConnection({ id: item.id, enabled })} />)}
    </nav>
    {error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} />}
    {notice && <FloatingNotice kind="success" text={notice} onDismiss={() => setNotice('')} />}
    <div className="service-page-container" role="tabpanel" aria-label={`${service.name}页面`}>
      {service.id === 'game-server' ? <GameServerWorkspace options={options} userId={userId} token={token} connectionEnabled={connections['game-server'] ?? true} connectionRevision={connectionRevision} /> : <ServiceConnectionsPanel serviceId={service.id} userId={userId} token={token} connectionRevision={connectionRevision} />}
    </div>
    {pendingConnection && <ConfirmDialog danger={!pendingConnection.enabled} busy={connectionBusy} title={`${pendingConnection.enabled ? '开启' : '关闭'}${serviceName(pendingConnection.id)}连接？`} description={connectionDescription(pendingConnection.id, pendingConnection.enabled)} confirmLabel={`确认${pendingConnection.enabled ? '开启' : '关闭'}`} onCancel={() => setPendingConnection(null)} onConfirm={() => void confirmConnection()} />}
  </section>;
}

function ServiceDirectoryItem({ item, selected, enabled, busy, onSelect, onConnectionRequest }: { item: ManagedServiceDefinition; selected: boolean; enabled?: boolean; busy: boolean; onSelect: () => void; onConnectionRequest: (enabled: boolean) => void }) {
  const Icon = serviceIcon(item.category);
  return <div className={`service-directory-item category-${item.category} ${selected ? 'active' : ''}`}>
    <button type="button" role="tab" aria-selected={selected} className="service-directory-select" onClick={onSelect}>
      <span className="service-directory-icon"><Icon size={19} aria-hidden="true" /></span>
      <span className="service-directory-copy"><strong>{item.name}</strong><code>{item.product}</code></span>
    </button>
    <span className="service-directory-connection">
      <span className={`service-directory-state state-${item.kind}`}>{kindLabel(item.kind)}</span>
      <label className="service-connection-toggle" title={`${enabled === false ? '开启' : '关闭'}${item.name}连接`}>
        <input type="checkbox" checked={enabled ?? false} disabled={enabled === undefined || busy} aria-label={`${item.name}连接`} onChange={(event) => onConnectionRequest(event.target.checked)} />
        <span className="service-connection-track" aria-hidden="true"><span /></span>
      </label>
    </span>
  </div>;
}

function serviceIcon(category: ManagedServiceCategory): LucideIcon {
  return category === 'player' ? UserRound : Gamepad2;
}

function kindLabel(kind: ManagedServiceDefinition['kind']) {
  return kind === 'connected' ? '已接入' : '可配置';
}

function serviceName(id: ManagedServiceId) { return id === 'mxd-player' ? '玩家服务' : '游戏服务器'; }

function connectionDescription(id: ManagedServiceId, enabled: boolean) {
  if (enabled) return `系统会先检查${serviceName(id)}是否可用；检查成功后才恢复双方通信。`;
  return id === 'mxd-player'
    ? '关闭后会停止账号同步、队伍快照和失败重试；mxd-player 项目继续运行，已保存的客服数据不受影响。'
    : '关闭后会停止状态同步、自动执行和管理请求；mxd-auto-process 及其现有游戏会话继续运行。';
}
