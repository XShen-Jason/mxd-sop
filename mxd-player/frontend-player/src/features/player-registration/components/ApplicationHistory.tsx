import type { TeamApplication } from '../api/types';
import { formatTargetDay } from '../config/day';
import { bossName } from '../config/player-config';

export function ApplicationHistory({ items }: { items: TeamApplication[] }) {
  if (!items.length) return null;
  return (
    <details className="application-history">
      <summary><span className="kicker">JOIN HISTORY</span><small>最近 50 条 · 点击展开</small></summary>
      <div className="history-list">
        {items.slice(0, 6).map((item) => (
          <div className="history-row" key={item.requestId}>
            <span><b>{bossName(item.bossType)}</b> · 角色 ID {item.characterId}<small>{formatTargetDay(item.day)}</small></span>
            <em className={`application-status ${item.status}`}>{applicationStatus(item)}</em>
          </div>
        ))}
      </div>
    </details>
  );
}

function applicationStatus(item: TeamApplication) {
  if (item.reason === 'joined-other-team') return '已加入其他队伍 · 申请自动关闭';
  if (item.reason === 'left-team') return '已退出队伍';
  if (item.reason === 'team-merged') return '队伍已合并';
  if (item.reason === 'leader-rejected') return '队长已拒绝';
  return item.status === 'approved' ? '已同意' : item.status === 'pending' ? '待队长' : '未通过';
}
