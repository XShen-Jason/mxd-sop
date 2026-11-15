import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';

describe('potential login remote error boundary', () => {
  let app: FastifyInstance;
  let remote: Server;
  let directory: string;
  let token: string;
  let responseBody: unknown;
  let requests = 0;

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-login-errors-'));
    remote = createServer((request, response) => {
      request.resume();
      requests += 1;
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify(responseBody));
    });
    await new Promise<void>((resolve) => remote.listen(0, '127.0.0.1', resolve));
    const address = remote.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    app = await createApp({
      catalogPath: path.resolve('..', 'data/item-catalog/source/items.json'),
      dataPath: path.join(directory, 'groups.json'), usersPath: path.join(directory, 'users.json'),
      enableTeamScheduler: false,
      autoIntegration: { localUrl: `http://127.0.0.1:${address.port}`, serviceToken: 'fixture-service-token-at-least-32-bytes' },
      initialAdmin: { username: 'error-admin', displayName: 'Error Admin', password: 'Admin12345!' },
    });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'error-admin', password: 'Admin12345!' } });
    expect(login.statusCode).toBe(200);
    token = login.json().token;
  });

  afterAll(async () => {
    await app?.close();
    if (remote) await new Promise<void>((resolve, reject) => remote.close((error) => error ? reject(error) : resolve()));
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ['/api/v1/auto/servers/local/sessions', { account: 'fixture-account', password: 'fixture-password' }, '账号登录', 0],
    ['/api/v1/auto/sessions/session-1/select-and-enter', { character_id: '265' }, '角色选择', 6],
  ] as const)('preserves diagnostics through %s without retrying', async (url, payload, stage, op) => {
    const message = `游戏服务器拒绝了${stage}（op=${op}，rc=42）。`;
    responseBody = { error: 'remote_error', message };
    const before = requests;
    const response = await app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${token}` } });
    expect(response.json()).toEqual({ error: { code: 'remote_error', message } });
    expect(response.statusCode).toBe(502);
    expect(requests - before).toBe(1);
    expect(response.body).not.toContain('fixture-password');
    expect(response.body).not.toContain('fixture-service-token-at-least-32-bytes');
  });

  it('explains legacy auto responses without inventing a return code', async () => {
    responseBody = { error: 'remote_error' };
    const response = await app.inject({ method: 'POST', url: '/api/v1/auto/servers/local/sessions',
      payload: { account: 'fixture-account', password: 'fixture-password' }, headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('remote_error');
    expect(response.json().error.message).toContain('游戏服务器拒绝');
    expect(response.json().error.message).toContain('日志');
    expect(response.json().error.message).not.toContain('rc=');
  });
});
