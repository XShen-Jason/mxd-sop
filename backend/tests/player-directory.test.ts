import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';

describe('player account directory', () => {
  let app: FastifyInstance;
  const dataPath = path.join(os.tmpdir(), `ops-directory-${randomUUID()}.json`);
  const usersPath = path.join(os.tmpdir(), `ops-directory-users-${randomUUID()}.json`);
  const catalogDir = fs.existsSync(path.resolve(process.cwd(), 'data/item-catalog/source'))
    ? path.resolve(process.cwd(), 'data/item-catalog/source')
    : path.resolve(process.cwd(), '..', 'data/item-catalog/source');
  const catalogPath = path.join(catalogDir, fs.readdirSync(catalogDir).find((name) => name.endsWith('.csv'))!);
  let superToken = '';
  let managerToken = '';
  let customerToken = '';

  beforeAll(async () => {
    app = await createApp({ catalogPath, dataPath, usersPath, initialAdmin: { username: 'directory-admin', displayName: 'Directory Admin', password: 'Admin123' } });
    const login = async (username: string, password: string) => (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } })).json().token as string;
    superToken = await login('directory-admin', 'Admin123');
    const created = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` }, payload: { username: 'directory-manager', displayName: 'Directory Manager', password: 'Manager123', role: 'manager' } });
    expect(created.statusCode).toBe(201);
    managerToken = await login('directory-manager', 'Manager123');
    const customer = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` }, payload: { username: 'directory-customer', displayName: 'Directory Customer', password: 'Customer123', role: 'customer' } });
    expect(customer.statusCode).toBe(201);
    customerToken = await login('directory-customer', 'Customer123');
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const file of [dataPath, usersPath, `${dataPath}.player-directory.json`]) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  it('allows all roles to search and only super admins to replace CSV data', async () => {
    const files = [
      { name: 'mg-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n101,7,alpha,12345678\n102,7,alpha,12345678\n103,8,beta,87654321\n' },
      { name: 'xr-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n201,8,beta,87654321\n' },
      { name: 'hwn-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n301,9,gamma,11112222\n' },
      { name: 'uu-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n401,10,delta,22223333\n' },
      { name: 'ppz-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n501,11,epsilon,33334444\n' }
    ];
    const denied = await app.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: { authorization: `Bearer ${managerToken}` }, payload: { serverId: 'mushroom', file: files[0] } });
    expect(denied.statusCode).toBe(403);
    for (const [serverId, index] of [['mushroom', 0], ['yeti', 1], ['red-snail', 2], ['uu', 3], ['piaopiao-pig', 4]] as const) {
      const imported = await app.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: { authorization: `Bearer ${superToken}` }, payload: { serverId, file: files[index] } });
      expect(imported.statusCode).toBe(201);
      expect(imported.json()).toEqual(expect.objectContaining({ serverId, fileCount: 1 }));
    }

    const result = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=alpha&limit=10', headers: { authorization: `Bearer ${managerToken}` } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ accounts: [expect.objectContaining({ username: 'alpha', bindQQ: '12345678', characterIds: ['101', '102'], server: { id: 'mushroom', displayName: expect.any(String) } })], nextCursor: null, totalCount: 1 });

    const qqSearch = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=87654321&serverId=yeti', headers: { authorization: `Bearer ${superToken}` } });
    expect(qqSearch.statusCode).toBe(200);
    expect(qqSearch.json().accounts[0].username).toBe('beta');
    const customerSearch = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=alpha', headers: { authorization: `Bearer ${customerToken}` } });
    expect(customerSearch.statusCode).toBe(200);

    const replacement = await app.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: { authorization: `Bearer ${superToken}` }, payload: { serverId: 'mushroom', file: { name: 'mg-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n999,99,replaced,99998888\n' } } });
    expect(replacement.statusCode).toBe(201);
    const removed = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=alpha&serverId=mushroom', headers: { authorization: `Bearer ${managerToken}` } });
    expect(removed.json().totalCount).toBe(0);
    const retained = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=beta&serverId=yeti', headers: { authorization: `Bearer ${managerToken}` } });
    expect(retained.json().totalCount).toBe(1);
    await app.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: { authorization: `Bearer ${superToken}` }, payload: { serverId: 'uu', file: { name: 'uu-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n601,10,ten,44445555\n602,2,two,44446666\n' } } });
    const ordered = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?serverId=uu&limit=10', headers: { authorization: `Bearer ${managerToken}` } });
    expect(ordered.json().accounts.map((account: { username: string }) => account.username)).toEqual(['two', 'ten']);
  });

  it('rejects malformed or unsafe directory input', async () => {
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: { authorization: `Bearer ${superToken}` }, payload: { serverId: 'mushroom', file: { name: 'unknown.csv', content: 'a,b\n1,2' } } });
    expect(invalid.statusCode).toBe(400);
    const badQuery = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?limit=99', headers: { authorization: `Bearer ${managerToken}` } });
    expect(badQuery.statusCode).toBe(400);
  });

  it('starts with an empty SQLite directory and accepts an explicit server upload', async () => {
    const databasePath = path.join(os.tmpdir(), `ops-directory-sqlite-${randomUUID()}.sqlite`);
    const sqliteApp = await createApp({ catalogPath, databasePath, initialAdmin: { username: 'sqlite-admin', displayName: 'SQLite Admin', password: 'Admin123' } });
    try {
      const login = await sqliteApp.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'sqlite-admin', password: 'Admin123' } });
      const cookie = String(login.headers['set-cookie']).split(';', 1)[0];
      const response = await sqliteApp.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=8454349452', headers: { cookie } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accounts: [], nextCursor: null, totalCount: 0 });
      const imported = await sqliteApp.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: { cookie }, payload: { serverId: 'mushroom', file: { name: 'mg-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n101,7,alpha,12345678\n102,7,alpha,12345678\n103,8,beta,87654321\n' } } });
      expect(imported.statusCode).toBe(201);
      const emptyOtherServer = await sqliteApp.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=8454349452', headers: { cookie } });
      expect(emptyOtherServer.json()).toEqual({ accounts: [], nextCursor: null, totalCount: 0 });
      const firstPage = await sqliteApp.inject({ method: 'GET', url: '/api/v1/player-directory/search?serverId=mushroom&limit=1', headers: { cookie } });
      expect(firstPage.json().accounts[0].username).toBe('alpha');
      const secondPage = await sqliteApp.inject({ method: 'GET', url: `/api/v1/player-directory/search?serverId=mushroom&limit=1&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`, headers: { cookie } });
      expect(secondPage.json().accounts[0].username).toBe('beta');
    } finally {
      await sqliteApp.close();
      for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${databasePath}${suffix}`)) fs.unlinkSync(`${databasePath}${suffix}`);
    }
  });
});
