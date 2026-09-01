import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';

describe('authentication and approval workflow', () => {
  let app: FastifyInstance;
  const dataPath = path.join(os.tmpdir(), `ops-groups-${randomUUID()}.json`);
  const usersPath = path.join(os.tmpdir(), `ops-users-${randomUUID()}.json`);
  const catalogPath = path.resolve(process.cwd(), 'data/item-catalog/source/道具表.xlsx');
  let superToken = '';
  let superAdminId = '';
  let managerToken = '';
  let customerToken = '';

  beforeAll(async () => {
    app = await createApp({ catalogPath: fs.existsSync(catalogPath) ? catalogPath : path.resolve(process.cwd(), '..', 'data/item-catalog/source/道具表.xlsx'), dataPath, usersPath, initialAdmin: { username: 'superadmin', displayName: '超级管理员', password: 'AdminTestPass1!' } });
    const login = async (username: string, password: string) => (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } })).json().token as string;
    superToken = await login('superadmin', 'AdminTestPass1!');
    const seededUsers = await app.inject({ method: 'GET', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` } });
    expect(seededUsers.statusCode).toBe(200);
    expect(seededUsers.json().users).toHaveLength(1);
    superAdminId = seededUsers.json().users[0].id as string;
    const createdManager = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` }, payload: { username: 'mgr-test', displayName: '测试管理', password: 'ManagerPass1!', role: 'manager' } });
    expect(createdManager.statusCode).toBe(201);
    const createdCustomer = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` }, payload: { username: 'agent-test', displayName: '测试客服', password: 'CustomerPass1!', role: 'customer' } });
    expect(createdCustomer.statusCode).toBe(201);
    managerToken = await login('mgr-test', 'ManagerPass1!');
    customerToken = await login('agent-test', 'CustomerPass1!');
  });
  afterAll(async () => { await app.close(); for (const file of [dataPath, usersPath]) if (fs.existsSync(file)) fs.unlinkSync(file); });

  it('does not expose registration and allows managers to create management accounts', async () => {
    const registration = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'x', password: 'password' } });
    expect(registration.statusCode).not.toBe(200);
    const createdManager = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${managerToken}` }, payload: { username: 'mgr-2', displayName: '管理二', password: 'ManagerPass1!', role: 'manager' } });
    expect(createdManager.statusCode).toBe(201);
    const allowed = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${managerToken}` }, payload: { username: 'agent-2', displayName: '客服二', password: 'CustomerPass1!', role: 'customer' } });
    expect(allowed.statusCode).toBe(201);
  });

  it('accepts six-character passwords and rejects shorter passwords', async () => {
    const accepted = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` }, payload: { username: 'six-pass', displayName: '六位密码账号', password: 'abc123', role: 'customer' } });
    expect(accepted.statusCode).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'six-pass', password: 'abc123' } });
    expect(login.statusCode).toBe(200);
    const rejected = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` }, payload: { username: 'five-pass', displayName: '短密码账号', password: 'abc12', role: 'customer' } });
    expect(rejected.statusCode).toBe(400);
  });

  it('supports edit, approval, rejection and super-admin-only issuance', async () => {
    const customerHeaders = { authorization: `Bearer ${customerToken}` };
    const created = await app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers: customerHeaders, payload: { serverId: 'mushroom', account: 'item-player', playerQQ: '9', characterId: '9001', reason: { code: 'compensation', text: '测试' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const edited = await app.inject({ method: 'PUT', url: `/api/v1/operation-groups/${id}`, headers: customerHeaders, payload: { serverId: 'yeti', account: 'item-player-2', playerQQ: '10', characterId: '9002', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 2 }] } });
    expect(edited.statusCode).toBe(200);
    const approved = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${id}/approve`, headers: { authorization: `Bearer ${managerToken}` } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('approved');
    const managerIssue = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${id}/issue`, headers: { authorization: `Bearer ${managerToken}` } });
    expect(managerIssue.statusCode).toBe(403);
    const superIssue = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${id}/issue`, headers: { authorization: `Bearer ${superToken}` } });
    expect(superIssue.statusCode).toBe(200);
    expect(superIssue.json().status).toBe('issued');
    const customerView = await app.inject({ method: 'GET', url: '/api/v1/operation-groups/mine', headers: customerHeaders });
    expect(customerView.json().groups[0]).not.toHaveProperty('commands');
  });

  it('reflects renamed users in existing operation records', async () => {
    const users = (await app.inject({ method: 'GET', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` } })).json().users as Array<{ id: string; username: string }>;
    const customer = users.find((user) => user.username === 'agent-test');
    const manager = users.find((user) => user.username === 'mgr-test');
    expect(customer && manager).toBeTruthy();
    const created = await app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers: { authorization: `Bearer ${customerToken}` }, payload: { serverId: 'mushroom', account: 'rename-player', playerQQ: '11', characterId: '9010', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const renameCustomer = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${customer?.id}`, headers: { authorization: `Bearer ${superToken}` }, payload: { displayName: '改名客服' } });
    expect(renameCustomer.statusCode).toBe(200);
    const own = await app.inject({ method: 'GET', url: '/api/v1/operation-groups/mine', headers: { authorization: `Bearer ${customerToken}` } });
    expect(own.json().groups.find((group: { id: string }) => group.id === id).submittedBy.displayName).toBe('改名客服');
    const approve = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${id}/approve`, headers: { authorization: `Bearer ${managerToken}` } });
    expect(approve.statusCode).toBe(200);
    const renameManager = await app.inject({ method: 'PATCH', url: `/api/v1/auth/users/${manager?.id}`, headers: { authorization: `Bearer ${superToken}` }, payload: { displayName: '改名管理' } });
    expect(renameManager.statusCode).toBe(200);
    const archive = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?status=approved', headers: { authorization: `Bearer ${managerToken}` } });
    expect(archive.json().groups.find((group: { id: string }) => group.id === id).approvedBy.displayName).toBe('改名管理');
  });

  it('inherits customer submission access for higher roles', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers: { authorization: `Bearer ${managerToken}` }, payload: { serverId: 'mushroom', characterId: '77', reason: { code: 'player-request' }, operations: [{ type: 'kick' }] } });
    expect(response.statusCode).toBe(201);
    const own = await app.inject({ method: 'GET', url: '/api/v1/operation-groups/mine', headers: { authorization: `Bearer ${managerToken}` } });
    expect(own.statusCode).toBe(200);
    expect(own.json().groups.some((group: { id: string }) => group.id === response.json().id)).toBe(true);
  });

  it('protects the last super admin and limits manager account visibility', async () => {
    const blocked = await app.inject({ method: 'DELETE', url: `/api/v1/auth/users/${superAdminId}`, headers: { authorization: `Bearer ${superToken}` } });
    expect(blocked.statusCode).toBe(409);
    const users = await app.inject({ method: 'GET', url: '/api/v1/manager/customers', headers: { authorization: `Bearer ${managerToken}` } });
    expect(users.statusCode).toBe(200);
    expect(users.json().users.every((user: { role: string }) => user.role === 'customer' || user.role === 'manager')).toBe(true);
  });

  it('lets a super admin delete a subordinate while keeping self protection', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` }, payload: { username: 'remove-me', displayName: '待删除', password: 'CustomerPass1!', role: 'customer' } });
    expect(created.statusCode).toBe(201);
    const deleted = await app.inject({ method: 'POST', url: `/api/v1/auth/users/${created.json().id}/delete`, headers: { authorization: `Bearer ${superToken}` } });
    expect(deleted.statusCode).toBe(200);
    const users = await app.inject({ method: 'GET', url: '/api/v1/auth/users', headers: { authorization: `Bearer ${superToken}` } });
    expect(users.json().users.some((user: { username: string }) => user.username === 'remove-me')).toBe(false);
  });

  it('keeps action-only requests free of account and QQ requirements', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers: { authorization: `Bearer ${customerToken}` }, payload: { serverId: 'uu', characterId: '88', reason: { code: 'cheating' }, operations: [{ type: 'ban' }] } });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('approved');
    expect(response.json()).not.toHaveProperty('account');
    expect(response.json()).not.toHaveProperty('playerQQ');
    const completed = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${response.json().id}/complete`, headers: { authorization: `Bearer ${managerToken}` }, payload: {} });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().status).toBe('completed');
  });

  it('does not let the legacy completion endpoint bypass approval for new requests', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/operation-groups', headers: { authorization: `Bearer ${customerToken}` }, payload: { serverId: 'mushroom', account: 'item-player', playerQQ: '9', characterId: '99', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 1 }] } });
    const complete = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${response.json().id}/complete`, headers: { authorization: `Bearer ${managerToken}` }, payload: {} });
    expect(complete.statusCode).toBe(409);
  });
});
