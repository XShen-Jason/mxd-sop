import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/public/index.js';

describe('login protection HTTP contract', () => {
  let app: FastifyInstance;
  let now: number;
  const prefix = path.join(os.tmpdir(), `ops-login-protection-${randomUUID()}`);
  const files = { catalog: `${prefix}-catalog.json`, users: `${prefix}-users.json`, groups: `${prefix}-groups.json` };
  const payload = { username: 'login-admin', password: 'CorrectPass1!' };
  const ip = '192.0.2.10';
  const login = (password = payload.password, remoteAddress = ip, url = '/api/v1/auth/login', username = payload.username) =>
    app.inject({ method: 'POST', url, remoteAddress, payload: { username, password } });

  beforeEach(async () => {
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    fs.writeFileSync(files.catalog, JSON.stringify({ items: [{ item_id: '02000000', name: 'test item', class: 'consume' }] }));
    app = await createApp({ catalogPath: files.catalog, dataPath: files.groups, usersPath: files.users,
      enableTeamScheduler: false, initialAdmin: { ...payload, displayName: 'Login Admin' } });
  });

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
    for (const file of Object.values(files)) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  it('shares both aliases, counts successes, and rejects before verifying credentials', async () => {
    const verify = vi.spyOn(AuthService.prototype, 'login');
    for (let i = 0; i < 10; i++) {
      const response = await login(payload.password, ip, i % 2 ? '/api/v1/login' : '/api/v1/auth/login');
      expect(response.statusCode).toBe(200);
    }
    const blocked = await login(payload.password, ip, '/api/v1/login');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('300');
    expect(blocked.json().error).toMatchObject({ code: 'login-rate-limited', retryAfterSeconds: 300 });
    expect(blocked.json().error.message).toContain('每 5 分钟最多 10 次');
    expect(blocked.headers['set-cookie']).toBeUndefined();
    expect(verify).toHaveBeenCalledTimes(10);
    expect((await login(payload.password, '192.0.2.11')).statusCode).toBe(200);
    now += 300_000;
    expect((await login()).statusCode).toBe(200);
  });

  it('aggregates failures across accounts and aliases; preserves sessions and unlocks at the deadline', async () => {
    const session = await login();
    const cookie = String(session.headers['set-cookie']).split(';')[0];
    for (let i = 0; i < 4; i++) {
      const failed = await login('WrongPass1!', ip, i % 2 ? '/api/v1/login' : '/api/v1/auth/login', i % 2 ? 'missing-user' : payload.username);
      expect(failed.statusCode).toBe(401);
      expect(failed.json().error.code).toBe('unauthorized');
      if (i === 1) now += 300_000;
    }
    const locked = await login('WrongPass1!');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toMatchObject({ code: 'login-blocked', retryAfterSeconds: 1200 });
    expect(locked.json().error.message).toContain('20 分钟');
    expect(locked.headers['retry-after']).toBe('1200');
    expect(locked.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(200);
    expect((await login(payload.password, '192.0.2.11')).statusCode).toBe(200);
    const verify = vi.spyOn(AuthService.prototype, 'login');
    now += 1_199_001;
    const stillLocked = await login();
    expect(stillLocked.statusCode).toBe(429);
    expect(stillLocked.headers['retry-after']).toBe('1');
    expect(verify).not.toHaveBeenCalled();
    now += 999;
    expect((await login('WrongPass1!')).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(200);
  });

  it('counts malformed requests before JSON parsing but does not treat them as password failures', async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 10; i++) {
        const invalid = await app.inject({ method: 'POST', url: '/api/v1/login', remoteAddress: ip,
          headers: { 'content-type': 'application/json' }, payload: i % 2 ? '{' : JSON.stringify({ ...payload, extra: true }) });
        expect(invalid.statusCode).toBe(400);
      }
      expect((await login()).json().error.code).toBe('login-rate-limited');
      now += 300_000;
    }
    expect((await login('WrongPass1!')).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(200);
  });

  it('allows only ten concurrent requests and applies the same guard to the alias', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => login(payload.password, ip, i % 2 ? '/api/v1/login' : '/api/v1/auth/login')));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(10);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(10);
  });

  it('locks on the fifth concurrent credential failure even with request quota remaining', async () => {
    const verify = vi.spyOn(AuthService.prototype, 'login');
    const responses = await Promise.all(Array.from({ length: 10 }, () => login('WrongPass1!')));
    expect(responses.filter((response) => response.statusCode === 401)).toHaveLength(4);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(6);
    expect(responses.filter((response) => response.statusCode === 429).every((response) => response.json().error.code === 'login-blocked')).toBe(true);
    expect(verify).toHaveBeenCalledTimes(5);
    expect((await login()).json().error.code).toBe('login-blocked');
    expect(verify).toHaveBeenCalledTimes(5);
  });

  it('ignores spoofed forwarding headers from direct external connections', async () => {
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip, payload,
        headers: { 'x-forwarded-for': `198.51.100.${i}`, 'x-real-ip': `203.0.113.${i}`, 'cf-connecting-ip': `203.0.113.${i}` } });
      expect(response.statusCode).toBe(i < 10 ? 200 : 429);
    }
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('uses only the client appended by the trusted %s proxy', async (remoteAddress) => {
    for (let i = 0; i < 11; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress, payload,
        headers: { 'x-forwarded-for': `198.51.100.${i}, ${ip}` } });
      expect(response.statusCode).toBe(i < 10 ? 200 : 429);
    }
    const independent = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress, payload,
      headers: { 'x-forwarded-for': '192.0.2.11' } });
    expect(independent.statusCode).toBe(200);
  });

  it('keys Cloudflare requests by the visitor restored by Nginx, independently of edge changes', async () => {
    for (let i = 0; i < 11; i++) {
      // Nginx appends its verified $remote_addr after realip processing. Earlier
      // chain entries and CF headers must not override that final visitor IP.
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '127.0.0.1', payload,
        headers: { 'x-forwarded-for': `198.51.100.${i}, 172.64.0.${i + 1}, ${ip}`, 'cf-connecting-ip': `203.0.113.${i}` } });
      expect(response.statusCode).toBe(i < 10 ? 200 : 429);
    }
    const anotherVisitor = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '127.0.0.1', payload,
      headers: { 'x-forwarded-for': '172.64.0.6, 192.0.2.11' } });
    expect(anotherVisitor.statusCode).toBe(200);
  });

  it.each([
    ['192.0.2.10', '::ffff:192.0.2.10', '::ffff:c000:20a'],
  ])('normalizes equivalent IP spellings for %s', async (...addresses) => {
    for (let i = 0; i < 11; i++) {
      expect((await login(payload.password, addresses[i % addresses.length])).statusCode).toBe(i < 10 ? 200 : 429);
    }
  });
});
