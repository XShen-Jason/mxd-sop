import { randomUUID } from 'node:crypto';
import type { Identity, OperationGroup } from '../../../shared/types.js';
import { GroupError } from './errors.js';

export function clearReminder(group: OperationGroup) {
  delete group.reminderCount;
  delete group.lastRemindedAt;
  delete group.lastRemindedBy;
  delete group.automationFailureReason;
}

export function changeReminder(group: OperationGroup, identity: Identity, now: Date, action: 'remind' | 'online' | 'verify-offline') {
  if (action === 'online' && group.submittedBy.id !== identity.id) throw new GroupError('forbidden');
  if (group.status !== 'approved') throw new GroupError('invalid-status-transition');
  if (action === 'online') {
    if (!(group.reminderCount && group.reminderCount > 0)) return false;
    clearReminder(group);
  } else {
    if (action === 'verify-offline') {
      group.automationOfflineVerificationId ??= randomUUID();
      group.executionNote = '已核实玩家不在线';
    }
    group.reminderCount = (group.reminderCount ?? 0) + 1;
    group.lastRemindedAt = now.toISOString();
    group.lastRemindedBy = { id: identity.id, displayName: identity.displayName };
  }
  return true;
}
