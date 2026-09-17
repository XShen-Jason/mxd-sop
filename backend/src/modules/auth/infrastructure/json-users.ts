import fs from 'node:fs';
import path from 'node:path';
import type { Role, UploadPermissions, WorkspacePermissions } from '../../../shared/types.js';

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  workspacePermissions?: Partial<WorkspacePermissions>;
  uploadPermissions?: Partial<UploadPermissions>;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  createdBy?: { id: string; displayName: string };
}

export interface UserRepository {
  all(): StoredUser[];
  findById(id: string): StoredUser | undefined;
  findByUsername(username: string): StoredUser | undefined;
  insert(user: StoredUser): void;
  replace(user: StoredUser): void;
  remove(id: string): void;
}

export class JsonUserRepository implements UserRepository {
  private users: StoredUser[];

  constructor(private readonly filePath: string) {
    const result = this.read();
    this.users = result.users;
    if (result.migrated) this.persist();
  }

  all() { return this.users.map((user) => structuredClone(user)); }

  findById(id: string) {
    const user = this.users.find((candidate) => candidate.id === id);
    return user ? structuredClone(user) : undefined;
  }

  findByUsername(username: string) {
    const normalized = username.toLocaleLowerCase();
    const user = this.users.find((candidate) => candidate.username.toLocaleLowerCase() === normalized);
    return user ? structuredClone(user) : undefined;
  }

  insert(user: StoredUser) {
    this.users.push(structuredClone(user));
    this.persist();
  }

  replace(user: StoredUser) {
    const index = this.users.findIndex((candidate) => candidate.id === user.id);
    if (index < 0) throw new Error('user not found');
    this.users[index] = structuredClone(user);
    this.persist();
  }

  remove(id: string) {
    const index = this.users.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw new Error('user not found');
    this.users.splice(index, 1);
    this.persist();
  }

  private read(): { users: StoredUser[]; migrated: boolean } {
    if (!fs.existsSync(this.filePath)) return { users: [], migrated: false };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('root must be an array');
      let migrated = false;
      const users = parsed.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value as StoredUser;
        const raw = value as Record<string, unknown>;
        const workspacePermissions = raw.workspacePermissions ?? raw.tabPermissions;
        migrated ||= Object.prototype.hasOwnProperty.call(raw, 'tabPermissions');
        const { tabPermissions: _legacy, ...canonical } = raw;
        return { ...canonical, ...(workspacePermissions !== undefined ? { workspacePermissions } : {}) } as StoredUser;
      });
      return { users, migrated };
    } catch (error) {
      throw new Error(`cannot read user store: ${String(error)}`);
    }
  }

  private persist() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.users, null, 2), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}
