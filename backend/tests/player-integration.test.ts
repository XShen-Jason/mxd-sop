import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import type { PlayerIntegrationClient } from '../src/modules/player-integration/public/index.js';

describe('player integration', () => {
  let app: FastifyInstance;
  const dataPath = path.join(os.tmpdir(), `ops-player-integration-${randomUUID()}.json`);
  const usersPath = path.join(os.tmpdir(), `ops-player-integration-users-${randomUUID()}.json`);
  const calls: Array<{ endpoint: string; serverId: string }> = [];
  let failImport = false;
  const client: PlayerIntegrationClient = {
    health: async () => true,
    importAccounts: async (endpoint, _token, serverId) => { if (failImport) throw new Error('player offline'); calls.push({ endpoint, serverId }); return { serverId, rowCount: 1, skippedRows: 0, importedAt: new Date().toISOString() }; }
  };

  beforeAll(async () => {
    const catalogPath = path.resolve(process.cwd(), '..', 'data/item-catalog/source/items.json');
    app = await createApp({ catalogPath, dataPath, usersPath, playerIntegration: { localUrl: 'http://local-player', remoteUrl: 'https://remote-player', serviceToken: 'secret' }, playerIntegrationClient: client, initialAdmin: { username: 'integration-admin', displayName: 'Integration Admin', password: 'Admin123' } });
  });

  afterAll(async () => {
    await app?.close();
    for (const file of [dataPath, usersPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  it('requires super admin confirmation and reports both endpoint health checks', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'integration-admin', password: 'Admin123' } });
    const token = login.json().token as string;
    const status = await app.inject({ method: 'GET', url: '/api/v1/player-integration/status', headers: { authorization: `Bearer ${token}` } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ mode: 'local', endpoints: { local: { configured: true, available: true }, remote: { configured: true, available: true } } });
    const missingConfirmation = await app.inject({ method: 'POST', url: '/api/v1/player-integration/switch', headers: { authorization: `Bearer ${token}` }, payload: { mode: 'remote', confirmation: 'remote' } });
    expect(missingConfirmation.statusCode).toBe(400);
    expect(missingConfirmation.json().error.code).toBe('confirmation-required');
    const switched = await app.inject({ method: 'POST', url: '/api/v1/player-integration/switch', headers: { authorization: `Bearer ${token}` }, payload: { mode: 'remote', confirmation: 'SWITCH PLAYER SERVER' } });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().mode).toBe('remote');
  });

  it('syncs the player before replacing the support directory', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'integration-admin', password: 'Admin123' } });
    const token = login.json().token as string;
    const imported = await app.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: { authorization: `Bearer ${token}` }, payload: { serverId: 'mushroom', file: { name: 'mg-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n101,7,alpha,12345678\n' } } });
    expect(imported.statusCode).toBe(201);
    expect(calls.at(-1)).toMatchObject({ endpoint: 'https://remote-player', serverId: 'mushroom' });
    const search = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=alpha', headers: { authorization: `Bearer ${token}` } });
    expect(search.json().accounts[0].username).toBe('alpha');
  });

  it('does not replace the support directory when player sync fails', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'integration-admin', password: 'Admin123' } });
    const token = login.json().token as string;
    failImport = true;
    const imported = await app.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: { authorization: `Bearer ${token}` }, payload: { serverId: 'yeti', file: { name: 'xr-char-user-qq.csv', content: 'char_id,user_id,username,bindQQ\n201,7,blocked,12345678\n' } } });
    failImport = false;
    expect(imported.statusCode).toBe(503);
    const search = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?q=blocked', headers: { authorization: `Bearer ${token}` } });
    expect(search.json().totalCount).toBe(0);
  });
});
