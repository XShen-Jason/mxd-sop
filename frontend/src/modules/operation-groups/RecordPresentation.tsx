import { Ban, Check, Circle, Clock3, Package, XCircle } from 'lucide-react';
import type { AppOptions, Group } from '../../types';
import { ItemThumbnail } from '../../components/ItemThumbnail';

export function formatRecordTime(value?: string) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function isIssuanceGroup(group: Group) {
  return group.operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
}

export function recordType(group: Group) {
  if (isIssuanceGroup(group)) return { key: 'issue', label: '补发' } as const;
  if (group.operations.some((operation) => operation.type === 'ban')) return { key: 'ban', label: '封禁' } as const;
  return { key: 'kick', label: '拖人' } as const;
}

export function reasonLabel(options: AppOptions, group: Group) {
  const firstType = group.operations[0]?.type;
  const action = firstType === 'ban' ? options.actionReasons?.ban : firstType === 'kick' || firstType === 'warp' ? options.actionReasons?.kick : undefined;
  const allReasons = [...(action ?? []), ...options.reasons, ...(options.actionReasons?.kick ?? []), ...(options.actionReasons?.ban ?? [])];
  return group.reason.text || allReasons.find((reason) => reason.code === group.reason.code)?.displayName || group.reason.code;
}

export type RecordActorColumn = 'submitter' | 'reviewer';

export function RecordTableHeader({ commandMode = false, actor, isReissue = false }: { commandMode?: boolean; actor?: RecordActorColumn; isReissue?: boolean }) {
  return <div className={`record-table-head ${actor ? `record-table-with-${actor}` : isReissue ? 'record-table-reissue' : 'record-table-without-actor'}`} role="row">
    <span role="columnheader" className="record-head-index">序号</span>
    <span role="columnheader">服务器</span>
    {isReissue && <span role="columnheader">游戏账号</span>}
    {isReissue && <span role="columnheader">QQ号</span>}
    <span role="columnheader">角色 ID</span>
    <span role="columnheader">类型</span>
    <span role="columnheader">{commandMode ? '指令' : '理由'}</span>
    {actor && <span role="columnheader">{actor === 'reviewer' ? '审核员' : '提交员'}</span>}
    <span role="columnheader">时间</span>
    <span role="columnheader">状态</span>
    <span role="columnheader" className="record-head-operation">操作</span>
  </div>;
}

type WorkflowState = 'done' | 'current' | 'waiting' | 'rejected' | 'cancelled' | 'skipped';
type WorkflowStep = { key: string; label: string; state: WorkflowState; actor: string; at?: string };

function workflowSteps(group: Group): WorkflowStep[] {
  const issuance = isIssuanceGroup(group);
  const finalLabel = issuance ? '发放' : '执行';
  const waitingLabel = issuance ? '等待发放' : '等待执行';
  const reviewDone = group.status === 'approved' || group.status === 'issued' || group.status === 'completed';
  const finalDone = group.status === 'issued' || group.status === 'completed';
  const reviewStep: WorkflowStep = group.status === 'rejected'
    ? { key: 'review', label: '审核', state: 'rejected', actor: group.rejectedBy?.displayName || '管理', at: group.rejectedAt }
    : group.status === 'cancelled'
      ? { key: 'review', label: '取消', state: 'cancelled', actor: group.cancelledBy?.displayName || '申请人', at: group.cancelledAt }
      : reviewDone
        ? { key: 'review', label: '审核', state: 'done', actor: group.approvedBy?.displayName || group.completedBy?.displayName || '历史记录', at: group.approvedAt || group.completedAt }
        : { key: 'review', label: '审核', state: 'current', actor: '等待审核' };
  const finalStep: WorkflowStep = group.status === 'rejected' || group.status === 'cancelled'
    ? { key: 'final', label: finalLabel, state: 'skipped', actor: '未执行' }
    : finalDone
      ? { key: 'final', label: finalLabel, state: 'done', actor: group.issuedBy?.displayName || group.completedBy?.displayName || '管理', at: group.issuedAt || group.completedAt }
      : { key: 'final', label: finalLabel, state: group.status === 'approved' ? 'current' : 'waiting', actor: waitingLabel };
  return [
    { key: 'submit', label: '提交', state: 'done', actor: group.submittedBy.displayName, at: group.submittedAt },
    reviewStep,
    finalStep
  ];
}

function WorkflowIcon({ state }: { state: WorkflowState }) {
  if (state === 'done') return <Check size={13} strokeWidth={3} />;
  if (state === 'rejected') return <XCircle size={14} />;
  if (state === 'cancelled' || state === 'skipped') return <Ban size={13} />;
  if (state === 'current') return <Clock3 size={14} />;
  return <Circle size={12} />;
}

export function WorkflowTimeline({ group }: { group: Group }) {
  const steps = workflowSteps(group);
  return <section className="workflow-block" aria-label="处理流程">
    <div className="workflow-timeline" role="list">
      {steps.map((step, index) => <div className="workflow-segment" key={step.key}>
        <div className={`workflow-step workflow-${step.state}`} role="listitem">
          <div className="workflow-marker"><WorkflowIcon state={step.state} /></div>
          <div className="workflow-copy"><strong>{step.label}</strong><span>{step.actor}</span>{step.at && <time>{formatRecordTime(step.at)}</time>}</div>
        </div>
        {index < steps.length - 1 && <div className={`workflow-connector workflow-connector-${steps[index + 1].state}`} aria-hidden="true" />}
      </div>)}
    </div>
  </section>;
}

export function IssuanceDetails({ group }: { group: Group }) {
  const operations = group.operations.filter((operation) => operation.type === 'item' || operation.type === 'cash');
  if (!operations.length) return null;
  return <section className="issue-details"><div className="detail-label"><Package size={14} />补发内容</div><div className="issue-target"><span>游戏账号</span><strong>{group.account || '--'}</strong><span>玩家 QQ</span><strong>{group.playerQQ || '--'}</strong></div><div className="issue-detail-list">{operations.map((operation, index) => operation.type === 'item'
    ? <div className="issue-detail-row" key={`${operation.itemCode}-${index}`}><ItemThumbnail src={operation.itemImage} alt={operation.itemName || operation.itemCode} size="medium" /><span className="issue-detail-kind">道具</span><strong>{operation.itemName || operation.itemCode}</strong><code>{operation.itemCode}</code><em>× {operation.quantity}</em></div>
    : <div className="issue-detail-row" key={`cash-${index}`}><ItemThumbnail src={undefined} alt="" size="medium" /><span className="issue-detail-kind cash">点券</span><strong>点券</strong><code>cash</code><em>× {operation.quantity}</em></div>)}</div></section>;
}

export function ReasonDetails({ options, group }: { options: AppOptions; group: Group }) {
  return <div className="reason-detail"><span>申请理由</span><strong>{reasonLabel(options, group)}</strong></div>;
}

export function IssuanceItemsDisplay({ group }: { group: Group }) {
  const operations = group.operations.filter((operation) => operation.type === 'item' || operation.type === 'cash');
  if (!operations.length) return null;
  return <section className="issuance-items-display">
    {operations.map((operation, index) =>
      <div className="issuance-item-card" key={`${operation.type === 'item' ? operation.itemCode : 'cash'}-${index}`}>
        {operation.type === 'item' ? (
          <>
            <ItemThumbnail src={operation.itemImage} alt={operation.itemName || operation.itemCode} size="medium" />
            <div className="item-card-name">{operation.itemName || operation.itemCode}</div>
            <div className="item-card-quantity">× {operation.quantity}</div>
          </>
        ) : (
          <>
            <ItemThumbnail src={undefined} alt="" size="medium" />
            <div className="item-card-name">点券</div>
            <div className="item-card-quantity">× {operation.quantity}</div>
          </>
        )}
      </div>
    )}
  </section>;
}
