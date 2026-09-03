import type { OperationGroup } from '../../../shared/types.js';

export function isIssuanceGroup(group: Pick<OperationGroup, 'operations'>) {
  return group.operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
}

export function isNoReviewGroup(group: Pick<OperationGroup, 'operations'>) {
  return group.operations.length > 0 && group.operations.every((operation) => operation.type === 'kick' || operation.type === 'ban');
}

export function canCustomerModify(group: OperationGroup) {
  return group.status === 'pending' || group.status === 'approved' || group.status === 'rejected';
}
