import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { TeamSnapshot, TeamViewRepository } from '../domain/types.js';

export class SqliteTeamViewRepository implements TeamViewRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(date: string) {
    const row = this.db.prepare('SELECT payload_json AS payload FROM team_view_snapshots WHERE date = ?').get(date) as { payload?: string } | undefined;
    if (!row?.payload) return null;
    try { return JSON.parse(row.payload) as TeamSnapshot; } catch { return null; }
  }

  save(snapshot: TeamSnapshot) {
    this.db.prepare(`INSERT INTO team_view_snapshots (date, fetched_at, source, payload_json)
      VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET fetched_at=excluded.fetched_at, source=excluded.source, payload_json=excluded.payload_json`)
      .run(snapshot.date, snapshot.fetchedAt, snapshot.source, JSON.stringify(snapshot));
  }
}
