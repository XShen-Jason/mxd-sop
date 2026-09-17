import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { JsonUserRepository } from '../src/modules/auth/public/index.js';
import type { UploadPermissions, WorkspacePermissions } from '../src/shared/types.js';

const dataPath = path.join(os.tmpdir(), `ops-workspace-permissions-${randomUUID()}.json`);
const usersPath = path.join(os.tmpdir(), `ops-workspace-permissions-users-${randomUUID()}.json`);
const legacyUsersPath = path.join(os.tmpdir(), `ops-legacy-users-${randomUUID()}.json`);
const catalogDir = fs.existsSync(path.resolve(process.cwd(), 'data/item-catalog/source'))
  ? path.resolve(process.cwd(), 'data/item-catalog/source')
  : path.resolve(process.cwd(), '..', 'data/item-catalog/source');
const catalogPath = path.join(catalogDir, fs.readdirSync(catalogDir).find((name) => name.endsWith('.csv'))!);

describe('workspace permissions', () => {
  let app: FastifyInstance;
  let superToken = '';
  let managerToken = '';
  let customerToken = '';
  let customerId = '';

  beforeAll(async () => {
    app = await createApp({
      catalogPath,
      dataPath,
      usersPath,
      initialAdmin: { username: 'workspace-admin', displayName: 'Workspace Admin', password: 'AdminPass1!' }
    });
    superToken = await login('workspace-admin', 'AdminPass1!');
    await createUser(superToken, { username: 'workspace-manager', displayName: 'Workspace Manager', password: 'ManagerPass1!', role: 'manager' });
    customerId = (await createUser(superToken, { username: 'workspace-customer', displayName: 'Workspace Customer', password: 'CustomerPass1!', role: 'customer' })).id;
    managerToken = await login('workspace-manager', 'ManagerPass1!');
    customerToken = await login('workspace-customer', 'CustomerPass1!');
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const file of [dataPath, usersPath, legacyUsersPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  it('returns default workspaces and customer projections', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(customerToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().workspacePermissions).toMatchObject({ request: true, records: true, reminders: true, queue: false, ready: false, reissue: false, archive: false });
    expect(me.json()).not.toHaveProperty('tabPermissions');

    const issuance = await app.inject({
      method: 'POST',
      url: '/api/v1/operation-groups',
      headers: auth(customerToken),
      payload: { serverId: 'mushroom', account: 'item-player', playerQQ: '101', characterId: '1001', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] }
    });
    const regular = await app.inject({
      method: 'POST',
      url: '/api/v1/operation-groups',
      headers: auth(customerToken),
      payload: { serverId: 'mushroom', characterId: '1002', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] }
    });
    expect(issuance.statusCode).toBe(201);
    expect(regular.statusCode).toBe(201);

    const ownRecords = await app.inject({ method: 'GET', url: '/api/v1/operation-groups/mine', headers: auth(customerToken) });
    expect(ownRecords.statusCode).toBe(200);
    expect(ownRecords.json().groups.map((group: { id: string }) => group.id)).toEqual(expect.arrayContaining([issuance.json().id, regular.json().id]));
    expect(ownRecords.body).not.toContain('commands');
  });

  it('lets every accounts workspace holder maintain workspace assignments', async () => {
    const created = await createUser(superToken, { username: 'workspace-restricted', displayName: 'Restricted', password: 'CustomerPass1!', role: 'customer', workspacePermissions: { archive: true, reissue: true } });
    const managerUpdate = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${created.id}`, headers: auth(managerToken), payload: { workspacePermissions: { archive: false } } });
    expect(managerUpdate.statusCode).toBe(200);
    expect(managerUpdate.json().workspacePermissions).toMatchObject({ archive: false, reissue: true });
    expect(managerUpdate.json()).not.toHaveProperty('tabPermissions');

    const restrictedToken = await login('workspace-restricted', 'CustomerPass1!');
    expect((await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?kind=issuance', headers: auth(restrictedToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?kind=regular', headers: auth(restrictedToken) })).statusCode).toBe(403);

    const restoreArchive = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${created.id}`, headers: auth(superToken), payload: { workspacePermissions: { archive: true, reissue: false } } });
    expect(restoreArchive.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?kind=issuance', headers: auth(restrictedToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?kind=regular', headers: auth(restrictedToken) })).statusCode).toBe(200);

    const disableRecords = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${created.id}`, headers: auth(superToken), payload: { workspacePermissions: { records: false } } });
    expect(disableRecords.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/operation-groups/mine', headers: auth(restrictedToken) })).statusCode).toBe(403);
  });

  it('migrates old request fields at the HTTP boundary without returning them', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/users',
      headers: auth(superToken),
      payload: { username: 'legacy-request-user', displayName: 'Legacy Request', password: 'CustomerPass1!', role: 'customer', tabPermissions: { ready: true, activities: true } }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().workspacePermissions).toMatchObject({ ready: true, activities: true });
    expect(created.json()).not.toHaveProperty('tabPermissions');

    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${created.json().id}`, headers: auth(superToken), payload: { tabPermissions: { ready: false } } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().workspacePermissions).toMatchObject({ ready: false, activities: true });
    expect(updated.json()).not.toHaveProperty('tabPermissions');
  });

  it('rejects null workspace permission maps', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: auth(superToken), payload: { username: 'null-workspace-create', displayName: 'Null Create', password: 'CustomerPass1!', role: 'customer', workspacePermissions: null } });
    expect(create.statusCode).toBe(400);
    const users = await app.inject({ method: 'GET', url: '/api/v1/auth/users', headers: auth(superToken) });
    const target = users.json().users.find((user: { username: string }) => user.username === 'workspace-customer');
    const update = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${target.id}`, headers: auth(superToken), payload: { workspacePermissions: null } });
    expect(update.statusCode).toBe(400);
  });

  it('gives a customer the same management projection and actions after queue and ready grants', async () => {
    const created = await createUser(superToken, { username: 'workflow-customer', displayName: 'Workflow Customer', password: 'CustomerPass1!', role: 'customer', workspacePermissions: { queue: true, ready: true, reissue: false, archive: false } });
    const workflowToken = await login('workflow-customer', 'CustomerPass1!');
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/v1/operation-groups',
      headers: auth(customerToken),
      payload: { serverId: 'mushroom', account: 'workflow-player', playerQQ: '102', characterId: '1003', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] }
    });
    const groupId = submitted.json().id as string;
    const queue = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/queue', headers: auth(workflowToken) });
    const superQueue = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/queue', headers: auth(superToken) });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().groups.find((group: { id: string }) => group.id === groupId)).toEqual(superQueue.json().groups.find((group: { id: string }) => group.id === groupId));

    const approved = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${groupId}/approve`, headers: auth(workflowToken) });
    expect(approved.statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?status=approved', headers: auth(workflowToken) });
    const superReady = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?status=approved', headers: auth(superToken) });
    const workflowGroup = ready.json().groups.find((group: { id: string }) => group.id === groupId);
    const superGroup = superReady.json().groups.find((group: { id: string }) => group.id === groupId);
    expect(workflowGroup).toHaveProperty('commands');
    expect(workflowGroup).toEqual(superGroup);
    expect((await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${groupId}/issue`, headers: auth(workflowToken) })).json().status).toBe('issued');

    const regular = await app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers: auth(customerToken), payload: { serverId: 'mushroom', characterId: '1004', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] } });
    const regularId = regular.json().id as string;
    const reminder = await app.inject({ method: 'POST', url: `/api/v1/operation-groups/${regularId}/remind`, headers: auth(workflowToken) });
    expect(reminder.statusCode).toBe(200);
    expect(reminder.json().reminderCount).toBe(1);
    const completed = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${regularId}/complete`, headers: auth(workflowToken), payload: {} });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe('completed');

    const rejected = await app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers: auth(customerToken), payload: { serverId: 'mushroom', account: 'reject-player', playerQQ: '103', characterId: '1005', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] } });
    const rejectedResult = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${rejected.json().id}/reject`, headers: auth(workflowToken), payload: {} });
    expect(rejectedResult.statusCode).toBe(200);
    expect(rejectedResult.json().status).toBe('rejected');

    const disabled = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${created.id}`, headers: auth(superToken), payload: { workspacePermissions: { queue: false, ready: false } } });
    expect(disabled.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/queue', headers: auth(workflowToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?status=approved', headers: auth(workflowToken) })).statusCode).toBe(403);
  });

  it('keeps the ready workspace independent from history workspaces', async () => {
    const created = await createUser(superToken, { username: 'ready-only-user', displayName: 'Ready Only', password: 'SuperPass1!', role: 'super_admin', workspacePermissions: { ready: true, reissue: false, archive: false } });
    const readyToken = await login('ready-only-user', 'SuperPass1!');
    expect((await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?status=approved', headers: auth(readyToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?status=rejected', headers: auth(readyToken) })).statusCode).toBe(403);
    expect(created.id).toBeTruthy();
  });

  it('requires request or activities workspace for shared activity reads', async () => {
    await createUser(superToken, { username: 'no-activity-read', displayName: 'No Activity Read', password: 'CustomerPass1!', role: 'customer', workspacePermissions: { request: false, activities: false } });
    await createUser(superToken, { username: 'request-activity-read', displayName: 'Request Activity Read', password: 'CustomerPass1!', role: 'customer', workspacePermissions: { activities: false } });
    await createUser(superToken, { username: 'activity-read', displayName: 'Activity Read', password: 'CustomerPass1!', role: 'customer', workspacePermissions: { request: false, activities: true } });
    const deniedToken = await login('no-activity-read', 'CustomerPass1!');
    const requestToken = await login('request-activity-read', 'CustomerPass1!');
    const activityToken = await login('activity-read', 'CustomerPass1!');
    expect((await app.inject({ method: 'GET', url: '/api/v1/activities', headers: auth(deniedToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/activities', headers: auth(requestToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/activities', headers: auth(activityToken) })).statusCode).toBe(200);
  });

  it('keeps upload permissions independent from readable workspaces', async () => {
    const restricted = await app.inject({
      method: 'PATCH', url: `/api/v1/auth/users/${customerId}`, headers: auth(superToken),
      payload: {
        workspacePermissions: { 'player-directory': true, 'team-view': true, activities: true },
        uploadPermissions: { 'player-directory': false, 'team-view': false, 'item-catalog': false }
      }
    });
    expect(restricted.statusCode).toBe(200);
    expect(restricted.json().uploadPermissions).toEqual({ 'player-directory': false, 'team-view': false, 'item-catalog': false });
    const token = customerToken;
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().uploadPermissions).toEqual({ 'player-directory': false, 'team-view': false, 'item-catalog': false });

    expect((await app.inject({ method: 'GET', url: '/api/v1/player-directory/search', headers: auth(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/team-view', headers: auth(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/activities', headers: auth(token) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/item-catalog/search?q=test&limit=1', headers: auth(token) })).statusCode).toBe(200);

    const emptyFile = { name: 'upload.csv', content: '' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/player-directory/import', headers: auth(token), payload: { serverId: 'mushroom', file: emptyFile } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/team-view/clears/import', headers: auth(token), payload: { serverId: 'mushroom', file: emptyFile } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/item-catalog/import', headers: auth(token), payload: { file: emptyFile } })).statusCode).toBe(403);

    const enabled = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${customerId}`, headers: auth(superToken), payload: { uploadPermissions: { 'item-catalog': true } } });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().uploadPermissions).toEqual({ 'player-directory': false, 'team-view': false, 'item-catalog': true });
    const persistedUsers = JSON.parse(fs.readFileSync(usersPath, 'utf8')) as Array<{ id: string; uploadPermissions?: UploadPermissions }>;
    expect(persistedUsers.find((user) => user.id === customerId)?.uploadPermissions).toEqual(enabled.json().uploadPermissions);
  });

  it('gives an accounts customer the same directory and full account controls', async () => {
    const accountCustomer = await createUser(superToken, { username: 'account-customer', displayName: 'Account Customer', password: 'CustomerPass1!', role: 'customer', workspacePermissions: { accounts: true, 'server-operations': true } });
    const accountToken = await login('account-customer', 'CustomerPass1!');
    const superUsers = await app.inject({ method: 'GET', url: '/api/v1/auth/users', headers: auth(superToken) });
    const accountUsers = await app.inject({ method: 'GET', url: '/api/v1/auth/users', headers: auth(accountToken) });
    expect(accountUsers.statusCode).toBe(200);
    expect(accountUsers.json()).toEqual(superUsers.json());

    const managed = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: auth(accountToken), payload: { username: 'account-created', displayName: 'Account Created', password: 'CreatedPass1!', role: 'manager', workspacePermissions: { ready: true } } });
    expect(managed.statusCode).toBe(201);
    const edited = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${managed.json().id}`, headers: auth(accountToken), payload: { displayName: 'Account Edited', workspacePermissions: { ready: true, queue: true } } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().workspacePermissions).toMatchObject({ ready: true, queue: true });
    const disabled = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${managed.json().id}`, headers: auth(accountToken), payload: { active: false } });
    expect(disabled.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/auth/users/${managed.json().id}/delete`, headers: auth(accountToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/player-integration/status', headers: auth(accountToken) })).statusCode).toBe(200);
    expect(accountCustomer.id).toBeTruthy();
  });

  async function createUser(token: string, input: { username: string; displayName: string; password: string; role: 'customer' | 'manager' | 'super_admin'; workspacePermissions?: Partial<WorkspacePermissions>; uploadPermissions?: Partial<UploadPermissions> }) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: auth(token), payload: input });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; uploadPermissions: UploadPermissions };
  }

  async function login(username: string, password: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().token as string;
  }
});

describe('workspace permission migration', () => {
  afterAll(() => { if (fs.existsSync(legacyUsersPath)) fs.unlinkSync(legacyUsersPath); });

  it('rewrites legacy JSON permissions to the canonical field', () => {
    fs.writeFileSync(legacyUsersPath, JSON.stringify([{
      id: 'legacy-user', username: 'legacy-user', displayName: 'Legacy User', role: 'customer',
      tabPermissions: { ready: true }, passwordHash: 'scrypt$legacy', active: true, createdAt: '2026-01-01T00:00:00Z'
    }]));
    const repository = new JsonUserRepository(legacyUsersPath);
    expect(repository.findById('legacy-user')).toMatchObject({ workspacePermissions: { ready: true } });
    const saved = JSON.parse(fs.readFileSync(legacyUsersPath, 'utf8')) as Array<Record<string, unknown>>;
    expect(saved[0]).toHaveProperty('workspacePermissions', { ready: true });
    expect(saved[0]).not.toHaveProperty('tabPermissions');
  });
});

function auth(token: string) { return { authorization: `Bearer ${token}` }; }
