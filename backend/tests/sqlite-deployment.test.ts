import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/infrastructure/sqlite.js';

const databasePath = path.join(os.tmpdir(), `ops-${randomUUID()}.sqlite`);
const reminderDatabasePath = path.join(os.tmpdir(), `ops-reminders-${randomUUID()}.sqlite`);
const legacyDatabasePath = path.join(os.tmpdir(), `ops-legacy-${randomUUID()}.sqlite`);
const catalogPath = fs.existsSync(path.resolve(process.cwd(), 'data/item-catalog/source/道具表-9-5.csv'))
  ? path.resolve(process.cwd(), 'data/item-catalog/source/道具表-9-5.csv')
  : path.resolve(process.cwd(), '..', 'data/item-catalog/source/道具表-9-5.csv');

describe('SQLite deployment persistence', () => {
  afterAll(() => {
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${databasePath}${suffix}`)) fs.unlinkSync(`${databasePath}${suffix}`);
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${reminderDatabasePath}${suffix}`)) fs.unlinkSync(`${reminderDatabasePath}${suffix}`);
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${legacyDatabasePath}${suffix}`)) fs.unlinkSync(`${legacyDatabasePath}${suffix}`);
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

  it('preserves reminder fields and customer counts across restart', async () => {
    const first = await createApp({ databasePath: reminderDatabasePath, catalogPath, initialAdmin: { username: 'owner', displayName: 'Owner', password: 'Abc123' } });
    const ownerLogin = await first.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: 'Abc123' } });
    const ownerCookie = String(ownerLogin.headers['set-cookie']).split(';', 1)[0];
    const createdCustomer = await first.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { cookie: ownerCookie }, payload: { username: 'reminder-customer', displayName: '提醒客服', password: 'Cust123', role: 'customer' } });
    expect(createdCustomer.statusCode).toBe(201);
    const customerLogin = await first.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'reminder-customer', password: 'Cust123' } });
    const customerCookie = String(customerLogin.headers['set-cookie']).split(';', 1)[0];
    const submitted = await first.inject({ method: 'POST', url: '/api/v1/operation-groups', headers: { cookie: customerCookie }, payload: { serverId: 'mushroom', account: 'persist-player', playerQQ: '8', characterId: '808', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] } });
    expect(submitted.statusCode).toBe(201);
    const id = submitted.json().id as string;
    expect((await first.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${id}/approve`, headers: { cookie: ownerCookie } })).statusCode).toBe(200);
    expect((await first.inject({ method: 'POST', url: `/api/v1/super-admin/operation-groups/${id}/remind`, headers: { cookie: ownerCookie } })).statusCode).toBe(200);
    await first.close();

    const second = await createApp({ databasePath: reminderDatabasePath, catalogPath });
    const reminders = await second.inject({ method: 'GET', url: '/api/v1/operation-groups/reminders', headers: { cookie: customerCookie } });
    expect(reminders.statusCode).toBe(200);
    expect(reminders.json().groups).toEqual([expect.objectContaining({ id, reminderCount: 1 })]);
    const counts = (await second.inject({ method: 'GET', url: '/api/v1/operation-groups/workspace-counts', headers: { cookie: customerCookie } })).json();
    expect(counts.reminders).toBe(1);
    expect(counts.ownIssuance).toBe(1);
    expect(counts.ownRegular).toBe(0);
    await second.close();
  });

  it('migrates reminder columns on an existing operation group table', () => {
    const legacy = new Database(legacyDatabasePath);
    legacy.exec('CREATE TABLE operation_groups (id TEXT PRIMARY KEY, submitted_by_id TEXT NOT NULL, status TEXT NOT NULL, server_id TEXT NOT NULL, submitted_at TEXT NOT NULL, idempotency_key TEXT, request_fingerprint TEXT, payload_json TEXT NOT NULL)');
    legacy.close();
    const db = openDatabase(legacyDatabasePath);
    try {
      const columns = (db.prepare('PRAGMA table_info(operation_groups)').all() as Array<{ name: string }>).map((column) => column.name);
      const reminderIndex = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'groups_reminders'").get();
      expect(columns).toEqual(expect.arrayContaining(['reminder_count', 'last_reminded_at', 'last_reminded_by_json']));
      expect(reminderIndex).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
