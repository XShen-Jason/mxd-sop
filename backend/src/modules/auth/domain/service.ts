import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Identity, Role, UserSummary } from '../../../shared/types.js';
import type { StoredUser, UserRepository } from '../infrastructure/json-users.js';
import type { SessionRepository } from './session-repository.js';

export type AuthErrorCode =
  | 'unauthorized'
  | 'invalid-input'
  | 'invalid-credentials'
  | 'forbidden'
  | 'username-taken'
  | 'user-not-found'
  | 'last-super-admin'
  | 'conflict';

export class AuthError extends Error {
  constructor(public readonly code: AuthErrorCode, message: string = code) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName: string;
  role: Role;
}

export interface UpdateUserInput {
  password?: string;
  displayName?: string;
  role?: Role;
  active?: boolean;
}

interface Session { userId: string; expiresAt: number }
class MemorySessionRepository implements SessionRepository {
  private readonly values = new Map<string, Session>();
  create(token: string, userId: string, expiresAt: number) { this.values.set(token, { userId, expiresAt }); }
  find(token: string) { const value = this.values.get(token); if (value && value.expiresAt <= Date.now()) this.values.delete(token); return value; }
  remove(token: string) { this.values.delete(token); }
  removeForUser(userId: string) { for (const [token, value] of this.values) if (value.userId === userId) this.values.delete(token); }
}

const ROLE_LEVEL: Record<Role, number> = { customer: 1, manager: 2, super_admin: 3 };

export function roleLevel(role: Role) { return ROLE_LEVEL[role] ?? 0; }
export function isManager(identity: Identity) { return roleLevel(identity.role) >= ROLE_LEVEL.manager; }
export function isSuperAdmin(identity: Identity) { return identity.role === 'super_admin'; }

function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 6 && password.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(password);
}

function verifyPassword(password: string, encoded: string) {
  if (typeof encoded !== 'string') return false;
  const [, salt, digest] = encoded.split('$');
  if (!salt || salt.length !== 32 || !/^[a-f0-9]+$/u.test(salt) || !digest || digest.length !== 128 || !/^[a-f0-9]+$/u.test(digest)) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function username(value: unknown) {
  if (typeof value !== 'string' || value !== value.trim() || !/^[A-Za-z0-9_.-]{3,64}$/u.test(value)) throw new AuthError('invalid-input', 'username is invalid');
  return value;
}

function displayName(value: unknown) {
  if (typeof value !== 'string') throw new AuthError('invalid-input', 'displayName is invalid');
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || /[\u0000-\u001f\u007f]/u.test(normalized)) throw new AuthError('invalid-input', 'displayName is invalid');
  return normalized;
}

function role(value: unknown): Role {
  if (value === 'customer' || value === 'manager' || value === 'super_admin') return value;
  if (value === 'superadmin' || value === 'super-admin') return 'super_admin';
  throw new AuthError('invalid-input', 'role is invalid');
}

function summary(user: StoredUser): UserSummary {
  const { passwordHash: _password, ...safe } = structuredClone(user);
  return safe;
}

export class AuthService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly sessionTtlMs: number;
  private readonly allowLegacyHeaders: boolean;
  private readonly sessions: SessionRepository;

  constructor(private readonly repository: UserRepository, options: { now?: () => Date; idFactory?: () => string; sessionTtlMs?: number; allowLegacyHeaders?: boolean; sessions?: SessionRepository; initialAdmin?: { username: string; displayName: string; password: string } } = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
    this.allowLegacyHeaders = options.allowLegacyHeaders ?? process.env.NODE_ENV === 'test';
    this.sessions = options.sessions ?? new MemorySessionRepository();
    this.ensureInitialAdmin(options.initialAdmin);
  }

  login(rawUsername: unknown, rawPassword: unknown) {
    let name: string;
    try { name = username(rawUsername); } catch { throw new AuthError('invalid-credentials', '用户名或密码错误'); }
    if (!validPassword(rawPassword)) throw new AuthError('invalid-credentials', '用户名或密码错误');
    const user = this.repository.findByUsername(name);
    if (!user || !user.active || !verifyPassword(rawPassword, user.passwordHash)) throw new AuthError('invalid-credentials', '用户名或密码错误');
    const now = this.now().getTime();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + this.sessionTtlMs;
    this.sessions.create(token, user.id, expiresAt);
    return { token, expiresAt: new Date(expiresAt).toISOString(), user: summary(user) };
  }

  logout(token: string | undefined) { if (token) this.sessions.remove(token); }

  identityFromToken(token: string | undefined): Identity | undefined {
    if (!token) return undefined;
    const session = this.sessions.find(token);
    if (!session) return undefined;
    if (session.expiresAt <= this.now().getTime()) { this.sessions.remove(token); return undefined; }
    const user = this.repository.findById(session.userId);
    if (!user || !user.active) { this.sessions.remove(token); return undefined; }
    return { id: user.id, role: user.role, displayName: user.displayName };
  }

  requestIdentity(headers: Record<string, unknown>): Identity {
    const token = this.extractToken(headers);
    const authenticated = this.identityFromToken(token);
    if (authenticated) return authenticated;
    // Kept for the repository's local contract tests and an explicit demo mode.
    const roleHeader = this.header(headers, 'x-user-role');
    const idHeader = this.header(headers, 'x-user-id');
    if (this.allowLegacyHeaders && roleHeader && idHeader && this.isLegacyDemo(idHeader, roleHeader)) {
      const mappedRole = role(roleHeader);
      return { id: idHeader, role: mappedRole, displayName: this.header(headers, 'x-display-name') || (mappedRole === 'customer' ? '演示客服' : mappedRole === 'manager' ? '演示管理' : '演示超管') };
    }
    throw new AuthError('unauthorized', 'authentication required');
  }

  me(identity: Identity) {
    const user = this.repository.findById(identity.id);
    if (!user || !user.active) throw new AuthError('unauthorized');
    return summary(user);
  }

  resolveDisplayName(id: string) {
    return this.repository.findById(id)?.displayName;
  }

  listUsers(actor: Identity, limit = 100) {
    this.requireManager(actor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AuthError('invalid-input', 'invalid limit');
    const users = this.repository.all().filter((user) => isSuperAdmin(actor) || user.role !== 'super_admin');
    return users.sort((a, b) => a.username.localeCompare(b.username)).slice(0, limit).map(summary);
  }

  createUser(actor: Identity, input: CreateUserInput) {
    this.requireManager(actor);
    const name = username(input?.username);
    const targetRole = input?.role === undefined && actor.role === 'manager' ? 'customer' : role(input?.role);
    if (actor.role === 'manager' && targetRole === 'super_admin') throw new AuthError('forbidden', '普通管理不能创建超级管理员');
    if (!validPassword(input?.password)) throw new AuthError('invalid-input', '密码至少 6 位');
    const label = displayName(input?.displayName);
    if (this.repository.findByUsername(name)) throw new AuthError('username-taken', '用户名已存在');
    const user: StoredUser = { id: this.idFactory(), username: name, displayName: label, role: targetRole, passwordHash: passwordHash(input.password), active: true, createdAt: this.now().toISOString(), createdBy: { id: actor.id, displayName: actor.displayName } };
    this.repository.insert(user);
    return summary(user);
  }

  updateUser(actor: Identity, id: string, input: UpdateUserInput) {
    this.requireManager(actor);
    const user = this.repository.findById(id);
    if (!user) throw new AuthError('user-not-found');
    if (actor.role === 'manager' && user.role === 'super_admin') throw new AuthError('forbidden');
    const nextRole = input?.role === undefined ? user.role : role(input.role);
    if (actor.role === 'manager' && nextRole === 'super_admin') throw new AuthError('forbidden');
    if (nextRole !== user.role && !isSuperAdmin(actor)) throw new AuthError('forbidden');
    const active = input?.active === undefined ? user.active : input.active;
    if (typeof active !== 'boolean') throw new AuthError('invalid-input');
    if (user.role === 'super_admin' && (nextRole !== 'super_admin' || !active) && this.activeSuperAdminCount() <= 1) throw new AuthError('last-super-admin');
    if (input?.password !== undefined && !validPassword(input.password)) throw new AuthError('invalid-input', '密码至少 6 位');
    const next: StoredUser = { ...user, role: nextRole, active, displayName: input?.displayName === undefined ? user.displayName : displayName(input.displayName), passwordHash: input?.password === undefined ? user.passwordHash : passwordHash(input.password) };
    this.repository.replace(next);
    if (input?.password !== undefined || nextRole !== user.role || !active) {
      this.sessions.removeForUser(user.id);
    }
    return summary(next);
  }

  deleteUser(actor: Identity, id: string) {
    this.requireManager(actor);
    if (actor.id === id) throw new AuthError('forbidden', '不能删除当前登录账号');
    const user = this.repository.findById(id);
    if (!user) throw new AuthError('user-not-found');
    if (actor.role === 'manager' && user.role === 'super_admin') throw new AuthError('forbidden');
    if (user.role === 'super_admin' && user.active && this.activeSuperAdminCount() <= 1) throw new AuthError('last-super-admin');
    this.repository.remove(id);
    this.sessions.removeForUser(id);
    return summary(user);
  }

  canCreate(actor: Identity, targetRole: Role) { return isSuperAdmin(actor) || (actor.role === 'manager' && targetRole !== 'super_admin'); }

  private requireManager(actor: Identity) { if (!isManager(actor)) throw new AuthError('forbidden'); }
  private activeSuperAdminCount() { return this.repository.all().filter((user) => user.role === 'super_admin' && user.active).length; }

  private ensureInitialAdmin(initialAdmin?: { username: string; displayName: string; password: string }) {
    if (this.repository.all().length > 0) return;
    if (!initialAdmin || !validPassword(initialAdmin.password)) throw new Error('INITIAL_ADMIN_PASSWORD is required for first startup and must be 6-128 characters');
    const name = username(initialAdmin.username);
    const label = displayName(initialAdmin.displayName);
    this.repository.insert({ id: this.idFactory(), username: name, displayName: label, role: 'super_admin', passwordHash: passwordHash(initialAdmin.password), active: true, createdAt: this.now().toISOString() });
  }

  private extractToken(headers: Record<string, unknown>) {
    const authorization = this.header(headers, 'authorization');
    if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
    const cookie = this.header(headers, 'cookie') ?? '';
    return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('session='))?.slice(8);
  }

  private header(headers: Record<string, unknown>, name: string) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : value === undefined ? '' : String(value);
  }

  private isLegacyDemo(id: string, roleValue: string) {
    if (id.length > 128 || /[\s\u0000-\u001f\u007f]/u.test(id)) return false;
    const allowed = roleValue === 'customer' ? ['customer-a', 'demo-customer'] : roleValue === 'manager' ? ['manager-b', 'demo-manager'] : ['super-admin', 'demo-super-admin'];
    return allowed.includes(id);
  }
}
