import { createHash } from 'node:crypto';
import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { SessionRepository } from '../domain/session-repository.js';

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: SqliteDatabase) {}
  create(token: string, userId: string, expiresAt: number) {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash(token), userId, expiresAt);
  }
  find(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const row = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hash(token)) as { user_id: string; expires_at: number } | undefined;
    return row ? { userId: row.user_id, expiresAt: row.expires_at } : undefined;
  }
  remove(token: string) { this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token)); }
  removeForUser(userId: string) { this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }
}

export function hashSessionToken(token: string) { return hash(token); }
function hash(token: string) { return createHash('sha256').update(token, 'utf8').digest('hex'); }
