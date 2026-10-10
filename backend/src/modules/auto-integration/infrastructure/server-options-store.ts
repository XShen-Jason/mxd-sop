import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { ServerOption } from '../../../shared/types.js';
import type { ServerOptionsRepository } from '../domain/server-options.js';

export class SqliteServerOptionsRepository implements ServerOptionsRepository {
  constructor(private readonly db: SqliteDatabase) {}
  get(): ServerOption[] {
    const row = this.db.prepare('SELECT payload_json FROM auto_server_options WHERE id = 1').get() as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as ServerOption[] : [];
  }
  save(servers: ServerOption[]) {
    this.db.prepare(`INSERT INTO auto_server_options (id, payload_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json`).run(JSON.stringify(servers));
  }
}
