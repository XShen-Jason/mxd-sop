import { ChevronDown, ChevronUp, LoaderCircle, UserCheck } from 'lucide-react';
import { StatusBadge } from '../../components/StatusBadge';
import { formatRecordTime, isIssuanceGroup, IssuanceItemsDisplay, recordType, reasonLabel } from '../operation-groups/RecordPresentation';
import type { AppOptions, Group } from '../../types';

type Props = {
  index: number; group: Group; options: AppOptions; expanded: boolean;
  onToggle: () => void; onEdit: (group: Group) => void; onCancel: (id: string) => void;
  onOnline?: (id: string) => void; onlineSavingId?: string | null;
};

export function OwnRecordCard({ index, group, options, expanded, onToggle, onEdit, onCancel, onOnline, onlineSavingId }: Props) {
  const kind = recordType(group);
  const reason = reasonLabel(options, group);
  const isIssuance = isIssuanceGroup(group);
  const canModify = ['pending', 'approved', 'rejected'].includes(group.status);
  const canMarkOnline = onOnline && group.status === 'approved' && (group.reminderCount ?? 0) > 0;
  return <article className={`group-card record-card status-card-${group.status} ${expanded ? 'is-expanded' : ''}`}>
    <div className={`record-table-row ${isIssuance ? 'record-table-reissue' : 'record-table-without-actor'} ${isIssuance ? 'is-expandable' : ''}`}
      role="row" tabIndex={isIssuance ? 0 : undefined} aria-expanded={isIssuance ? expanded : undefined}
      onClick={isIssuance ? onToggle : undefined} onKeyDown={isIssuance ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(); }
      } : undefined}>
      <span className="record-index" role="cell" aria-label={`第 ${index} 条`}>{String(index).padStart(2, '0')}</span>
      <div className="record-cell record-server" data-label="服务器" role="cell"><strong>{group.server.displayName}</strong></div>
      {isIssuance && <div className="record-cell record-account" data-label="游戏账号" role="cell"><span>{group.account || '--'}</span></div>}
      {isIssuance && <div className="record-cell record-qq" data-label="玩家 QQ" role="cell"><span>{group.playerQQ || '--'}</span></div>}
      <div className="record-cell record-character" data-label="角色 ID" role="cell"><code>{group.characterId}</code></div>
      <div className="record-cell record-type-cell" data-label="类型" role="cell"><span className={`record-type record-type-${kind.key}`}>{kind.label}</span></div>
      <div className="record-cell record-reason" data-label="理由" role="cell" title={reason}>{reason}{group.rejectionReason ? ` · ${group.rejectionReason}` : ''}</div>
      <time className="record-time" data-label="提交时间" role="cell" dateTime={group.submittedAt}>{formatRecordTime(group.submittedAt)}</time>
      <div className="record-status-cell" data-label="状态" role="cell"><StatusBadge status={group.status} /></div>
      <div className="record-operation" data-label="操作" role="cell" onKeyDown={(event) => event.stopPropagation()}>
        {canMarkOnline && <button type="button" className="record-action-button primary record-online-button" disabled={!!onlineSavingId}
          aria-busy={onlineSavingId === group.id} onClick={(event) => { event.stopPropagation(); onOnline(group.id); }}>
          {onlineSavingId === group.id ? <LoaderCircle size={14} className="spin" /> : <UserCheck size={14} />}用户已上线
        </button>}
        {canModify && <>
          <button type="button" className="record-action-button" onClick={(event) => { event.stopPropagation(); onEdit(group); }}>修改</button>
          <button type="button" className="record-action-button danger" onClick={(event) => { event.stopPropagation(); onCancel(group.id); }}>取消</button>
        </>}
        {isIssuance && <button type="button" className="record-action-button record-expand-button" title={expanded ? '收起详情' : '展开详情'}
          aria-label={expanded ? '收起详情' : '展开详情'} onClick={(event) => { event.stopPropagation(); onToggle(); }}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>}
      </div>
    </div>
    {expanded && isIssuance && <div className="record-card-content"><IssuanceItemsDisplay group={group} /></div>}
  </article>;
}
