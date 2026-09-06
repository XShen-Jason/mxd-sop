import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, ServerCog } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError } from '../../api/client';
import { ConfirmDialog, TextPromptDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import type { PlayerDeploymentMode, PlayerIntegrationStatus, Role } from '../../types';

const confirmationText = 'SWITCH PLAYER SERVER';

export function PlayerIntegrationView({ role, token }: { role: Role; token?: string }) {
  const client = useMemo(() => new ApiClient(role, token), [role, token]);
  const [status, setStatus] = useState<PlayerIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [pendingMode, setPendingMode] = useState<PlayerDeploymentMode | null>(null);
  const [textMode, setTextMode] = useState<PlayerDeploymentMode | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    client.playerIntegrationStatus().then((value) => { if (active) setStatus(value); }).catch((reason) => { if (active) setError(reason instanceof ApiError ? reason.message : '无法读取玩家服务状态'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, refreshKey]);

  const confirmSwitch = async (confirmation: string) => {
    if (!textMode) return;
    setSwitching(true);
    setError('');
    try {
      await client.switchPlayerIntegration(textMode, confirmation);
      setTextMode(null);
      setNotice(`已切换到${textMode === 'local' ? '同机' : '远程'}玩家服务`);
      setRefreshKey((value) => value + 1);
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : '切换失败，请检查玩家服务'); }
    finally { setSwitching(false); }
  };

  return <section className="workspace player-integration-workspace">
    <div className="page-heading"><div><p className="eyebrow">超管安全设置</p><h1>玩家服务</h1><p className="heading-copy">账号同步和队伍快照只连接当前活跃的玩家后端，切换前会检查目标服务。</p></div><div className="heading-stat"><span>当前模式</span><strong>{status ? modeLabel(status.mode) : '—'}</strong></div></div>
    {error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} actionLabel="重试" onAction={() => setRefreshKey((value) => value + 1)} />}
    {loading ? <div className="empty-state"><LoaderCircle className="spin" size={24} /></div> : status && <>
      <section className="player-integration-status panel-surface"><div className="integration-status-heading"><div><p className="eyebrow">连接状态</p><h2>服务端点</h2></div><button type="button" className="icon-button" title="刷新服务状态" aria-label="刷新服务状态" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><RefreshCw size={16} /></button></div><div className="integration-endpoints"><EndpointCard mode="local" status={status.endpoints.local} active={status.mode === 'local'} onSwitch={() => setPendingMode('local')} /><EndpointCard mode="remote" status={status.endpoints.remote} active={status.mode === 'remote'} onSwitch={() => setPendingMode('remote')} /></div><p className="integration-check-time">最近检查：{formatTime(status.checkedAt)}</p></section>
      <section className="player-integration-notice panel-surface"><ServerCog size={20} /><div><strong>上传账号数据的写入顺序</strong><p>CSV 会先写入当前玩家服务的 SQLite，再更新客服工作台目录。玩家账号、会话和队伍数据不会从玩家服务删除。</p></div></section>
    </>}
    {notice && <FloatingNotice kind="success" text={notice} onDismiss={() => setNotice('')} />}
    {pendingMode && <ConfirmDialog title={`确认切换到${modeLabel(pendingMode)}玩家服务`} description="这会改变玩家登录、账号同步和队伍快照的目标后端。请确认你要执行此项安全操作。" confirmLabel="继续验证" onCancel={() => setPendingMode(null)} onConfirm={() => { setTextMode(pendingMode); setPendingMode(null); }} />}
    {textMode && <TextPromptDialog title={`输入确认文本以切换到${modeLabel(textMode)}服务`} description={`请输入 ${confirmationText} 完成第二次确认。`} label="确认文本" placeholder={confirmationText} submitLabel="确认切换" inputType="text" minLength={confirmationText.length} busy={switching} onCancel={() => setTextMode(null)} onSubmit={(value) => void confirmSwitch(value)} />}
  </section>;
}

function EndpointCard({ mode, status, active, onSwitch }: { mode: PlayerDeploymentMode; status: { configured: boolean; available: boolean | null }; active: boolean; onSwitch: () => void }) {
  const healthy = status.available === true;
  return <article className={`integration-endpoint-card ${active ? 'active' : ''}`}><div className="integration-endpoint-top"><span className="integration-endpoint-icon">{healthy ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}</span><div><h3>{modeLabel(mode)}玩家服务</h3><p>{mode === 'local' ? '与客服工作台同一台服务器' : '独立远程服务器'}</p></div>{active && <span className="integration-active-badge">当前使用</span>}</div><div className="integration-endpoint-state">{!status.configured ? '未配置' : healthy ? '健康可用' : status.available === false ? '检查失败' : '未检查'}</div>{!active && <button type="button" className="secondary-button" disabled={!status.configured || !healthy} onClick={onSwitch}>切换到此服务</button>}</article>;
}

function modeLabel(mode: PlayerDeploymentMode) { return mode === 'local' ? '同机' : '远程'; }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
