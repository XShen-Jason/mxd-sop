import { FileSearch, MoveUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuditEntry, ServerRecord } from '../../api/types';
import { logOutcome, logSource, logSummary, prettyJSON, requestPayload, responsePayload } from './logPresentation';

export function RequestLogs({ server, accountId, logs, loading }: { server?: ServerRecord; accountId: string | null; logs: AuditEntry[]; loading: boolean }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = logs.find((entry) => entry.id === selectedId);
  useEffect(() => { if (!logs.length) setSelectedId(undefined); else if (!selectedId || !logs.some((entry) => entry.id === selectedId)) setSelectedId(logs[0].id); }, [logs, selectedId]);
  if (!server || !accountId) return <section className="logs-empty"><FileSearch size={34} /><h2>{loading ? '正在读取账号…' : '选择一个账号'}</h2><p>点击左侧服务器下的具体账号后，这里才会展示对应请求日志。</p></section>;
  const account = server.accounts.find((item) => item.id === accountId);
  return <>
    <section className="log-list-pane" aria-label={`${server.name} · ${account?.username || accountId} 请求记录`}>
      <div className="log-list-heading"><strong>请求记录</strong><span>{logs.length} 条</span></div>
      <div className="log-list" role="list">{logs.map((entry) => <LogRow key={entry.id} entry={entry} selected={entry.id === selectedId} onSelect={setSelectedId} />)}{!logs.length && <div className="log-list-empty"><FileSearch size={24} /><strong>暂时没有请求</strong><span>新请求会在这里自动出现。</span></div>}</div>
    </section>
    <LogDetail entry={selected} />
  </>;
}

function LogRow({ entry, selected, onSelect }: { entry: AuditEntry; selected: boolean; onSelect: (id: string) => void }) {
  const outcome = logOutcome(entry);
  return <button type="button" className={`log-row${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(entry.id)}><div className="log-row-top"><time>{formatTime(entry.created_at)}</time><span className={`source-chip ${entry.method === 'TCP' ? 'tcp' : 'http'}`}>{logSource(entry)}</span><span className={`outcome outcome-${outcome.tone}`}>{outcome.label}</span><code>{entry.duration_ms} ms</code></div><strong>{logSummary(entry)}<MoveUpRight size={13} /></strong></button>;
}

function LogDetail({ entry }: { entry?: AuditEntry }) {
  if (!entry) return <aside className="log-detail-pane log-detail-empty"><FileSearch size={28} /><strong>选择一条请求查看详情</strong><span>请求和返回结果会固定显示在这里。</span></aside>;
  const outcome = logOutcome(entry);
  return <aside className="log-detail-pane"><div className="detail-heading"><div><span>{logSource(entry)}</span><h2>{logSummary(entry)}</h2></div><span className={`outcome outcome-${outcome.tone}`}>{outcome.label}</span></div><dl className="trace-meta"><div><dt>请求时间</dt><dd>{formatDateTime(entry.created_at)}</dd></div><div><dt>状态码</dt><dd>{entry.status}</dd></div><div><dt>耗时</dt><dd>{entry.duration_ms} ms</dd></div><div><dt>账号</dt><dd>{entry.detail?.account || entry.actor || '—'}</dd></div></dl><TraceBlock title="完整请求" value={requestPayload(entry)} truncated={entry.detail?.request_body_truncated} /><TraceBlock title="完整返回" value={responsePayload(entry)} truncated={entry.detail?.response_body_truncated} /></aside>;
}

function TraceBlock({ title, value, truncated }: { title: string; value: unknown; truncated?: boolean }) { return <section className="trace-block"><header><strong>{title}</strong>{truncated && <span>内容已按安全上限截断</span>}</header><pre>{prettyJSON(value)}</pre></section>; }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)); }
