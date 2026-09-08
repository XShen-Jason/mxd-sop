import { CalendarDays, ChevronLeft, ChevronRight, CircleOff, LoaderCircle, RefreshCw, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError } from '../../api/client';
import { FloatingNotice } from '../../components/FloatingNotice';
import { TeamClearUpload } from './TeamClearUpload';
import type { Role, TeamViewResult, TeamViewServer, TeamViewType } from '../../types';

export function TeamView({ role = 'customer', token }: { role?: Role; token?: string }) {
  const client = useMemo(() => new ApiClient(role, token), [role, token]);
  const [date, setDate] = useState(defaultTeamDate);
  const [serverId, setServerId] = useState('');
  const [result, setResult] = useState<TeamViewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    client.teamView(date, controller.signal).then((value) => {
      if (!controller.signal.aborted) setResult(value);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof ApiError ? reason.message : '队伍快照加载失败');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [client, date, refreshKey]);

  return <section className="workspace team-view-workspace">
    <div className="page-heading team-view-heading"><div><p className="eyebrow">客服工作台</p><h1>{formatTeamDate(date)}组队名单</h1><p className="heading-copy">名单日期为锁定日：{formatTeamDate(previousTeamDate(date))} 全天开放组队，{formatTeamDate(date)} 00:00 锁定。成员仅显示角色 ID。</p></div><div className="heading-stat"><span>队伍总数</span><strong>{result ? totalTeams(result, serverId) : '—'}</strong></div></div>
    <section className="team-view-toolbar panel-surface"><label className="team-date-field"><span>名单日期</span><div className="team-date-input"><button type="button" className="icon-button team-date-step" title="前一天" aria-label="前一天" onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft size={16} /></button><CalendarDays size={16} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button type="button" className="icon-button team-date-step" title="后一天" aria-label="后一天" onClick={() => setDate(shiftDate(date, 1))}><ChevronRight size={16} /></button></div><small className="team-date-explanation">{formatTeamDate(date)} 00:00 锁定前一天的组队名单</small></label><div className="team-sync-state"><span className={`team-state-dot ${result?.sourceStatus === 'ready' ? 'ready' : ''}`} /><div><strong>{result?.sourceStatus === 'ready' ? '已同步锁定队伍' : '等待每日同步'}</strong><small>{result?.fetchedAt ? `同步于 ${formatSyncTime(result.fetchedAt)}` : '每日北京时间 00:05 获取最新快照'}</small></div></div>{role === 'super_admin' && result && <TeamClearUpload client={client} servers={result.servers.map(entry => entry.server)} onImported={imported => { if (imported.dates.length === 1) setDate(imported.dates[0]); setServerId(imported.serverId); setRefreshKey(value => value + 1); }} />}<button type="button" className="icon-button team-refresh" title="刷新队伍快照" aria-label="刷新队伍快照" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={17} /></button></section>
    {result && <div className="team-server-filter-row"><div className="directory-server-filters team-server-filters" role="group" aria-label="按服务器筛选"><button type="button" className={!serverId ? 'selected' : ''} onClick={() => setServerId('')}>全部服务器</button>{result.servers.map((server) => <button type="button" className={serverId === server.server.id ? 'selected' : ''} key={server.server.id} onClick={() => setServerId(server.server.id)}>{server.server.displayName}</button>)}</div><span className="team-id-note">成员为角色 ID</span></div>}
    {error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} actionLabel="重试" onAction={() => setRefreshKey((value) => value + 1)} />}
    {loading ? <div className="empty-state team-empty-state"><LoaderCircle className="spin" size={24} /></div> : result ? <TeamServers result={result} serverId={serverId} /> : <div className="empty-state team-empty-state"><CircleOff size={22} /><h3>暂时无法显示队伍</h3><p>请稍后刷新队伍快照。</p></div>}
  </section>;
}

function TeamServers({ result, serverId }: { result: TeamViewResult; serverId: string }) {
  const servers = serverId ? result.servers.filter((server) => server.server.id === serverId) : result.servers;
  const hasTeams = servers.some((server) => server.types.some((type) => type.teams.length > 0));
  if (!hasTeams) return <div className="empty-state team-empty-state"><div className="empty-icon"><Users size={22} /></div><h3>{result.sourceStatus === 'ready' ? '当天没有已锁定队伍' : '暂无已同步的队伍快照'}</h3><p>{result.sourceStatus === 'ready' ? '服务器和副本类型仍会保留，便于快速定位。' : '快照将在每日北京时间 00:05 从玩家服务同步。'}</p></div>;
  return <div className="team-server-list">{servers.map((server) => <ServerSection key={server.server.id} server={server} />)}</div>;
}

function ServerSection({ server }: { server: TeamViewServer }) {
  return <section className="team-server-section"><div className="team-server-heading"><div><span className="eyebrow">SERVER</span><h2>{server.server.displayName}</h2></div><span className="team-server-total">{server.types.reduce((sum, type) => sum + type.teams.length, 0)} 队</span></div><div className="team-type-grid">{server.types.map((type) => <TeamTypeSection key={type.type} type={type} />)}</div></section>;
}

function TeamTypeSection({ type }: { type: TeamViewType }) {
  return <section className="team-type-section">
    <header><div><span className={`team-boss-mark ${type.type}`} /><h3>{type.displayName}</h3></div><span>{type.teams.length} 队</span></header>
    {type.teams.length ? <div className="team-list">{type.teams.map(team => {
      const cleared = new Set(team.clearedMembers ?? []);
      return <article className={`team-row${team.cleared ? ' team-cleared' : ''}`} key={team.id} aria-label={`第 ${team.sequence} 队，${team.memberCount} 个角色 ID${team.cleared ? '，全员通关' : ''}`}>
        <div className="team-sequence">#{team.sequence}</div>
        <div className="team-character-list" aria-label="角色 ID">{team.members.map(characterId => <code className={cleared.has(characterId) ? 'character-cleared' : undefined} key={characterId} title={`角色 ID ${characterId}${cleared.has(characterId) ? ' · 已通关' : ''}`} aria-label={`${characterId}${cleared.has(characterId) ? ' 已通关' : ''}`}>{characterId}</code>)}</div>
        {team.cleared && <span className="team-clear-status">全员通关</span>}
      </article>;
    })}</div> : <p className="team-type-empty">暂无队伍</p>}
  </section>;
}

function totalTeams(result: TeamViewResult, serverId = '') { return result.servers.filter((server) => !serverId || server.server.id === serverId).reduce((sum, server) => sum + server.types.reduce((typeSum, type) => typeSum + type.teams.length, 0), 0); }
function formatSyncTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function formatTeamDate(value: string) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).formatToParts(new Date(`${value}T00:00:00+08:00`));
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${Number(month)}月${Number(day)}日`;
}
function previousTeamDate(value: string) { if (!value) return ''; const date = new Date(`${value}T00:00:00+08:00`); date.setUTCDate(date.getUTCDate() - 1); return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); }
function shiftDate(value: string, amount: number) { const date = new Date(`${value}T00:00:00+08:00`); date.setUTCDate(date.getUTCDate() + amount); return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); }
function defaultTeamDate() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
