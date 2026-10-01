import XLSX from '@e965/xlsx';
import type { ManagerGroupProjection, Operation } from '../../../shared/types.js';

const headers = [
  '服务器', '游戏账号', '玩家 QQ', '角色 ID', '物品代码', '物品名称', '物品类型', '数量', '申请理由',
  '记录状态', '提交时间', '审核时间', '发放时间', '完成时间', '提交人', '审核人', '发放人', '异常提示'
];

const statusLabels: Record<ManagerGroupProjection['status'], string> = {
  pending: '待审核', approved: '待发放', rejected: '已驳回', issued: '已发放', completed: '已完成', cancelled: '已取消'
};

function dateCell(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function operationRows(group: ManagerGroupProjection) {
  return group.operations.filter((operation): operation is Extract<Operation, { type: 'item' | 'cash' }> => operation.type === 'item' || operation.type === 'cash');
}

function anomaly(group: ManagerGroupProjection) {
  const notes: string[] = [];
  if (group.status === 'pending' || group.status === 'approved') notes.push('待处理');
  if (group.rejectionReason) notes.push(`驳回原因：${group.rejectionReason}`);
  if (group.reminderCount) notes.push(`已提醒 ${group.reminderCount} 次`);
  if (group.automationFailureReason) notes.push('自动执行异常');
  if (group.executionNote) notes.push(group.executionNote);
  return notes.join('；');
}

function rowFor(group: ManagerGroupProjection, operation: Extract<Operation, { type: 'item' | 'cash' }>) {
  const item = operation.type === 'item';
  return [
    group.server.displayName, group.account ?? '', group.playerQQ ?? '', group.characterId,
    item ? operation.itemCode : 'cash', item ? operation.itemName : '点券', item ? operation.itemClass ?? '' : 'cash', operation.quantity, group.reason.text || group.reason.code,
    statusLabels[group.status], dateCell(group.submittedAt), dateCell(group.approvedAt), dateCell(group.issuedAt), dateCell(group.completedAt),
    group.submittedBy.displayName, group.approvedBy?.displayName ?? '', group.issuedBy?.displayName ?? '', anomaly(group)
  ];
}

export function issuanceWorkbook(groups: ManagerGroupProjection[]) {
  const rows = groups
    .slice()
    .sort((left, right) => timestamp(right.submittedAt) - timestamp(left.submittedAt) || right.id.localeCompare(left.id))
    .flatMap((group) => operationRows(group).map((operation) => rowFor(group, operation)));
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!autofilter'] = { ref: `A1:R${Math.max(rows.length + 1, 1)}` };
  worksheet['!cols'] = [
    { wch: 13 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 24 }, { wch: 12 }, { wch: 10 },
    { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '物资发放记录');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellDates: true });
}
