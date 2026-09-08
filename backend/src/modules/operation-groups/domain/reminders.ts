import type { Identity, OperationGroup } from '../../../shared/types.js';
import { GroupError } from './errors.js';

export function clearReminder(group: OperationGroup) {
  delete group.reminderCount;
  delete group.lastRemindedAt;
  delete group.lastRemindedBy;
}

export function changeReminder(group: OperationGroup, identity: Identity, now: Date, action: 'remind' | 'online') {
  if (action === 'remind' ? identity.role !== 'super_admin' : group.submittedBy.id !== identity.id) throw new GroupError('forbidden');
  if (group.status !== 'approved') throw new GroupError('invalid-status-transition');
  if (action === 'online') {
    if (!(group.reminderCount && group.reminderCount > 0)) return false;
    clearReminder(group);
  } else {
    group.reminderCount = (group.reminderCount ?? 0) + 1;
    group.lastRemindedAt = now.toISOString();
    group.lastRemindedBy = { id: identity.id, displayName: identity.displayName };
  }
  return true;
}
