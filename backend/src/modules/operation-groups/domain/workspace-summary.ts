import type { GroupRepository } from '../infrastructure/json-store.js';
import { compareDesc, compareText, decodeCursor, encodeCursor } from './helpers.js';
import { GroupError } from './errors.js';

type ResolveDisplayName = (id: string) => string | undefined;

export function readWorkspaceCounts(repository: GroupRepository, ownerId: string) {
  if (repository.workspaceCounts) {
    const counts = repository.workspaceCounts(ownerId);
    return {
      ...counts,
      reminderIssuance: counts.reminderIssuance ?? 0,
      reminderRegular: counts.reminderRegular ?? 0,
      ownIssuance: counts.ownIssuance ?? 0,
      ownRegular: counts.ownRegular ?? 0
    };
  }
  return repository.all().reduce((counts, group) => {
    if (group.status === 'pending') counts.pending += 1;
    if (group.status === 'approved') counts.approved += 1;
    if (group.submittedBy.id === ownerId) {
      const issuance = group.operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
      if (issuance) counts.ownIssuance += 1;
      else counts.ownRegular += 1;
      if (group.status === 'approved' && group.reminderCount && group.reminderCount > 0) {
        counts.reminders += 1;
        if (issuance) counts.reminderIssuance += 1;
        else counts.reminderRegular += 1;
      }
    }
    return counts;
  }, { pending: 0, approved: 0, reminders: 0, reminderIssuance: 0, reminderRegular: 0, ownIssuance: 0, ownRegular: 0 });
}

export function readOverview(repository: GroupRepository, limit: number, cursor: string | undefined, resolveDisplayName?: ResolveDisplayName) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new GroupError('invalid-input', 'invalid limit');
  const byCustomer = new Map<string, { customer: { id: string; displayName: string }; total: number; pending: number; approved: number; rejected: number; issued: number; cancelled: number }>();
  for (const group of repository.all().sort(compareDesc)) {
    const key = group.submittedBy.id;
    const customer = { ...group.submittedBy, displayName: resolveDisplayName?.(key) ?? group.submittedBy.displayName };
    const item = byCustomer.get(key) ?? { customer, total: 0, pending: 0, approved: 0, rejected: 0, issued: 0, cancelled: 0 };
    item.total += 1;
    if (group.status === 'pending') item.pending += 1;
    if (group.status === 'approved') item.approved += 1;
    if (group.status === 'rejected') item.rejected += 1;
    if (group.status === 'issued' || group.status === 'completed') item.issued += 1;
    if (group.status === 'cancelled') item.cancelled += 1;
    byCustomer.set(key, item);
  }
  const values = [...byCustomer.values()].sort((a, b) => compareText(a.customer.id, b.customer.id));
  const offset = decodeCursor(cursor);
  const page = values.slice(offset, offset + limit);
  return { customers: page, nextCursor: offset + page.length < values.length ? encodeCursor(offset + page.length) : null };
}
