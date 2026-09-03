import type { GroupPageQuery, GroupRepository } from '../infrastructure/json-store.js';
import { compareAsc, compareDesc, decodePageCursor, encodePageCursor } from './helpers.js';
import { GroupError } from './errors.js';

export function readGroupPage(repository: GroupRepository, query: Omit<GroupPageQuery, 'after'>, cursor?: string) {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new GroupError('invalid-input', 'invalid limit');
  const fullQuery = { ...query, after: decodePageCursor(cursor) };
  const groups = repository.listPage ? repository.listPage(fullQuery) : fallbackList(repository, fullQuery);
  const hasMore = groups.length > query.limit;
  const page = hasMore ? groups.slice(0, query.limit) : groups;
  const last = page.at(-1);
  return { groups: page, nextCursor: hasMore && last ? encodePageCursor({ submittedAt: last.submittedAt, id: last.id, serverId: last.server.id }) : null };
}

function fallbackList(repository: GroupRepository, query: GroupPageQuery) {
  const order = new Map((query.serverOrder ?? []).map((id, index) => [id, index]));
  const groups = repository.all().filter((group) => {
    if (query.ownerId && group.submittedBy.id !== query.ownerId) return false;
    if (query.reminded && !(group.reminderCount && group.reminderCount > 0)) return false;
    if (query.status && (Array.isArray(query.status) ? !query.status.includes(group.status) : group.status !== query.status)) return false;
    if (query.serverId && group.server.id !== query.serverId) return false;
    if (query.kind) {
      const issuance = group.operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
      if ((query.kind === 'issuance') !== issuance) return false;
    }
    return true;
  }).sort((a, b) => {
    if (query.serverOrder?.length) {
      const byServer = (order.get(a.server.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.server.id) ?? Number.MAX_SAFE_INTEGER);
      if (byServer) return byServer;
    }
    return query.order === 'asc' ? compareAsc(a, b) : compareDesc(a, b);
  });
  if (!query.after) return groups.slice(0, query.limit + 1);
  const index = groups.findIndex((group) => group.submittedAt === query.after!.submittedAt && group.id === query.after!.id);
  const start = index < 0 ? 0 : index + 1;
  return groups.slice(start, start + query.limit + 1);
}
