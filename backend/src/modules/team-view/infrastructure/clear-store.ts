import fs from 'node:fs';
import path from 'node:path';
import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import { clearKey, type TeamClear, type TeamClearRepository } from '../domain/clears.js';

export class SqliteTeamClearRepository implements TeamClearRepository {
  constructor(private readonly db: SqliteDatabase) {}
  get(date: string) {
    return this.db.prepare('SELECT date, server_id AS serverId, boss_type AS bossType, char_id AS characterId FROM team_view_clears WHERE date = ?').all(date) as TeamClear[];
  }
  merge(rows: TeamClear[], importedAt: string) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO team_view_clears (date, server_id, boss_type, char_id, imported_at) VALUES (?, ?, ?, ?, ?)');
    this.db.transaction(() => {
      for (const row of rows) insert.run(row.date, row.serverId, row.bossType, row.characterId, importedAt);
    })();
  }
}

export class JsonTeamClearRepository implements TeamClearRepository {
  private rows: TeamClear[];
  constructor(private readonly filePath: string) {
    this.rows = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) as TeamClear[] : [];
  }
  get(date: string) { return this.rows.filter(row => row.date === date); }
  merge(rows: TeamClear[], _importedAt: string) {
    const next = [...new Map([...this.rows, ...rows].map(row => [clearKey(row), row])).values()];
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next), 'utf8');
    fs.renameSync(temporary, this.filePath);
    this.rows = next;
  }
}
