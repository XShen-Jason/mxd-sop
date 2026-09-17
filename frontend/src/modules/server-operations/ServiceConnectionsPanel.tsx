import { UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError } from '../../api/client';
import { ConfirmDialog, TextPromptDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import type { PlayerIntegrationStatus } from '../../types';
import { ServiceModePanel, type ServiceModeHealth, type ServiceModeOption } from './ServiceModePanel';
import { managedServiceDefinitions, modeLabel, type ManagedServiceDefinition, type ServiceDeploymentMode } from './types';

type ConnectedServiceId = 'mxd-player';
type EndpointState = PlayerIntegrationStatus['endpoints'][ServiceDeploymentMode];
type ServiceConnectionStatus = PlayerIntegrationStatus;
type ManagedService = ManagedServiceDefinition & { icon: LucideIcon; loadStatus: (client: ApiClient) => Promise<ServiceConnectionStatus>; switchMode: (client: ApiClient, mode: ServiceDeploymentMode, confirmation: string) => Promise<unknown> };

const switchConfirmation = 'SWITCH PLAYER SERVER';
const connectedServices: Record<ConnectedServiceId, ManagedService> = {
  'mxd-player': {
    ...serviceDefinition('mxd-player'),
    icon: UserRound,
    loadStatus: (client) => client.playerIntegrationStatus(),
    switchMode: (client, mode, confirmation) => client.switchPlayerIntegration(mode, confirmation),
  },
};

export function ServiceConnectionsPanel({ serviceId, userId, token, connectionRevision = 0 }: { serviceId: ConnectedServiceId; userId?: string; token?: string; connectionRevision?: number }) {
  const client = useMemo(() => new ApiClient(userId ?? 'anonymous', token), [token, userId]);
  const service = connectedServices[serviceId];
  const [status, setStatus] = useState<ServiceConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingMode, setPendingMode] = useState<ServiceDeploymentMode | null>(null);
  const [textMode, setTextMode] = useState<ServiceDeploymentMode | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setPendingMode(null);
    setTextMode(null);
    let active = true;
    setLoading(true);
    setStatus(null);
    setError('');
    service.loadStatus(client).then((value) => { if (active) setStatus(value); }).catch((reason) => { if (active) setError(reason instanceof ApiError ? reason.message : '无法读取服务状态'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, connectionRevision, refreshKey, service]);

  const refresh = () => setRefreshKey((value) => value + 1);
  const confirmSwitch = async (confirmation: string) => {
    if (!textMode) return;
    setSwitching(true);
    setError('');
    try {
      await service.switchMode(client, textMode, confirmation);
      setTextMode(null);
      setNotice(`已将 ${service.product} 切换到${modeLabel(textMode)}服务`);
      refresh();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '切换失败，请检查目标服务');
    } finally {
      setSwitching(false);
    }
  };

  const health = serviceHealth(status, loading, error);
  const options = status ? endpointOptions(status) : [];
  return <ServiceModePanel className={`service-connections category-${service.category}`} title={service.name} icon={service.icon} health={health} statusLabel={healthLabel(health)} currentMode={status?.mode ?? 'local'} options={options} loading={loading} connectionEnabled={status?.enabled ?? true} onRefresh={refresh} onSwitch={setPendingMode}>
    {error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} actionLabel="重试" onAction={refresh} />}
    {notice && <FloatingNotice kind="success" text={notice} onDismiss={() => setNotice('')} />}
    {pendingMode && <ConfirmDialog title={`确认切换到${modeLabel(pendingMode)}服务`} description={`这会改变 ${service.product} 的访问目标，账号同步和队伍快照也会跟随新的服务位置。`} confirmLabel="继续验证" onCancel={() => setPendingMode(null)} onConfirm={() => { setTextMode(pendingMode); setPendingMode(null); }} />}
    {textMode && <TextPromptDialog title={`输入确认文本以切换到${modeLabel(textMode)}服务`} description={`请输入 ${switchConfirmation} 完成第二次确认。`} label="确认文本" placeholder={switchConfirmation} submitLabel="确认切换" inputType="text" minLength={switchConfirmation.length} busy={switching} onCancel={() => setTextMode(null)} onSubmit={(value) => void confirmSwitch(value)} />}
  </ServiceModePanel>;
}

function endpointOptions(status: ServiceConnectionStatus): ServiceModeOption[] {
  return (['local', 'remote'] as ServiceDeploymentMode[]).map((mode) => {
    const endpoint = status.endpoints[mode];
    return { mode, endpoint: mode === status.mode ? status.activeEndpoint ?? '已配置服务端点' : endpoint.configured ? '已配置服务端点' : '', health: status.enabled ? endpointHealth(endpoint) : 'not-configured', statusLabel: status.enabled ? endpointLabel(endpoint) : '连接已关闭' };
  });
}

function endpointHealth(endpoint: EndpointState): Exclude<ServiceModeHealth, 'pending' | 'error' | 'disabled'> {
  return endpoint.available === true ? 'healthy' : endpoint.configured ? 'unavailable' : 'not-configured';
}

function endpointLabel(endpoint: EndpointState) {
  return endpoint.available === true ? '健康可用' : endpoint.configured ? '不可用' : '待配置';
}

function serviceHealth(status: ServiceConnectionStatus | null, loading: boolean, error: string): ServiceModeHealth {
  if (loading || (!status && !error)) return 'pending';
  if (error || !status) return 'error';
  if (!status.enabled) return 'disabled';
  return endpointHealth(status.endpoints[status.mode]);
}

function healthLabel(health: ServiceModeHealth) {
  return health === 'healthy' ? '健康可用' : health === 'disabled' ? '连接已关闭' : health === 'unavailable' || health === 'error' ? '不可用' : health === 'pending' ? '检查中' : '待配置';
}

function serviceDefinition(id: ConnectedServiceId) {
  return managedServiceDefinitions.find((item) => item.id === id)!;
}
