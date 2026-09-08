import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import { groupRows } from '../domain/search.js';
import type { DirectoryRepository, DirectoryRow } from '../domain/types.js';

type DirectoryGroupRecord = Omit<DirectoryRow, 'charId'> & { charIds: string };

export class SqliteDirectoryRepository implements DirectoryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  replace(rows: DirectoryRow[]) {
    const replace = this.db.transaction((entries: DirectoryRow[]) => {
      this.db.prepare('DELETE FROM player_directory').run();
      const insert = this.db.prepare('INSERT INTO player_directory (server_id, source_file, char_id, user_id, username, bind_qq, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const importedAt = new Date().toISOString();
      for (const row of entries) insert.run(row.serverId, row.sourceFile, row.charId, row.userId, row.username, row.bindQQ, importedAt);
    });
    replace(rows);
  }

  replaceServer(serverId: string, rows: DirectoryRow[]) {
    const replace = this.db.transaction((entries: DirectoryRow[]) => {
      this.db.prepare('DELETE FROM player_directory WHERE server_id = ?').run(serverId);
      const insert = this.db.prepare('INSERT INTO player_directory (server_id, source_file, char_id, user_id, username, bind_qq, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const importedAt = new Date().toISOString();
      for (const row of entries) insert.run(row.serverId, row.sourceFile, row.charId, row.userId, row.username, row.bindQQ, importedAt);
    });
    replace(rows);
  }

  count() { return (this.db.prepare('SELECT COUNT(*) AS count FROM player_directory').get() as { count: number }).count; }

  findCharacters(serverId: string, characterIds: string[]) {
    if (!characterIds.length) return [];
    return this.db.prepare(`SELECT server_id AS serverId, source_file AS sourceFile, char_id AS charId, user_id AS userId, username, bind_qq AS bindQQ FROM player_directory WHERE server_id = ? AND char_id IN (SELECT value FROM json_each(?))`)
      .all(serverId, JSON.stringify(characterIds)) as DirectoryRow[];
  }

  search(input: { query: string; serverId?: string; limit: number; offset: number }) {
    const args: Array<string | number> = [];
    const where: string[] = [];
    if (input.serverId) { where.push('server_id = ?'); args.push(input.serverId); }
    if (input.query) {
      const pattern = `%${escapeLike(input.query.toLocaleLowerCase())}%`;
      where.push("(lower(server_id) LIKE ? ESCAPE '\\' OR lower(user_id) LIKE ? ESCAPE '\\' OR lower(username) LIKE ? ESCAPE '\\' OR lower(bind_qq) LIKE ? ESCAPE '\\' OR lower(char_id) LIKE ? ESCAPE '\\')");
      args.push(pattern, pattern, pattern, pattern, pattern);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM (SELECT server_id, user_id, username, bind_qq FROM player_directory ${clause} GROUP BY server_id, user_id, username, bind_qq)`).get(...args) as { count: number };
    const groups = this.db.prepare(`SELECT server_id AS serverId, MIN(source_file) AS sourceFile, GROUP_CONCAT(char_id, '|') AS charIds, user_id AS userId, username, bind_qq AS bindQQ FROM player_directory ${clause} GROUP BY server_id, user_id, username, bind_qq ORDER BY CASE WHEN user_id NOT GLOB '*[^0-9]*' THEN 0 ELSE 1 END, CASE WHEN user_id NOT GLOB '*[^0-9]*' THEN length(user_id) ELSE 0 END, user_id COLLATE NOCASE, server_id COLLATE NOCASE, username COLLATE NOCASE, bind_qq LIMIT ? OFFSET ?`).all(...args, input.limit, input.offset) as DirectoryGroupRecord[];
    const rows = groups.flatMap((group) => group.charIds.split('|').map((charId) => ({ serverId: group.serverId, sourceFile: group.sourceFile, charId, userId: group.userId, username: group.username, bindQQ: group.bindQQ })));
    return { rows, totalCount: total.count };
  }
}

function escapeLike(value: string) { return value.replace(/[\\%_]/gu, (character) => `\\${character}`); }
