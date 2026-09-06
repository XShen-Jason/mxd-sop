import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { PlayerIntegrationRepository, PlayerIntegrationState } from '../domain/types.js';

export class SqlitePlayerIntegrationRepository implements PlayerIntegrationRepository {
  constructor(private readonly db: SqliteDatabase) {}
  get() {
    const row = this.db.prepare('SELECT mode, updated_at AS updatedAt, updated_by_id AS updatedById, updated_by_name AS updatedByName FROM player_integration_state WHERE id = 1').get() as { mode: 'local' | 'remote'; updatedAt: string; updatedById?: string; updatedByName?: string } | undefined;
    return row ? { mode: row.mode, updatedAt: row.updatedAt, ...(row.updatedById && row.updatedByName ? { updatedBy: { id: row.updatedById, displayName: row.updatedByName } } : {}) } : null;
  }
  save(state: PlayerIntegrationState) {
    this.db.prepare(`INSERT INTO player_integration_state (id, mode, updated_at, updated_by_id, updated_by_name) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode, updated_at=excluded.updated_at, updated_by_id=excluded.updated_by_id, updated_by_name=excluded.updated_by_name`).run(state.mode, state.updatedAt, state.updatedBy?.id ?? null, state.updatedBy?.displayName ?? null);
  }
}
