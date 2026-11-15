import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { HttpAutoIntegrationClient, loadAutoEndpointConfig, type AutoIntegrationClient } from '../src/modules/auto-integration/public/index.js';

describe('external requests cannot assume an internal automation identity', () => {
  let app: FastifyInstance;
  let directory: string;
  const overview = vi.fn(async () => ({ servers: [], sessions: [], logs: [] }));

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-actor-security-'));
    // Even an explicit JSON repository must not enable demo HTTP identities
    // outside the test environment. No real game account or service is contacted.
    app = await createApp({
      dataPath: path.join(directory, 'groups.json'), usersPath: path.join(directory, 'users.json'),
      enableTeamScheduler: false,
      autoIntegration: { serviceToken: 'fixture-security-service-token-32-bytes' },
      autoIntegrationClient: { overview } as unknown as AutoIntegrationClient,
      initialAdmin: { username: 'security-owner', displayName: 'Owner', password: 'OwnerPassword123!' },
    });
  });
  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each(['auto-process', 'super-admin', 'demo-super-admin'])('rejects forged %s headers', async (id) => {
    const headers = { 'x-user-id': id, 'x-user-role': 'super_admin', 'x-ops-actor-id': id };
    for (const url of ['/api/v1/auto/overview', '/api/v1/auth/users']) {
      const response = await app.inject({ url, headers });
      expect(response.statusCode).toBe(401);
    }
    const approve = await app.inject({ method: 'POST', url: '/api/v1/manager/operation-groups/unknown/approve', headers });
    expect(approve.statusCode).toBe(401);
    expect(overview).not.toHaveBeenCalled();
  });

  it('has no password-login record for the internal actor', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'auto-process', password: 'OwnerPassword123!' } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('auto service credentials fail closed', () => {
  it.each(['', 'local-auto-service-token', 'short-secret'])('does not replace or send an unsafe token (%s)', async (token) => {
    const config = loadAutoEndpointConfig({ MXD_AUTO_SERVICE_TOKEN: token });
    expect(config.serviceToken).toBeUndefined();
    const client = new HttpAutoIntegrationClient({ serviceToken: token });
    await expect(client.overview({ id: 'auto-process', role: 'super_admin', displayName: 'Auto' }))
      .rejects.toMatchObject({ code: 'endpoint-not-configured' });
  });
  it('preserves an explicitly supplied long service token', () => {
    const token = 'fixture-security-service-token-32-bytes';
    expect(loadAutoEndpointConfig({ MXD_AUTO_SERVICE_TOKEN: token }).serviceToken).toBe(token);
  });
});
