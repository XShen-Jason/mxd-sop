import type { OperationGroup } from '../../../shared/types.js';
import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { GroupRepository } from './json-store.js';

type GroupRow = { id: string; submitted_by_id: string; status: string; server_id: string; submitted_at: string; idempotency_key: string | null; request_fingerprint: string | null; payload_json: string };

export class SqliteGroupRepository implements GroupRepository {
  constructor(private readonly db: SqliteDatabase) {}
  all() { return (this.db.prepare('SELECT payload_json FROM operation_groups ORDER BY submitted_at DESC').all() as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json) as OperationGroup); }
  findById(id: string) { const row = this.db.prepare('SELECT payload_json FROM operation_groups WHERE id = ?').get(id) as { payload_json: string } | undefined; return row ? JSON.parse(row.payload_json) as OperationGroup : undefined; }
  insert(group: OperationGroup) { this.db.prepare('INSERT INTO operation_groups (id, submitted_by_id, status, server_id, submitted_at, idempotency_key, request_fingerprint, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(group.id, group.submittedBy.id, group.status, group.server.id, group.submittedAt, group.idempotencyKey ?? null, group.requestFingerprint ?? null, JSON.stringify(group)); }
  replace(group: OperationGroup) { this.db.prepare('UPDATE operation_groups SET submitted_by_id = ?, status = ?, server_id = ?, submitted_at = ?, idempotency_key = ?, request_fingerprint = ?, payload_json = ? WHERE id = ?').run(group.submittedBy.id, group.status, group.server.id, group.submittedAt, group.idempotencyKey ?? null, group.requestFingerprint ?? null, JSON.stringify(group), group.id); }
}
