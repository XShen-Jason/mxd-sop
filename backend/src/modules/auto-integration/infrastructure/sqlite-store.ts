import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { AutoIntegrationRepository, AutoIntegrationState } from '../domain/types.js';

export class SqliteAutoIntegrationRepository implements AutoIntegrationRepository {
  constructor(private readonly db: SqliteDatabase) {}
  get() {
    const row = this.db.prepare('SELECT enabled, updated_at AS updatedAt, updated_by_id AS updatedById, updated_by_name AS updatedByName FROM auto_integration_state WHERE id = 1').get() as { enabled: number; updatedAt: string; updatedById?: string; updatedByName?: string } | undefined;
    return row ? { enabled: row.enabled === 1, updatedAt: row.updatedAt, ...(row.updatedById && row.updatedByName ? { updatedBy: { id: row.updatedById, displayName: row.updatedByName } } : {}) } : null;
  }
  save(state: AutoIntegrationState) {
    this.db.prepare(`INSERT INTO auto_integration_state (id, enabled, updated_at, updated_by_id, updated_by_name) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at, updated_by_id=excluded.updated_by_id, updated_by_name=excluded.updated_by_name`).run(state.enabled ? 1 : 0, state.updatedAt, state.updatedBy?.id ?? null, state.updatedBy?.displayName ?? null);
  }
}
