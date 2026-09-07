import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { TeamApplication } from '../api/types';
import { formatTargetDay } from '../config/day';
import { bossName } from '../config/player-config';
import './application-history.css';

export function ApplicationHistory({ items, loading = false }: { items: TeamApplication[]; loading?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 6);
  return (
    <section className="application-records" aria-labelledby="application-records-title">
      <div className="application-records-heading"><h2 id="application-records-title">入队申请记录</h2><small>最近 {items.length} 条</small></div>
      <div id="application-records-list" aria-live="polite" aria-busy={loading}>
        {loading ? <p className="application-records-empty">正在加载申请记录…</p> : !items.length ? <p className="application-records-empty">暂无入队申请记录</p> : visible.map((item) => (
          <div className="application-record" key={item.requestId}>
            <div><strong>{bossName(item.bossType)}</strong><span>角色 ID {item.characterId}</span><small>{formatTargetDay(item.day)} · 队伍 {item.inviteCode}</small></div>
            <span className={`application-status ${item.status}`}>{applicationStatus(item)}</span>
          </div>
        ))}
      </div>
      {!loading && items.length > 6 && <button type="button" className="application-records-toggle" aria-expanded={expanded} aria-controls="application-records-list" onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{expanded ? '收起记录' : `查看全部 ${items.length} 条`}</button>}
    </section>
  );
}

function applicationStatus(item: TeamApplication) {
  if (item.reason === 'joined-other-team') return '已加入其他队伍 · 申请自动关闭';
  if (item.reason === 'left-team') return '已退出队伍';
  if (item.reason === 'team-merged') return '队伍已合并';
  if (item.reason === 'leader-rejected') return '队长已拒绝';
  return item.status === 'approved' ? '已同意' : item.status === 'pending' ? '待队长' : '未通过';
}
