import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { Role, UploadPermissions, WorkspacePermissions } from '../../../shared/types.js';
import type { StoredUser, UserRepository } from './json-users.js';

type UserRow = { id: string; username: string; display_name: string; role: Role; workspace_permissions_json?: string | null; upload_permissions_json?: string | null; password_hash: string; active: number; created_at: string; created_by_json: string | null };

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: SqliteDatabase) {}

  all() { return (this.db.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as UserRow[]).map(toUser); }
  findById(id: string) { const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined; return row ? toUser(row) : undefined; }
  findByUsername(username: string) { const row = this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as UserRow | undefined; return row ? toUser(row) : undefined; }
  insert(user: StoredUser) { this.db.prepare('INSERT INTO users (id, username, display_name, role, workspace_permissions_json, upload_permissions_json, password_hash, active, created_at, created_by_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, user.username, user.displayName, user.role, user.workspacePermissions ? JSON.stringify(user.workspacePermissions) : null, user.uploadPermissions ? JSON.stringify(user.uploadPermissions) : null, user.passwordHash, user.active ? 1 : 0, user.createdAt, user.createdBy ? JSON.stringify(user.createdBy) : null); }
  replace(user: StoredUser) { this.db.prepare('UPDATE users SET username = ?, display_name = ?, role = ?, workspace_permissions_json = ?, upload_permissions_json = ?, password_hash = ?, active = ?, created_at = ?, created_by_json = ? WHERE id = ?').run(user.username, user.displayName, user.role, user.workspacePermissions ? JSON.stringify(user.workspacePermissions) : null, user.uploadPermissions ? JSON.stringify(user.uploadPermissions) : null, user.passwordHash, user.active ? 1 : 0, user.createdAt, user.createdBy ? JSON.stringify(user.createdBy) : null, user.id); }
  remove(id: string) { this.db.prepare('DELETE FROM users WHERE id = ?').run(id); }
}

function toUser(row: UserRow): StoredUser {
  const workspacePermissions = readPermissions(row.workspace_permissions_json);
  const uploadPermissions = readUploadPermissions(row.upload_permissions_json);
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, ...(workspacePermissions ? { workspacePermissions } : {}), ...(uploadPermissions ? { uploadPermissions } : {}), passwordHash: row.password_hash, active: row.active === 1, createdAt: row.created_at, ...(row.created_by_json ? { createdBy: JSON.parse(row.created_by_json) as StoredUser['createdBy'] } : {}) };
}

function readPermissions(value: string | null | undefined): Partial<WorkspacePermissions> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Partial<WorkspacePermissions> : undefined;
  } catch { return undefined; }
}

function readUploadPermissions(value: string | null | undefined): Partial<UploadPermissions> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Partial<UploadPermissions> : undefined;
  } catch { return undefined; }
}
