import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AutoIntegrationClient, AutoServer } from '../src/modules/auto-integration/public/index.js';
import { ServerOptionsProjection } from '../src/modules/auto-integration/domain/server-options.js';

const catalogPath = path.resolve(process.cwd(), '..', 'data/item-catalog/source/items.json');

describe('SOP server options', () => {
  it('publishes authorized server changes to SOP consumers and retains them after restart', async () => {
    const databasePath = path.join(os.tmpdir(), `ops-server-options-${randomUUID()}.sqlite`);
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    const remote: AutoServer[] = [];
    let reads = 0;
    const client = {
      listServers: async () => { reads += 1; return remote.map(({ id, name }) => ({ id, name })); },
      createServer: async (_actor: unknown, input: AutoServer) => {
        const server = { ...input, accounts: [] } as AutoServer;
        remote.push(server);
        return server;
      },
      updateServer: async (_actor: unknown, id: string, input: Partial<AutoServer>) => {
        const server = remote.find(item => item.id === id)!;
        Object.assign(server, input);
        return server;
      },
    } as unknown as AutoIntegrationClient;
    const config = { databasePath, catalogPath, autoIntegration: { localUrl: 'http://auto.internal:26909', serviceToken: 'integration-token' }, autoIntegrationClient: client };
    try {
      app = await createApp({ ...config, initialAdmin: { username: 'server-admin', displayName: 'Server Admin', password: 'Admin12345!' } });
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'server-admin', password: 'Admin12345!' } });
      const headers = { cookie: String(login.headers['set-cookie']).split(';', 1)[0] };
      const created = await app.inject({ method: 'POST', url: '/api/v1/auto/servers', headers, payload: {
        id: 'new-world', name: '新区', address: '127.0.0.1:12660', version: '1.0.3', map_id: '211000000', enabled: true,
      } });
      expect(created.statusCode).toBe(201);
      const options = await app.inject({ method: 'GET', url: '/api/v1/operation-groups/options', headers });
      expect(options.json().servers).toContainEqual({ id: 'new-world', displayName: '新区' });
      expect(options.json().servers).toContainEqual({ id: 'mushroom', displayName: '蘑菇' });

      const group = await app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers, payload: {
        serverId: 'new-world', characterId: '123', reason: { code: 'corpse' }, operations: [{ type: 'kick' }],
      } });
      expect(group.statusCode).toBe(201);
      expect(group.json().server).toEqual({ id: 'new-world', displayName: '新区' });
      const directory = await app.inject({ method: 'GET', url: '/api/v1/player-directory/search?serverId=new-world', headers });
      expect(directory.statusCode).toBe(200);
      const team = await app.inject({ method: 'GET', url: '/api/v1/team-view?date=2026-10-10', headers });
      expect(team.statusCode).toBe(200);
      expect(team.json().servers).toContainEqual(expect.objectContaining({ server: { id: 'new-world', displayName: '新区' } }));

      const user = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers, payload: {
        username: 'server-reader', displayName: 'Reader', password: 'Reader12345!', role: 'customer',
      } });
      expect(user.statusCode).toBe(201);
      const readerLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'server-reader', password: 'Reader12345!' } });
      const readerHeaders = { cookie: String(readerLogin.headers['set-cookie']).split(';', 1)[0] };
      expect((await app.inject({ method: 'GET', url: '/api/v1/operation-groups/options', headers: readerHeaders })).json().servers)
        .toContainEqual({ id: 'new-world', displayName: '新区' });
      expect((await app.inject({ method: 'POST', url: '/api/v1/auto/servers', headers: readerHeaders, payload: {
        id: 'forbidden', name: 'Forbidden', address: '127.0.0.1:12660', map_id: '211000000',
      } })).statusCode).toBe(403);

      const renamed = await app.inject({ method: 'PATCH', url: '/api/v1/auto/servers/new-world', headers, payload: { name: '新区二' } });
      expect(renamed.statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/v1/operation-groups/options', headers })).json().servers)
        .toContainEqual({ id: 'new-world', displayName: '新区二' });
      expect((await app.inject({ method: 'POST', url: '/api/v1/auto/connection', headers,
        payload: { enabled: false, confirmation: 'CHANGE AUTO CONNECTION' } })).statusCode).toBe(200);
      const readsBeforeOffline = reads;
      await app.close();
      app = await createApp(config);
      const offline = await app.inject({ method: 'GET', url: '/api/v1/operation-groups/options', headers });
      expect(offline.json().servers).toContainEqual({ id: 'new-world', displayName: '新区二' });
      expect(reads).toBe(readsBeforeOffline);
    } finally {
      await app?.close();
      for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${databasePath}${suffix}`)) fs.unlinkSync(`${databasePath}${suffix}`);
    }
  });

  it('coalesces simultaneous catalog reads and preserves a successful mutation over an older read', async () => {
    const projection = new ServerOptionsProjection([]);
    let resolve!: (servers: { id: string; name: string }[]) => void;
    let reads = 0;
    const read = () => { reads += 1; return new Promise<{ id: string; name: string }[]>(done => { resolve = done; }); };
    const first = projection.refresh(read);
    const second = projection.refresh(read);
    expect(reads).toBe(1);
    projection.merge([{ id: 'new-world', name: '新名称' }]);
    resolve([{ id: 'new-world', name: '旧名称' }]);
    await Promise.all([first, second]);
    expect(projection.servers).toEqual([{ id: 'new-world', displayName: '新名称' }]);
  });
});
