import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Filter, Layers3, LoaderCircle, PackageCheck, RefreshCw, X } from 'lucide-react';
import { ApiClient, ApiError } from '../../api/client';
import { CopyButton } from '../../components/CopyButton';
import { ConfirmDialog, TextPromptDialog } from '../../components/Dialog';
import { FloatingNotice } from '../../components/FloatingNotice';
import { StatusBadge } from '../../components/StatusBadge';
import { formatRecordTime, isIssuanceGroup, IssuanceDetails, IssuanceItemsDisplay, reasonLabel, recordType, RecordTableHeader, WorkflowTimeline } from '../operation-groups/RecordPresentation';
import { UserAdminView } from './UserAdminView';
import type { AppOptions, GeneratedCommand, ManagerGroup, Role } from '../../types';

type Panel = 'queue' | 'ready' | 'archive' | 'reissue' | 'users';
type FilterStatus = 'pending' | 'approved' | 'completed' | 'rejected' | 'cancelled';
const statusEntries: Array<[FilterStatus, string]> = [['pending', '\u5f85\u5ba1\u6838'], ['approved', '\u5f85\u5b8c\u6210'], ['completed', '\u5df2\u5b8c\u6210'], ['rejected', '\u5df2\u9a73\u56de'], ['cancelled', '\u5df2\u53d6\u6d88']];
const defaultStatuses: FilterStatus[] = ['pending', 'approved', 'completed', 'rejected'];
const COPIED_COMMANDS_KEY = 'game-support-copied-commands';

function copiedCommandsStorageKey(role: Role, actorId?: string) { return `${COPIED_COMMANDS_KEY}:${role}:${actorId ?? 'current'}`; }

function readCopiedCommands(storageKey: string) {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return new Set<string>(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch { return new Set<string>(); }
}

function commandKey(groupId: string, command: GeneratedCommand) { return `${groupId}:${command.operationIndex}:${command.sequence}:${command.text}`; }

export function ManagerView({ options, token, role = 'manager', panel = 'queue', actorId, onRequireRelogin }: { options: AppOptions; token?: string; role?: Role; panel?: Panel; actorId?: string; onRequireRelogin?: () => void }) {
  const client = useMemo(() => new ApiClient(role, token), [role, token]);
  const [queue, setQueue] = useState<ManagerGroup[]>([]);
  const [ready, setReady] = useState<ManagerGroup[]>([]);
  const [archive, setArchive] = useState<ManagerGroup[]>([]);
  const [reissue, setReissue] = useState<ManagerGroup[]>([]);
  const [queueCursor, setQueueCursor] = useState<string | null>(null);
  const [readyCursor, setReadyCursor] = useState<string | null>(null);
  const [archiveCursor, setArchiveCursor] = useState<string | null>(null);
  const [reissueCursor, setReissueCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus[]>(defaultStatuses);
  const [serverFilter, setServerFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rejectTarget, setRejectTarget] = useState<ManagerGroup | null>(null);
  const [rejectSaving, setRejectSaving] = useState(false);
  const [actionConfirm, setActionConfirm] = useState<{ action: 'approve' | 'issue' | 'complete'; group: ManagerGroup } | null>(null);
  const [actionSaving, setActionSaving] = useState(false);
  const copiedStorageKey = useMemo(() => copiedCommandsStorageKey(role, actorId), [role, actorId]);
  const [copiedCommands, setCopiedCommands] = useState<Set<string>>(() => readCopiedCommands(copiedStorageKey));
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [queueResult, archiveResult, readyResult, reissueResult] = await Promise.all([
        client.queue(),
        client.archive(),
        role === 'super_admin' ? client.archive('approved') : Promise.resolve({ groups: [], nextCursor: null }),
        client.archive()
      ]);
      setQueue(queueResult.groups);
      setArchive(archiveResult.groups.filter(g => !isIssuanceGroup(g)));
      setReissue(reissueResult.groups.filter(g => isIssuanceGroup(g)));
      setReady(readyResult.groups.filter((group) => isIssuanceGroup(group)));
      setQueueCursor(queueResult.nextCursor);
      setReadyCursor(readyResult.nextCursor);
      setArchiveCursor(archiveResult.nextCursor);
      setReissueCursor(reissueResult.nextCursor);
    } catch (err) { setError(err instanceof ApiError ? err.message : '暂时无法加载管理数据'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [client]);
  useEffect(() => { setNotice(null); }, [panel]);
  useEffect(() => {
    try { localStorage.setItem(copiedStorageKey, JSON.stringify([...copiedCommands])); } catch { /* Storage may be unavailable in private browsing. */ }
  }, [copiedStorageKey, copiedCommands]);

  const markCommandCopied = (groupId: string, command: GeneratedCommand) => {
    const key = commandKey(groupId, command);
    setCopiedCommands((current) => current.has(key) ? current : new Set(current).add(key));
    setNotice({ kind: 'success', text: '指令复制成功' });
  };
  const notifyCommandCopied = () => setNotice({ kind: 'success', text: '指令复制成功' });

  const mutate = async (action: 'approve' | 'reject' | 'issue' | 'complete', group: ManagerGroup) => {
    setError('');
    if (action === 'reject') { setRejectTarget(group); return; }
    setActionConfirm({ action, group });
  };
  const confirmAction = async () => {
    if (!actionConfirm) return;
    setActionSaving(true);
    try {
      if (actionConfirm.action === 'approve') await client.approve(actionConfirm.group.id);
      else if (actionConfirm.action === 'issue') await client.issue(actionConfirm.group.id);
      else await client.complete(actionConfirm.group.id);
      setActionConfirm(null);
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : '操作失败'); }
    finally { setActionSaving(false); }
  };
  const reject = async (reason: string) => { if (!rejectTarget) return; setRejectSaving(true); try { await client.reject(rejectTarget.id, reason || undefined); setRejectTarget(null); await load(); } catch (err) { setError(err instanceof ApiError ? err.message : '驳回失败'); } finally { setRejectSaving(false); } };
  const loadMore = async () => {
    const cursor = panel === 'queue' ? queueCursor : panel === 'ready' ? readyCursor : panel === 'reissue' ? reissueCursor : archiveCursor; if (!cursor) return; setLoading(true);
    try {
      if (panel === 'queue') {
        const result = await client.queue(undefined, cursor);
        setQueue((current) => [...current, ...result.groups]);
        setQueueCursor(result.nextCursor);
      } else if (panel === 'ready') {
        const result = await client.archive('approved', undefined, cursor);
        setReady((current) => [...current, ...result.groups.filter((group) => isIssuanceGroup(group))]);
        setReadyCursor(result.nextCursor);
      } else if (panel === 'reissue') {
        const result = await client.archive(undefined, undefined, cursor);
        setReissue((current) => [...current, ...result.groups.filter(g => isIssuanceGroup(g))]);
        setReissueCursor(result.nextCursor);
      } else {
        const result = await client.archive(undefined, undefined, cursor);
        setArchive((current) => [...current, ...result.groups.filter(g => !isIssuanceGroup(g))]);
        setArchiveCursor(result.nextCursor);
      }
    } catch (err) { setError(err instanceof ApiError ? err.message : '加载更多失败'); } finally { setLoading(false); }
  };

  const pendingCount = queue.length; const approvedCount = role === 'super_admin' ? ready.length : archive.filter((group) => group.status === 'approved').length; const issuedCount = archive.filter((group) => group.status === 'issued' || group.status === 'completed').length;
  const serverMatches = (group: ManagerGroup) => !serverFilter || group.server.id === serverFilter;
  const visibleQueue = queue.filter(serverMatches);
  const visibleReady = ready.filter(serverMatches);
  const visibleArchive = archive.filter(serverMatches).filter((group) => statusFilter.some((status) => status === 'completed' ? group.status === 'issued' || group.status === 'completed' : group.status === status));
  const visibleReissue = reissue.filter(serverMatches).filter((group) => statusFilter.some((status) => status === 'completed' ? group.status === 'issued' || group.status === 'completed' : group.status === status));
  const countGroups = panel === 'queue' ? queue : panel === 'ready' ? ready : panel === 'reissue' ? reissue : archive;
  return <section className="workspace manager-workspace"><div className="page-heading manager-heading"><div><p className="eyebrow">{role === 'super_admin' ? '超级管理' : '管理工作台'}</p><h1>{panel === 'users' ? '账号管理' : panel === 'archive' ? '常规操作记录' : panel === 'reissue' ? '物资发放记录' : panel === 'ready' ? '待完成' : '待审核'}</h1></div>{panel !== 'users' && <div className="manager-metrics"><div><span>待审核</span><strong>{pendingCount}</strong></div><div><span>待完成</span><strong>{approvedCount}</strong></div><div><span>已完成</span><strong>{issuedCount}</strong></div></div>}</div>
    {panel !== 'users' && <div className="manager-toolbar"><div className="filter-row"><ServerFilters options={options} value={serverFilter} onChange={setServerFilter} counts={Object.fromEntries(options.servers.map((server) => [server.id, countGroups.filter((group) => group.server.id === server.id).length]))} />{(panel === 'archive' || panel === 'reissue') && <StatusFilters value={statusFilter} onChange={setStatusFilter} />}<button type="button" className="icon-button refresh-button" title="刷新" aria-label="刷新" onClick={() => void load()}><RefreshCw size={16} /></button></div></div>}
    {panel === 'users' ? <UserAdminView token={token} actorRole={role} actorId={actorId} onRequireRelogin={onRequireRelogin} /> : loading ? <div className="empty-state"><LoaderCircle className="spin" size={24} /></div> : <><RequestList panel={panel} groups={panel === 'queue' ? visibleQueue : panel === 'ready' ? visibleReady : panel === 'reissue' ? visibleReissue : visibleArchive} options={options} role={role} onAction={mutate} copiedCommands={copiedCommands} onCommandCopied={markCommandCopied} onCopyNotice={notifyCommandCopied} />{error && <FloatingNotice kind="error" text={error} onDismiss={() => setError('')} actionLabel="重试" onAction={() => void load()} />}{notice && <FloatingNotice kind={notice.kind} text={notice.text} onDismiss={() => setNotice(null)} />}</>}
    {panel !== 'users' && !loading && (panel === 'queue' ? queueCursor : panel === 'ready' ? readyCursor : panel === 'reissue' ? reissueCursor : archiveCursor) && <button type="button" className="load-more" disabled={loading} onClick={() => void loadMore()}>加载更多</button>}
    {rejectTarget && <TextPromptDialog title="填写驳回原因" description="原因会保存在申请审计记录中，留空也可以直接驳回。" label="驳回原因（可选）" placeholder="输入原因" inputType="text" submitLabel="确认驳回" busy={rejectSaving} onCancel={() => setRejectTarget(null)} onSubmit={(value) => void reject(value)} />}
    {actionConfirm && <ConfirmDialog title={actionConfirm.action === 'approve' ? '确认通过申请？' : '确认已完成？'} description={actionConfirm.action === 'approve' ? '通过后申请会进入待完成队列。' : '确认后申请将标记为已完成。'} confirmLabel={actionConfirm.action === 'approve' ? '确认通过' : '确认完成'} busy={actionSaving} onCancel={() => setActionConfirm(null)} onConfirm={() => void confirmAction()} />}
  </section>;
}

function ServerFilters({ options, value, onChange, counts }: { options: AppOptions; value: string; onChange: (value: string) => void; counts?: Record<string, number> }) {
  const allCount = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0;
  return <div className="filter-choice-group server-filter-group" role="group" aria-label="筛选服务器"><span className="filter-choice-label"><Filter size={14} />服务器</span><button type="button" className={!value ? 'filter-choice selected' : 'filter-choice'} onClick={() => onChange('')}>全部{allCount > 0 ? ` ${allCount}` : ''}</button>{options.servers.map((server) => <button type="button" className={value === server.id ? 'filter-choice selected' : 'filter-choice'} key={server.id} onClick={() => onChange(server.id)}>{server.displayName}{counts?.[server.id] ? ` ${counts[server.id]}` : ''}</button>)}</div>;
}

function StatusFilters({ value, onChange }: { value: FilterStatus[]; onChange: (value: FilterStatus[]) => void }) {
  const toggle = (status: FilterStatus) => onChange(value.includes(status) ? value.filter((item) => item !== status) : [...value, status]);
  return <div className="filter-choice-group status-filter-group" role="group" aria-label="筛选状态"><span className="filter-choice-label"><Layers3 size={14} />状态</span><button type="button" className={value.length === statusEntries.length ? 'filter-choice selected' : 'filter-choice'} onClick={() => onChange(statusEntries.map(([status]) => status))}>全部</button>{statusEntries.map(([status, label]) => <button type="button" className={`filter-choice status-filter-choice status-filter-${status} ${value.includes(status) ? 'selected' : ''}`} key={status} onClick={() => toggle(status)}>{label}</button>)}</div>;
}

function RequestList({ panel, groups, options, role, onAction, copiedCommands, onCommandCopied, onCopyNotice }: { panel: 'queue' | 'ready' | 'archive' | 'reissue'; groups: ManagerGroup[]; options: AppOptions; role: Role; onAction: (action: 'approve' | 'reject' | 'issue' | 'complete', group: ManagerGroup) => void; copiedCommands: Set<string>; onCommandCopied: (groupId: string, command: GeneratedCommand) => void; onCopyNotice: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useEffect(() => setExpandedId(null), [panel]);
  if (!groups.length) return <div className="empty-state"><div className="empty-icon"><Check size={22} /></div><h3>{panel === 'queue' ? '审核队列已清空' : panel === 'ready' ? '暂无待完成申请' : panel === 'reissue' ? '暂无物资发放记录' : '暂无常规操作记录'}</h3><p>{panel === 'queue' ? '新的客服申请会出现在这里' : panel === 'ready' ? '管理通过后，申请会出现在这里' : '可调整筛选条件查看历史'}</p></div>;
  const map = new Map([['all', groups]]);
  let sequence = 0;
  const commandMode = panel === 'ready' && role === 'super_admin';
  const actor = panel === 'ready' ? 'reviewer' : undefined;
  const isReissueTable = panel === 'reissue' || panel === 'queue';
  return <div className="manager-groups">{[...map.entries()].map(([key, items]) => { const start = sequence; sequence += items.length; return <div className="server-section" key={key}><div className="record-table-shell manager-record-table" role="table" aria-label={panel === 'ready' ? '待完成申请列表' : panel === 'reissue' || panel === 'queue' ? '物资申请列表' : '申请列表'}><RecordTableHeader commandMode={commandMode} actor={actor} isReissue={isReissueTable} /><div className="record-table-body" role="rowgroup">{items.map((group, index) => <RequestCard key={group.id} index={start + index + 1} panel={commandMode ? 'ready' : panel} group={group} options={options} role={role} expanded={expandedId === group.id} onToggle={() => setExpandedId((current) => current === group.id ? null : group.id)} onAction={onAction} copiedCommands={copiedCommands} onCommandCopied={onCommandCopied} onCopyNotice={onCopyNotice} />)}</div></div></div>; })}</div>;
}
function RequestCard({ index, panel, group, options, role, expanded, onToggle, onAction, copiedCommands, onCommandCopied, onCopyNotice }: { index: number; panel: 'queue' | 'ready' | 'archive' | 'reissue'; group: ManagerGroup; options: AppOptions; role: Role; expanded: boolean; onToggle: () => void; onAction: (action: 'approve' | 'reject' | 'issue' | 'complete', group: ManagerGroup) => void; copiedCommands: Set<string>; onCommandCopied: (groupId: string, command: GeneratedCommand) => void; onCopyNotice: () => void }) {
  const kind = recordType(group);
  const reason = reasonLabel(options, group);
  const commandMode = panel === 'ready' && role === 'super_admin';
  const displayCommands = commandMode ? orderedCommands(group) : group.commands;
  const firstCommandObject = displayCommands[0];
  const firstCommand = firstCommandObject?.text;
  const allCommandsCopied = displayCommands.length > 0 && displayCommands.every((command) => copiedCommands.has(commandKey(group.id, command)));
  const issuance = isIssuanceGroup(group);
  const expandable = issuance || panel === 'archive' || panel === 'reissue';
  const canReview = panel === 'queue' && group.status === 'pending';
  const canIssue = panel === 'ready' && group.status === 'approved' && role === 'super_admin';
  const canComplete = panel === 'archive' && group.status === 'approved' && !issuance;
  const isReissuePanel = panel === 'reissue' || panel === 'queue';
  return <article className={`manager-card record-card manager-record status-card-${group.status} ${expanded ? 'is-expanded' : ''}`}>
      <div className={`record-table-row ${isReissuePanel ? 'record-table-reissue' : panel === 'ready' ? 'record-table-with-reviewer' : 'record-table-without-actor'} ${expandable ? 'is-expandable' : ''}`} role="row" tabIndex={expandable ? 0 : undefined} aria-expanded={expandable ? expanded : undefined} onClick={expandable ? onToggle : undefined} onKeyDown={expandable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); } } : undefined}>
      <span className="record-index" role="cell" aria-label={`第 ${index} 条`}>{String(index).padStart(2, '0')}</span>
      <div className="record-cell record-server" data-label="服务器" role="cell"><strong>{group.server.displayName}</strong></div>
      {isReissuePanel && <div className="record-cell record-account" data-label="游戏账号" role="cell"><span>{group.account || '--'}</span></div>}
      {isReissuePanel && <div className="record-cell record-qq" data-label="玩家 QQ" role="cell"><span>{group.playerQQ || '--'}</span></div>}
      <div className="record-cell record-character" data-label="角色 ID" role="cell"><code>{group.characterId}</code></div>
      <div className="record-cell record-type-cell" data-label="类型" role="cell"><span className={`record-type record-type-${kind.key}`}>{kind.label}</span></div>
      <div className={`record-cell record-reason ${commandMode ? 'record-command-preview' : ''}`} data-label={commandMode ? '指令' : '理由'} role="cell" title={commandMode ? firstCommand : reason}>
        {commandMode ? firstCommandObject ? <><code>{firstCommandObject.text}</code><span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><CopyButton text={firstCommandObject.text} label="复制指令" showCopiedState={false} onCopied={onCopyNotice} /></span>{group.commands.length > 1 && <em className="record-plus">+{group.commands.length - 1}</em>}{allCommandsCopied && <Check className="record-command-check" size={15} aria-label="全部指令已复制" />}</> : '--' : <span>{reason}{group.rejectionReason ? ` · ${group.rejectionReason}` : ''}</span>}
      </div>
      {panel === 'ready' && <div className="record-cell record-actor" data-label="审核员" role="cell">{group.approvedBy?.displayName || '--'}</div>}
      <time className="record-time" data-label="提交时间" role="cell" dateTime={group.submittedAt}>{formatRecordTime(group.submittedAt)}</time>
      <div className="record-status-cell" data-label="状态" role="cell"><StatusBadge status={group.status} /></div>
      <div className="record-operation" data-label="操作" role="cell" onKeyDown={(event) => event.stopPropagation()}>{canReview && <><button type="button" className="record-action-button danger" onClick={(event) => { event.stopPropagation(); onAction('reject', group); }}><X size={13} />驳回</button><button type="button" className="record-action-button primary" onClick={(event) => { event.stopPropagation(); onAction('approve', group); }}><Check size={13} />通过</button></>}{canIssue && <button type="button" className="record-action-button primary" onClick={(event) => { event.stopPropagation(); onAction('issue', group); }}><PackageCheck size={14} />确认完成</button>}{canComplete && <button type="button" className="record-action-button primary" onClick={(event) => { event.stopPropagation(); onAction('complete', group); }}><Check size={14} />确认完成</button>}{expandable && <button type="button" className="record-action-button record-expand-button" title={expanded ? '收起详情' : '展开详情'} aria-label={expanded ? '收起详情' : '展开详情'} onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>}</div>
    </div>
    {expanded && <div className="record-card-content">
      {panel === 'archive' ? <WorkflowTimeline group={group} /> : panel === 'reissue' ? <><WorkflowTimeline group={group} /><IssuanceItemsDisplay group={group} /></> : panel === 'queue' ? <IssuanceItemsDisplay group={group} /> : commandMode ? <CommandDetails group={group} commands={displayCommands} copiedCommands={copiedCommands} onCommandCopied={onCommandCopied} /> : <>
        <IssuanceDetails group={group} />
        <div className="reason-detail"><span>申请理由</span><strong>{reason}{group.rejectionReason ? ` · ${group.rejectionReason}` : ''}</strong></div>
      </>}
    </div>}
  </article>;
}

function orderedCommands(group: ManagerGroup) {
  return group.commands
    .map((command, index) => ({ command, index }))
    .sort((left, right) => {
      const leftIsCash = group.operations[left.command.operationIndex]?.type === 'cash';
      const rightIsCash = group.operations[right.command.operationIndex]?.type === 'cash';
      return Number(rightIsCash) - Number(leftIsCash)
        || left.command.operationIndex - right.command.operationIndex
        || left.command.sequence - right.command.sequence
        || left.index - right.index;
    })
    .map(({ command }) => command);
}

function CommandDetails({ group, commands, copiedCommands, onCommandCopied }: { group: ManagerGroup; commands: GeneratedCommand[]; copiedCommands: Set<string>; onCommandCopied: (groupId: string, command: GeneratedCommand) => void }) {
  return <div className="command-list">{commands.map((command) => <CommandRow command={command} copied={copiedCommands.has(commandKey(group.id, command))} onCopied={() => onCommandCopied(group.id, command)} key={`${command.operationIndex}-${command.sequence}`} />)}</div>;
}

function CommandRow({ command, copied, onCopied }: { command: GeneratedCommand; copied: boolean; onCopied: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command.text);
      onCopied();
    } catch { /* Clipboard permission denied; keep the unmarked state. */ }
  };
  return <button type="button" className={`command-row ${copied ? 'is-copied' : ''}`} title="点击复制指令" aria-label={`复制指令: ${command.text}`} onClick={() => void copy()}><code>{command.text}</code><Copy className="command-copy-icon" size={15} /></button>;
}
