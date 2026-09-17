import { CheckCircle2, CircleAlert, Globe2, Laptop, LoaderCircle, RefreshCw, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { modeLabel, type ServiceDeploymentMode } from './types';

export type ServiceModeHealth = 'healthy' | 'unavailable' | 'not-configured' | 'pending' | 'error' | 'disabled';

export interface ServiceModeOption {
  mode: ServiceDeploymentMode;
  endpoint: string;
  health: Exclude<ServiceModeHealth, 'pending' | 'error' | 'disabled'>;
  statusLabel: string;
}

type ServiceModePanelProps = {
  title: string;
  icon: LucideIcon;
  health: ServiceModeHealth;
  statusLabel: string;
  currentMode: ServiceDeploymentMode;
  options: ServiceModeOption[];
  loading?: boolean;
  connectionEnabled?: boolean;
  className?: string;
  onRefresh: () => void;
  onSwitch: (mode: ServiceDeploymentMode) => void;
  onConfigure?: () => void;
  configLabel?: string;
  children?: ReactNode;
};

export function ServiceModePanel({ title, icon: Icon, health, statusLabel, currentMode, options, loading = false, connectionEnabled = true, className = '', onRefresh, onSwitch, onConfigure, configLabel = '配置运行位置', children }: ServiceModePanelProps) {
  return <section className={`service-mode-panel panel-surface health-${health} ${className}`.trim()}>
    <div className="service-mode-header">
      <div className="service-mode-title"><span className="service-mode-icon"><Icon size={18} /></span><div><h2>{title}</h2></div></div>
      <div className="service-mode-tools">
        <span className="service-mode-current">当前：{modeLabel(currentMode)}</span>
        <span className={`service-mode-status health-${health}`}><HealthIcon health={health} />{statusLabel}</span>
        {onConfigure && <button type="button" className="icon-button service-mode-configure" title={configLabel} aria-label={configLabel} onClick={onConfigure}><Settings2 size={16} /></button>}
        <button type="button" className="icon-button service-mode-refresh" title="刷新服务状态" aria-label="刷新服务状态" onClick={onRefresh} disabled={loading || !connectionEnabled}><RefreshCw className={loading ? 'spin' : ''} size={16} /></button>
      </div>
    </div>
    {loading ? <div className="service-mode-loading"><LoaderCircle className="spin" size={20} /><span>正在检查服务状态</span></div> : options.length ? <div className="service-mode-cards" role="group" aria-label={`${title}${options.length > 1 ? '本地和远程服务' : '服务'}`}>
      {options.map((option) => <ServiceModeCard key={option.mode} option={option} active={option.mode === currentMode} connectionEnabled={connectionEnabled} onSwitch={() => onSwitch(option.mode)} />)}
    </div> : <div className="service-mode-empty"><CircleAlert size={19} /><span>服务状态暂不可用</span></div>}
    {children}
  </section>;
}

function ServiceModeCard({ option, active, connectionEnabled, onSwitch }: { option: ServiceModeOption; active: boolean; connectionEnabled: boolean; onSwitch: () => void }) {
  const Icon = option.mode === 'local' ? Laptop : Globe2;
  const canSwitch = connectionEnabled && option.health === 'healthy' && !active;
  return <article className={`service-mode-card health-${option.health} ${active ? 'active' : ''}`}>
    <div className="service-mode-card-main"><span className="service-mode-card-icon"><Icon size={16} /></span><div><strong>{modeLabel(option.mode)}服务</strong><code>{option.endpoint || '未配置服务端点'}</code></div></div>
    <span className={`service-mode-card-state health-${option.health}`}><HealthIcon health={option.health} />{option.statusLabel}</span>
    {active ? <span className="service-mode-active">当前使用</span> : <button type="button" className="secondary-button service-mode-switch" disabled={!canSwitch} onClick={onSwitch}>切换</button>}
  </article>;
}

function HealthIcon({ health }: { health: ServiceModeHealth }) {
  return health === 'healthy' ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />;
}
