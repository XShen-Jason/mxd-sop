import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const databasePath = path.join(os.tmpdir(), `ops-${randomUUID()}.sqlite`);
const catalogPath = fs.existsSync(path.resolve(process.cwd(), 'data/item-catalog/source/道具表.xlsx'))
  ? path.resolve(process.cwd(), 'data/item-catalog/source/道具表.xlsx')
  : path.resolve(process.cwd(), '..', 'data/item-catalog/source/道具表.xlsx');

describe('SQLite deployment persistence', () => {
  afterAll(() => {
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${databasePath}${suffix}`)) fs.unlinkSync(`${databasePath}${suffix}`);
  });

  it('initializes one super admin and preserves its session across restart', async () => {
    const first = await createApp({ databasePath, catalogPath, initialAdmin: { username: 'owner', displayName: '系统负责人', password: 'Abc123' } });
    const login = await first.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: 'Abc123' } });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('SameSite=Strict');
    const cookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const users = await first.inject({ method: 'GET', url: '/api/v1/auth/users', headers: { cookie } });
    expect(users.json().users).toHaveLength(1);
    expect(users.json().users[0].role).toBe('super_admin');
    await first.close();

    const second = await createApp({ databasePath, catalogPath });
    const me = await second.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe('owner');
    await second.close();
  });

  it('rejects first startup without an initial password', async () => {
    const emptyPath = path.join(os.tmpdir(), `ops-empty-${randomUUID()}.sqlite`);
    await expect(createApp({ databasePath: emptyPath, catalogPath, initialAdmin: { username: 'owner', displayName: '系统负责人', password: '' } })).rejects.toThrow('INITIAL_ADMIN_PASSWORD');
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${emptyPath}${suffix}`)) fs.unlinkSync(`${emptyPath}${suffix}`);
  });
});
