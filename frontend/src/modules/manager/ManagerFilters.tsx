import { Filter, Layers3 } from 'lucide-react';
import type { AppOptions } from '../../types';

export function ServerFilters({ options, value, onChange, counts, dropdown = false }: { options: AppOptions; value: string; onChange: (value: string) => void; counts?: Record<string, number>; dropdown?: boolean }) {
  const allCount = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0;
  if (dropdown) return <label className="server-filter-select"><span className="filter-choice-label"><Filter size={14} />服务器</span><select aria-label="筛选服务器" value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部服务器{allCount > 0 ? ` (${allCount})` : ''}</option>{options.servers.map((server) => <option value={server.id} key={server.id}>{server.displayName}{counts?.[server.id] ? ` (${counts[server.id]})` : ''}</option>)}</select></label>;
  return <div className="filter-choice-group server-filter-group" role="group" aria-label="筛选服务器"><span className="filter-choice-label"><Filter size={14} />服务器</span><button type="button" className={!value ? 'filter-choice selected' : 'filter-choice'} onClick={() => onChange('')}>全部{allCount > 0 ? ` ${allCount}` : ''}</button>{options.servers.map((server) => <button type="button" className={value === server.id ? 'filter-choice selected' : 'filter-choice'} key={server.id} onClick={() => onChange(server.id)}>{server.displayName}{counts?.[server.id] ? ` ${counts[server.id]}` : ''}</button>)}</div>;
}

export function StatusFilters({ value, onChange }: { value: FilterStatus[]; onChange: (value: FilterStatus[]) => void }) {
  const toggle = (status: FilterStatus) => onChange(value.includes(status) ? value.filter((item) => item !== status) : [...value, status]);
  return <div className="filter-choice-group status-filter-group" role="group" aria-label="筛选状态"><span className="filter-choice-label"><Layers3 size={14} />状态</span><button type="button" className={value.length === statusEntries.length ? 'filter-choice selected' : 'filter-choice'} onClick={() => onChange(statusEntries.map(([status]) => status))}>全部</button>{statusEntries.map(([status, label]) => <button type="button" className={`filter-choice status-filter-choice status-filter-${status} ${value.includes(status) ? 'selected' : ''}`} key={status} onClick={() => toggle(status)}>{label}</button>)}</div>;
}

export type FilterStatus = 'pending' | 'approved' | 'completed' | 'rejected' | 'cancelled';
const statusEntries: Array<[FilterStatus, string]> = [['pending', '待审核'], ['approved', '待完成'], ['completed', '已完成'], ['rejected', '已驳回'], ['cancelled', '已取消']];
