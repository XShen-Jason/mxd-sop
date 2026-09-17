import { ServerCog } from 'lucide-react';
import type { AutoServiceStatus } from '../../types';
import { ServiceModePanel, type ServiceModeHealth, type ServiceModeOption } from './ServiceModePanel';

export function AutomationServiceSettings({ status, loading, connectionEnabled, onRefresh }: { status: AutoServiceStatus | null; loading: boolean; connectionEnabled: boolean; onRefresh: () => void }) {
  const available = status?.available === true;
  const health: ServiceModeHealth = !connectionEnabled ? 'disabled' : loading ? 'pending' : available ? 'healthy' : status?.configured ? 'unavailable' : 'not-configured';
  const localOption: ServiceModeOption = {
    mode: 'local',
    endpoint: status?.endpoint ?? '',
    health: health === 'pending' || health === 'disabled' ? 'not-configured' : health,
    statusLabel: !connectionEnabled ? '连接已关闭' : loading ? '检查中' : available ? '健康可用' : status?.configured ? '不可用' : '待配置',
  };
  const remoteOption: ServiceModeOption = {
    mode: 'remote',
    endpoint: '',
    health: 'not-configured',
    statusLabel: '待配置',
  };
  const statusLabel = !connectionEnabled ? '连接已关闭' : loading ? '检查中' : available ? '健康可用' : status?.configured ? '不可用' : '待配置';
  return <ServiceModePanel className="automation-service-settings" title="游戏服务" icon={ServerCog} health={health} statusLabel={statusLabel} currentMode="local" options={[localOption, remoteOption]} loading={loading && connectionEnabled} connectionEnabled={connectionEnabled} onRefresh={onRefresh} onSwitch={() => undefined} />;
}
