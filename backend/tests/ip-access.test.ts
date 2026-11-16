import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/infrastructure/sqlite.js';
import { AuthService } from '../src/modules/auth/public/index.js';

describe('durable IP access policy', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let directory: string;
  let databasePath: string;
  let catalogPath: string;
  let now: number;
  const ip = '192.0.2.44';
  const credentials = { username: 'ip-admin', password: 'CorrectPass1!' };
  const login = (password = 'WrongPass1!', address = ip) => app.inject({ method: 'POST',
    url: '/api/v1/auth/login', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': address },
    payload: { username: credentials.username, password } });
  const reopen = async () => {
    await app?.close();
    app = await createApp({ databasePath, catalogPath, enableTeamScheduler: false,
      initialAdmin: { ...credentials, displayName: 'Test admin' } });
  };

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ip-access-'));
    databasePath = path.join(directory, 'ops.sqlite');
    catalogPath = path.join(directory, 'catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify({ items: [{ item_id: '02000000', name: 'test', class: 'consume' }] }));
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await reopen();
  });
  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('bans failure 21 across temporary bans, successes and restarts; blocks existing cookies', async () => {
    const signedIn = await login(credentials.password);
    const cookie = String(signedIn.headers['set-cookie']).split(';')[0];
    for (let failure = 1; failure <= 20; failure++) {
      const response = await login();
      expect(response.statusCode).toBe(failure % 5 === 0 ? 429 : 401);
      if (failure % 5 === 0) {
        // Denied requests do not add password failures or extend the ban.
        for (let i = 0; i < 25; i++) expect((await login()).statusCode).toBe(429);
        now += 1_200_000;
        expect((await login(credentials.password)).statusCode).toBe(200);
      }
    }
    await reopen();
    const verify = vi.spyOn(AuthService.prototype, 'login');
    const attempts = await Promise.all(Array.from({ length: 10 }, () => login()));
    expect(attempts.every((response) => response.statusCode === 403)).toBe(true);
    expect(attempts[0].json().error.code).toBe('ip-permanently-banned');
    expect(attempts[0].headers['retry-after']).toBeUndefined();
    expect(verify).toHaveBeenCalledTimes(1);
    now += 365 * 86_400_000;
    await reopen();
    expect((await login(credentials.password, '::ffff:c000:22c')).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/v1/auth/me', remoteAddress: ip, headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/health', remoteAddress: ip })).statusCode).toBe(403);
    expect((await login(credentials.password, '192.0.2.45')).statusCode).toBe(200);
    const db = openDatabase(databasePath);
    try {
      expect(db.prepare('SELECT failures FROM auth_ip_failures WHERE ip = ?').get(ip)).toEqual({ failures: 21 });
      db.prepare('DELETE FROM auth_ip_failures WHERE ip = ?').run(ip);
      expect((await login(credentials.password)).statusCode).toBe(200);
    } finally { db.close(); }
  });

  it('keeps cumulative failures across successful logins before temporary thresholds', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await login()).statusCode).toBe(401);
      expect((await login(credentials.password)).statusCode).toBe(200);
      now += 300_000;
    }
    expect((await login()).json().error.code).toBe('ip-permanently-banned');
  });

  it('rejects real IPv6, ignores spoofed forwarding headers, and accepts mapped IPv4', async () => {
    for (const address of ['2001:db8::1', '2001:0DB8:0:0::abcd', '::1']) {
      const direct = await app.inject({ url: '/health', remoteAddress: address,
        headers: address === '::1' ? {} : { 'x-forwarded-for': ip, 'cf-connecting-ip': ip } });
      expect(direct.statusCode).toBe(403);
      expect(direct.json().error.code).toBe('ipv6-disabled');
      expect((await login(credentials.password, address)).statusCode).toBe(403);
    }
    expect((await login(credentials.password, '::ffff:192.0.2.44')).statusCode).toBe(200);
    expect((await app.inject({ url: '/health', remoteAddress: ip, headers: { 'x-forwarded-for': '2001:db8::1' } })).statusCode).toBe(200);
  });
});
