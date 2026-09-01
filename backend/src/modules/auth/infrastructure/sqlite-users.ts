import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { Role } from '../../../shared/types.js';
import type { StoredUser, UserRepository } from './json-users.js';

type UserRow = { id: string; username: string; display_name: string; role: Role; password_hash: string; active: number; created_at: string; created_by_json: string | null };

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  all() { return (this.db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as UserRow[]).map(toUser); }
  findById(id: string) { const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined; return row ? toUser(row) : undefined; }
  findByUsername(username: string) { const row = this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as UserRow | undefined; return row ? toUser(row) : undefined; }
  insert(user: StoredUser) { this.db.prepare('INSERT INTO users (id, username, display_name, role, password_hash, active, created_at, created_by_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, user.username, user.displayName, user.role, user.passwordHash, user.active ? 1 : 0, user.createdAt, user.createdBy ? JSON.stringify(user.createdBy) : null); }
  replace(user: StoredUser) { this.db.prepare('UPDATE users SET username = ?, display_name = ?, role = ?, password_hash = ?, active = ?, created_at = ?, created_by_json = ? WHERE id = ?').run(user.username, user.displayName, user.role, user.passwordHash, user.active ? 1 : 0, user.createdAt, user.createdBy ? JSON.stringify(user.createdBy) : null, user.id); }
  remove(id: string) { this.db.prepare('DELETE FROM users WHERE id = ?').run(id); }
}

function toUser(row: UserRow): StoredUser {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, passwordHash: row.password_hash, active: row.active === 1, createdAt: row.created_at, ...(row.created_by_json ? { createdBy: JSON.parse(row.created_by_json) as StoredUser['createdBy'] } : {}) };
}
