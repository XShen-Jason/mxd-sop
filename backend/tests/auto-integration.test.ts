import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { HttpAutoIntegrationClient, type AutoAccount, type AutoExecutionResult, type AutoIntegrationClient, type AutoOverview, type AutoServer, type AutoSession } from '../src/modules/auto-integration/public/index.js';

const catalogPath = path.resolve(process.cwd(), '..', 'data/item-catalog/source/items.json');

describe('auto integration boundary', () => {
  let app: FastifyInstance;
  const dataPath = path.join(os.tmpdir(), `ops-auto-integration-${randomUUID()}.json`);
  const usersPath = path.join(os.tmpdir(), `ops-auto-integration-users-${randomUUID()}.json`);
  const calls: Array<{ name: string; actor: string; input?: unknown }> = [];
  let executionStatus: 'success' | 'failure' = 'success';
  let executionFailureReason: AutoExecutionResult['failure_reason'];
  let healthCalls = 0;
  const server: AutoServer = { id: 'fairyland-main', name: 'Fairyland', address: '127.0.0.1:12660', version: '1.0.2', map_id: '211000000', enabled: true, accounts: [] };
  const account: AutoAccount = { id: 'account-1', server_id: server.id, username: 'ops-account', character_id: '265', character_name: 'Galaxy', credential_type: 'md5', enabled: true, status: 'online', updated_at: '2026-09-15T00:00:00Z' };
  const session: AutoSession = { id: 'session-1', server_id: server.id, state: 'logged_in', roles: [{ id: '265', name: 'Galaxy', opaque_available: true }], sent_messages: 0, chat_success_count: 0, chat_failure_count: 0, chat_unknown_count: 0, created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' };
  const record = (name: string, actor: { id: string }, input?: unknown) => calls.push({ name, actor: actor.id, input });
  const client: AutoIntegrationClient = {
    health: async () => { healthCalls += 1; return true; },
    overview: async (actor) => { record('overview', actor); return overview(); },
    startSession: async (actor, serverId, input) => { record('startSession', actor, { serverId, input }); return { ...session, server_id: serverId }; },
    selectAndEnterSession: async (actor, sessionId, characterId) => { record('selectAndEnterSession', actor, { sessionId, characterId }); return { ...session, id: sessionId, state: 'ready', character_id: characterId }; },
    stopSession: async (actor, sessionId) => { record('stopSession', actor, sessionId); },
    createServer: async (actor, input) => { record('createServer', actor, input); return { ...server, ...input, id: input.id ?? server.id, accounts: [] }; },
    updateServer: async (actor, id, input) => { record('updateServer', actor, { id, input }); return { ...server, ...input, id, accounts: [] }; },
    deleteServer: async (actor, id) => { record('deleteServer', actor, id); },
    createAccount: async (actor, serverId, input) => { record('createAccount', actor, { serverId, input }); return { ...account, server_id: serverId }; },
    updateAccount: async (actor, serverId, id, input) => { record('updateAccount', actor, { serverId, id, input: withoutPassword(input) }); return { ...account, ...withoutPassword(input), server_id: serverId, id }; },
    deleteAccount: async (actor, serverId, id) => { record('deleteAccount', actor, { serverId, id }); },
    startAccount: async (actor, serverId, id) => { record('startAccount', actor, { serverId, id }); return { ...account, server_id: serverId, id, status: 'connecting' }; },
    stopAccount: async (actor, serverId, id) => { record('stopAccount', actor, { serverId, id }); return { ...account, server_id: serverId, id, enabled: false, status: 'disabled' }; },
    reconnectAccount: async (actor, serverId, id) => { record('reconnectAccount', actor, { serverId, id }); return { ...account, server_id: serverId, id, status: 'reconnecting' }; },
    sendMessage: async (actor, serverId, id, input) => { record('sendMessage', actor, { serverId, id, input }); return { result: { status: 'server_response_received', message: 'accepted', delivery_status: 'success' }, account: { ...account, server_id: serverId, id } }; },
    execute: async (actor, serverId, input) => { record('execute', actor, { serverId, input }); return { execution_id: input.execution_id, status: executionStatus, attempts: input.retry ? 2 : 1, failure_reason: executionFailureReason, commands: input.commands.map((command) => ({ ...command, status: executionStatus })) }; },
  };

  beforeAll(async () => {
    app = await createApp({ catalogPath, dataPath, usersPath, autoIntegration: { localUrl: 'http://auto.internal:26909', serviceToken: 'integration-token' }, autoIntegrationClient: client, initialAdmin: { username: 'integration-admin', displayName: 'Integration Admin', password: 'Admin12345!' } });
  });

  afterAll(async () => {
    await app?.close();
    for (const file of [dataPath, usersPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  it('forwards status, CRUD, lifecycle, and chat calls to auto with the actor', async () => {
    const token = await login('integration-admin', 'Admin12345!');
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'GET', url: '/api/v1/auto/status', headers })).json()).toMatchObject({ configured: true, available: true });
    expect((await app.inject({ method: 'GET', url: '/api/v1/auto/overview', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/auto/servers/${server.id}/sessions`, headers, payload: { account: 'ops-account', password: '5AA765D61D8327DE', credential_type: 'md5' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auto/sessions/session-1/select-and-enter', headers, payload: { character_id: '265' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/auto/sessions/session-1', headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auto/servers', headers, payload: { id: server.id, name: server.name, address: server.address, version: server.version, map_id: server.map_id, enabled: server.enabled } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/auto/servers/${server.id}`, headers, payload: { address: '127.0.0.1:12661' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/auto/servers/${server.id}/accounts`, headers, payload: { username: account.username, password: '5AA765D61D8327DE', credential_type: 'md5', character_id: account.character_id, character_name: account.character_name, enabled: true } })).statusCode).toBe(201);
    const edited = await app.inject({ method: 'PATCH', url: `/api/v1/auto/servers/${server.id}/accounts/${account.id}`, headers, payload: { username: 'edited-account', password: 'new-account-secret', character_id: '266' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.body).not.toContain('new-account-secret');
    expect(calls.find((call) => call.name === 'startSession')?.input).toMatchObject({ input: { password: '5AA765D61D8327DE', credential_type: 'md5' } });
    expect(calls.find((call) => call.name === 'createAccount')?.input).toMatchObject({ input: { password: '5AA765D61D8327DE', credential_type: 'md5' } });
    for (const action of ['start', 'stop', 'reconnect'] as const) expect((await app.inject({ method: 'POST', url: `/api/v1/auto/servers/${server.id}/accounts/${account.id}/${action}`, headers, payload: {} })).statusCode).toBe(200);
    const message = await app.inject({ method: 'POST', url: `/api/v1/auto/servers/${server.id}/accounts/${account.id}/message`, headers, payload: { message: 'hello', mode: 'world' } });
    expect(message.statusCode).toBe(200);
    expect(message.json()).toMatchObject({ auto_process: { status: 'success' } });
    expect(message.json().auto_process.latency_ms).toBeGreaterThanOrEqual(0);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/auto/servers/${server.id}/accounts/${account.id}`, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/auto/servers/${server.id}`, headers })).statusCode).toBe(204);
    expect(calls.every((call) => call.actor.length > 0)).toBe(true);
    expect(calls.map((call) => call.name)).toEqual([
      'overview', 'startSession', 'selectAndEnterSession', 'stopSession', 'createServer', 'updateServer', 'createAccount', 'updateAccount', 'startAccount', 'stopAccount', 'reconnectAccount', 'sendMessage', 'deleteAccount', 'deleteServer',
    ]);
  });

  it('enforces the server-operations permission before calling auto', async () => {
    const adminToken = await login('integration-admin', 'Admin12345!');
    const created = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${adminToken}` }, payload: { username: 'no-auto-access', displayName: 'No Auto Access', password: 'NoAutoPass1!', role: 'customer' } });
    expect(created.statusCode).toBe(201);
    const token = await login('no-auto-access', 'NoAutoPass1!');
    const before = calls.length;
    const response = await app.inject({ method: 'GET', url: '/api/v1/auto/overview', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    expect(calls.length).toBe(before);
  });

  it('does not health-check or forward requests while the auto connection is disabled', async () => {
    const token = await login('integration-admin', 'Admin12345!');
    const headers = { authorization: `Bearer ${token}` };
    const rejected = await app.inject({ method: 'POST', url: '/api/v1/auto/connection', headers, payload: { enabled: false, confirmation: 'DISCONNECT' } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('confirmation-required');
    const disabled = await app.inject({ method: 'POST', url: '/api/v1/auto/connection', headers, payload: { enabled: false, confirmation: 'CHANGE AUTO CONNECTION' } });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().enabled).toBe(false);

    const healthBeforeStatus = healthCalls;
    const status = await app.inject({ method: 'GET', url: '/api/v1/auto/status', headers });
    expect(status.json()).toMatchObject({ enabled: false, configured: true, available: null });
    expect(healthCalls).toBe(healthBeforeStatus);

    const callsBeforeOverview = calls.length;
    const overviewResponse = await app.inject({ method: 'GET', url: '/api/v1/auto/overview', headers });
    expect(overviewResponse.statusCode).toBe(503);
    expect(overviewResponse.json().error.code).toBe('connection-disabled');
    expect(calls).toHaveLength(callsBeforeOverview);

    const healthBeforeEnable = healthCalls;
    const enabled = await app.inject({ method: 'POST', url: '/api/v1/auto/connection', headers, payload: { enabled: true, confirmation: 'CHANGE AUTO CONNECTION' } });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().enabled).toBe(true);
    expect(healthCalls).toBe(healthBeforeEnable + 1);
  });

  it('falls back to the manual workflow while auto is disconnected', async () => {
    const token = await login('integration-admin', 'Admin12345!');
    const headers = { authorization: `Bearer ${token}` };
    const connection = async (enabled: boolean) => app.inject({
      method: 'POST', url: '/api/v1/auto/connection', headers,
      payload: { enabled, confirmation: 'CHANGE AUTO CONNECTION' },
    });
    expect((await connection(false)).statusCode).toBe(200);

    try {
      const executionsBefore = calls.filter((call) => call.name === 'execute').length;
      const issuance = await app.inject({
        method: 'POST', url: '/api/v1/operation-groups', headers,
        payload: { serverId: 'mushroom', account: 'manual-player', characterId: '507', playerQQ: '1', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] },
      });
      const approved = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${issuance.json().id}/approve`, headers });
      expect(approved.statusCode).toBe(200);
      expect(approved.json()).toMatchObject({ status: 'approved', commands: [{ text: expect.any(String) }] });
      expect(approved.json()).not.toHaveProperty('automationFailureReason');

      const online = await app.inject({ method: 'POST', url: `/api/v1/operation-groups/${issuance.json().id}/online`, headers });
      expect(online.json().status).toBe('approved');
      expect(online.json()).not.toHaveProperty('automationFailureReason');

      const regular = await app.inject({
        method: 'POST', url: '/api/v1/operation-groups', headers,
        payload: { serverId: 'mushroom', characterId: '508', reason: { code: 'corpse' }, operations: [{ type: 'kick' }] },
      });
      expect(regular.statusCode).toBe(201);
      expect(regular.json().status).toBe('approved');
      expect(regular.json()).not.toHaveProperty('automationFailureReason');
      expect(calls.filter((call) => call.name === 'execute')).toHaveLength(executionsBefore);

      expect((await connection(true)).statusCode).toBe(200);
      expect(calls.filter((call) => call.name === 'execute')).toHaveLength(executionsBefore);

      const issued = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${issuance.json().id}/issue`, headers, payload: {} });
      const completed = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${regular.json().id}/complete`, headers, payload: {} });
      expect(issued.json().status).toBe('issued');
      expect(completed.json().status).toBe('completed');
    } finally {
      const status = await app.inject({ method: 'GET', url: '/api/v1/auto/status', headers });
      if (!status.json().enabled) await connection(true);
    }
  });

  it('automatically executes approved commands and retries a failed group after the owner reports online', async () => {
    const token = await login('integration-admin', 'Admin12345!');
    const headers = { authorization: `Bearer ${token}` };
    const submit = async (characterId: string) => app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers, payload: { serverId: 'mushroom', account: 'player', characterId, playerQQ: '1', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] } });

    executionStatus = 'success';
    const successful = await submit('501');
    const approved = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${successful.json().id}/approve`, headers });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('issued');

    executionStatus = 'failure';
    const failed = await submit('502');
    const failedApproval = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${failed.json().id}/approve`, headers });
    expect(failedApproval.json()).toMatchObject({ status: 'approved', reminderCount: 1 });
    const stillOffline = await app.inject({ method: 'POST', url: `/api/v1/operation-groups/${failed.json().id}/online`, headers });
    expect(stillOffline.json()).toMatchObject({ status: 'approved', reminderCount: 1 });
    executionStatus = 'success';
    const retried = await app.inject({ method: 'POST', url: `/api/v1/operation-groups/${failed.json().id}/online`, headers });
    expect(retried.json().status).toBe('issued');
    const executions = calls.filter((call) => call.name === 'execute').slice(-4);
    expect(executions.map((call) => (call.input as { input: { retry?: boolean } }).input.retry ?? false)).toEqual([false, false, true, true]);
  });

  it('keeps the legacy confirm endpoint connected to auto execution', async () => {
    const token = await login('integration-admin', 'Admin12345!');
    const headers = { authorization: `Bearer ${token}` };
    executionStatus = 'success';
    const submit = await app.inject({
      method: 'POST', url: '/api/v1/operation-groups', headers,
      payload: { serverId: 'mushroom', account: 'player', characterId: '503', playerQQ: '1', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] },
    });
    expect(submit.statusCode).toBe(201);
    const before = calls.filter((call) => call.name === 'execute').length;
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${submit.json().id}/confirm`, headers });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe('issued');
    expect(calls.filter((call) => call.name === 'execute').length).toBe(before + 1);
  });

  it('uses a new auto execution identity after a group is edited', async () => {
    const token = await login('integration-admin', 'Admin12345!');
    const headers = { authorization: `Bearer ${token}` };
    const submit = await app.inject({
      method: 'POST', url: '/api/v1/operation-groups', headers,
      payload: { serverId: 'mushroom', account: 'player', characterId: '504', playerQQ: '1', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] },
    });
    expect(submit.statusCode).toBe(201);
    executionStatus = 'failure';
    const firstApproval = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${submit.json().id}/approve`, headers });
    expect(firstApproval.json()).toMatchObject({ status: 'approved', reminderCount: 1 });
    const edited = await app.inject({
      method: 'PUT', url: `/api/v1/operation-groups/${submit.json().id}`, headers,
      payload: { serverId: 'yeti', account: 'edited-player', characterId: '505', playerQQ: '2', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 2 }] },
    });
    expect(edited.statusCode).toBe(200);
    executionStatus = 'failure';
    const secondApproval = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${submit.json().id}/approve`, headers });
    expect(secondApproval.json()).toMatchObject({ status: 'approved', reminderCount: 1 });
    const failedExecutions = calls.filter((call) => call.name === 'execute').slice(-2);
    expect((failedExecutions[0].input as { input: { execution_id: string } }).input.execution_id).toBe(submit.json().id);
    const revisionId = (failedExecutions[1].input as { input: { execution_id: string } }).input.execution_id;
    expect(revisionId).toMatch(new RegExp(`^${submit.json().id}:revision-`));

    executionStatus = 'success';
    const retried = await app.inject({ method: 'POST', url: `/api/v1/operation-groups/${submit.json().id}/online`, headers });
    expect(retried.json().status).toBe('issued');
    const onlineRetry = calls.filter((call) => call.name === 'execute').at(-1);
    expect((onlineRetry?.input as { input: { execution_id: string; retry?: boolean } }).input).toMatchObject({ execution_id: revisionId, retry: true });
  });

  it('surfaces the no-online-GM reason instead of a generic automation failure', async () => {
    const token = await login('integration-admin', 'Admin12345!');
    const headers = { authorization: `Bearer ${token}` };
    executionStatus = 'failure';
    executionFailureReason = 'no_online_accounts';
    const submit = await app.inject({
      method: 'POST', url: '/api/v1/operation-groups', headers,
      payload: { serverId: 'mushroom', account: 'player', characterId: '506', playerQQ: '1', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] },
    });
    const approved = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${submit.json().id}/approve`, headers });
    expect(approved.json()).toMatchObject({ status: 'approved', reminderCount: 1, automationFailureReason: 'no-online-accounts' });
    executionStatus = 'success';
    executionFailureReason = undefined;
  });

  function overview(): AutoOverview {
    return { fetched_at: new Date().toISOString(), servers: [{ ...server, accounts: [{ ...account }] }], sessions: [], logs: [] };
  }

  async function login(username: string, password: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
    expect(response.statusCode).toBe(200);
    return response.json().token as string;
  }
});

describe('auto HTTP client deployment boundary', () => {
  let server: Server | undefined;

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  });

  it('uses the configured URL and service token without sharing auto internals', async () => {
    const requests: Array<{ path: string; authorization: string; actor: string }> = [];
    server = createServer((request, response) => {
      requests.push({ path: request.url ?? '', authorization: request.headers.authorization ?? '', actor: String(request.headers['x-ops-actor-id'] ?? '') });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ fetched_at: new Date().toISOString(), servers: [], sessions: [], logs: [] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not expose a port');
    const client = new HttpAutoIntegrationClient({ localUrl: `http://127.0.0.1:${address.port}`, serviceToken: 'separate-deployment-token' });
    await client.overview({ id: 'operator-1', role: 'super_admin', displayName: 'Operator' });
    expect(requests).toEqual([{ path: '/api/v1/overview?include_logs=false', authorization: 'Bearer separate-deployment-token', actor: 'operator-1' }]);
  });
});

function withoutPassword(input: Record<string, unknown>) {
  const { password: _password, ...safe } = input;
  return safe;
}
