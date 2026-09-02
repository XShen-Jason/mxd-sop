import type { OperationGroup } from '../../../shared/types.js';
import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { GroupPageQuery, GroupRepository } from './json-store.js';

type GroupRow = { id: string; submitted_by_id: string; status: string; server_id: string; submitted_at: string; idempotency_key: string | null; request_fingerprint: string | null; payload_json: string };

export class SqliteGroupRepository implements GroupRepository {
  constructor(private readonly db: SqliteDatabase) {}
  all() { return (this.db.prepare('SELECT payload_json FROM operation_groups ORDER BY submitted_at DESC, id DESC').all() as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json) as OperationGroup); }
  findById(id: string) { const row = this.db.prepare('SELECT payload_json FROM operation_groups WHERE id = ?').get(id) as { payload_json: string } | undefined; return row ? JSON.parse(row.payload_json) as OperationGroup : undefined; }
  findByIdempotency(submittedById: string, idempotencyKey: string) {
    const row = this.db.prepare('SELECT payload_json FROM operation_groups WHERE submitted_by_id = ? AND idempotency_key = ? LIMIT 1').get(submittedById, idempotencyKey) as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as OperationGroup : undefined;
  }
  listPage(query: GroupPageQuery) {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (query.ownerId) { clauses.push('submitted_by_id = ?'); values.push(query.ownerId); }
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
      values.push(...statuses);
    }
    if (query.serverId) { clauses.push('server_id = ?'); values.push(query.serverId); }
    if (query.kind === 'issuance') clauses.push("(payload_json LIKE '%\"type\":\"item\"%' OR payload_json LIKE '%\"type\":\"cash\"%')");
    if (query.kind === 'regular') clauses.push("payload_json NOT LIKE '%\"type\":\"item\"%' AND payload_json NOT LIKE '%\"type\":\"cash\"%'");
    if (query.after) {
      if (query.serverOrder?.length && query.after.serverId) {
        const rank = (id: string) => {
          const index = query.serverOrder!.indexOf(id);
          return index < 0 ? Number.MAX_SAFE_INTEGER : index;
        };
        const rankSql = `CASE server_id ${query.serverOrder.map((id, index) => `WHEN '${id.replace(/'/g, "''")}' THEN ${index}`).join(' ')} ELSE ${Number.MAX_SAFE_INTEGER} END`;
        const afterRank = rank(query.after.serverId);
        const tuple = query.order === 'desc' ? '(submitted_at < ? OR (submitted_at = ? AND id < ?))' : '(submitted_at > ? OR (submitted_at = ? AND id > ?))';
        clauses.push(`(${rankSql} > ${afterRank} OR (${rankSql} = ${afterRank} AND ${tuple}))`);
        values.push(query.after.submittedAt, query.after.submittedAt, query.after.id);
      } else {
        clauses.push(query.order === 'desc' ? '(submitted_at < ? OR (submitted_at = ? AND id < ?))' : '(submitted_at > ? OR (submitted_at = ? AND id > ?))');
        values.push(query.after.submittedAt, query.after.submittedAt, query.after.id);
      }
    }
    const direction = query.order === 'desc' ? 'DESC' : 'ASC';
    const serverOrder = query.serverOrder?.length ? `CASE server_id ${query.serverOrder.map((id, index) => `WHEN ? THEN ${index}`).join(' ')} ELSE ${Number.MAX_SAFE_INTEGER} END,` : '';
    if (query.serverOrder?.length) values.push(...query.serverOrder);
    const sql = `SELECT payload_json FROM operation_groups ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${serverOrder} submitted_at ${direction}, id ${direction} LIMIT ?`;
    values.push(query.limit + 1);
    return (this.db.prepare(sql).all(...values) as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json) as OperationGroup);
  }
  insert(group: OperationGroup) { this.db.prepare('INSERT INTO operation_groups (id, submitted_by_id, status, server_id, submitted_at, idempotency_key, request_fingerprint, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(group.id, group.submittedBy.id, group.status, group.server.id, group.submittedAt, group.idempotencyKey ?? null, group.requestFingerprint ?? null, JSON.stringify(group)); }
  replace(group: OperationGroup) { this.db.prepare('UPDATE operation_groups SET submitted_by_id = ?, status = ?, server_id = ?, submitted_at = ?, idempotency_key = ?, request_fingerprint = ?, payload_json = ? WHERE id = ?').run(group.submittedBy.id, group.status, group.server.id, group.submittedAt, group.idempotencyKey ?? null, group.requestFingerprint ?? null, JSON.stringify(group), group.id); }
}
