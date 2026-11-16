import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { FileLoginAudit, type LoginAttemptRecord, type LoginAuditSink } from '../src/modules/auth/public/index.js';

describe('SOP submitted-login-account audit', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let directory: string;
  let records: LoginAttemptRecord[];
  let sink: LoginAuditSink;
  const credentials = { username: 'audit-admin', password: 'CorrectAuditPass!' };
  const login = (username: unknown, password = credentials.password, url = '/api/v1/auth/login') => app.inject({
    method: 'POST', url, remoteAddress: '127.0.0.1',
    headers: { 'x-forwarded-for': '198.51.100.1, 192.0.2.77', cookie: 'session=never-log-this-cookie', authorization: 'Bearer never-log-this-bearer' },
    payload: { username, password },
  });

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-login-audit-'));
    const catalogPath = path.join(directory, 'catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify({ items: [{ item_id: '02000000', name: 'test', class: 'consume' }] }));
    records = [];
    sink = { append: (record) => records.push(record) };
    app = await createApp({ databasePath: path.join(directory, 'ops.sqlite'), catalogPath, loginAudit: sink,
      enableTeamScheduler: false, initialAdmin: { ...credentials, displayName: 'Audit admin' } });
  });
  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('records the submitted account for success, bad passwords and missing users, once per alias request', async () => {
    const success = await login(credentials.username);
    expect(success.statusCode).toBe(200);
    expect((await login(credentials.username, 'WrongAuditPass!', '/api/v1/login?token=never-log-this-query')).statusCode).toBe(401);
    expect((await login('Missing-AcCoUnT', 'WrongAuditPass!')).statusCode).toBe(401);
    expect(records.map((row) => [row.username, row.status, row.result, row.route])).toEqual([
      ['audit-admin', 200, 'success', '/api/v1/auth/login'],
      ['audit-admin', 401, 'invalid-credentials', '/api/v1/login'],
      ['Missing-AcCoUnT', 401, 'invalid-credentials', '/api/v1/auth/login'],
    ]);
    expect(records.every((row) => row.ip === '192.0.2.77' && row.usernameState === 'provided')).toBe(true);
    expect(new Set(records.map((row) => row.requestId)).size).toBe(3);
    expect(records[0].time).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/u);
    const json = JSON.stringify(records);
    for (const secret of [credentials.password, 'WrongAuditPass!', 'never-log-this-cookie', 'never-log-this-bearer', 'never-log-this-query', success.json().token]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(records[0]).sort()).toEqual(['event', 'ip', 'requestId', 'result', 'route', 'status', 'time', 'username', 'usernameState'].sort());
  });

  it('records the fifth failure account but never reads a body rejected by the existing lock', async () => {
    for (let i = 0; i < 5; i++) await login(`claimed-${i}`, 'wrong-password');
    const blocked = await login('body-must-not-be-read', 'wrong-password');
    expect(blocked.statusCode).toBe(429);
    expect(records[4]).toMatchObject({ username: 'claimed-4', status: 429, result: 'limited' });
    expect(records[5]).toMatchObject({ username: null, usernameState: 'body-unavailable', status: 429 });
    expect(JSON.stringify(records)).not.toContain('body-must-not-be-read');
  });

  it('keeps spelling and bounds malformed account fields without stringifying other data', async () => {
    await login('  Entered.Name  ');
    await login('x'.repeat(1000));
    await login({ password: 'nested-secret' });
    await app.inject({ method: 'POST', url: '/api/v1/login', remoteAddress: '192.0.2.77',
      headers: { 'content-type': 'application/json' }, payload: '{bad json' });
    expect(records[0].username).toBe('  Entered.Name  ');
    expect(records[1]).toMatchObject({ username: 'x'.repeat(128), usernameState: 'truncated' });
    expect(records[2]).toMatchObject({ username: null, usernameState: 'invalid-type' });
    expect(records[3]).toMatchObject({ username: null, usernameState: 'body-unavailable', status: 400 });
    expect(JSON.stringify(records)).not.toContain('nested-secret');
  });

  it('logs early IPv6 denial and ignores non-login routes and spoofed identities', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '2001:db8::1',
      headers: { 'x-forwarded-for': '192.0.2.1' }, payload: credentials });
    await app.inject({ url: '/health' });
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
    await app.inject({ method: 'GET', url: '/api/v1/auth/login' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ip: '2001:db8::1', status: 403, result: 'blocked', username: null });
  });

  it('keeps authentication results when logging fails and emits at most one diagnostic per minute', async () => {
    vi.spyOn(sink, 'append').mockImplementation(() => { throw new Error('private-path-password-never-log'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await login(credentials.username)).statusCode).toBe(200);
    expect((await login('missing-account', 'wrong-password')).statusCode).toBe(401);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain('auth.login.audit_error');
    expect(String(errors.mock.calls[0][0])).not.toContain('private-path-password-never-log');
  });

  it('enables the private file log beside the configured production database by default', async () => {
    await app.close();
    vi.stubEnv('NODE_ENV', 'production');
    app = await createApp({ databasePath: path.join(directory, 'ops.sqlite'), catalogPath: path.join(directory, 'catalog.json'),
      enableTeamScheduler: false });
    expect((await login('nonexistent-entered-account', 'wrong-password')).statusCode).toBe(401);
    const record = JSON.parse(fs.readFileSync(path.join(directory, 'login-attempts.log'), 'utf8'));
    expect(record).toMatchObject({ username: 'nonexistent-entered-account', ip: '192.0.2.77', status: 401 });
    if (process.platform !== 'win32') expect(fs.statSync(path.join(directory, 'login-attempts.log')).mode & 0o777).toBe(0o600);
  });

  it('writes one JSON line per input, preserves appends across reopen and rotates within a fixed disk budget', async () => {
    const file = path.join(directory, 'login-attempts.log');
    await login('line\nforgery\r\n\u2028\u2029');
    let writer = new FileLoginAudit(file, 1024, 2);
    writer.append(records[0]);
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw.split('\n')).toHaveLength(2);
    expect(raw).not.toMatch(/[\u2028\u2029]/u);
    expect(JSON.parse(raw).username).toBe('line\nforgery\r\n\u2028\u2029');
    writer = new FileLoginAudit(file, 1024, 2);
    for (let i = 0; i < 40; i++) writer.append({ ...records[0], username: `attempt-${i}` });
    const names = fs.readdirSync(directory).filter((name) => name.startsWith('login-attempts.log'));
    expect(names.sort()).toEqual(['login-attempts.log', 'login-attempts.log.1', 'login-attempts.log.2']);
    expect(names.reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0)).toBeLessThanOrEqual(3072);
    expect(fs.readFileSync(file, 'utf8')).toContain('attempt-39');
    expect(names.flatMap((name) => fs.readFileSync(path.join(directory, name), 'utf8').trim().split('\n')).every((line) => JSON.parse(line).event === 'auth.login.attempt')).toBe(true);
  });
});
