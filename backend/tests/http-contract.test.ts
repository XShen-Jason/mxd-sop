import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';

describe('HTTP role projections', () => {
  let app: FastifyInstance;
  const dataPath = path.join(os.tmpdir(), `game-support-ops-${randomUUID()}.json`);
  const usersPath = path.join(os.tmpdir(), `game-support-users-${randomUUID()}.json`);
  const catalogPath = fs.existsSync(path.resolve(process.cwd(), 'data/item-catalog/source/道具表.xlsx'))
    ? path.resolve(process.cwd(), 'data/item-catalog/source/道具表.xlsx')
    : path.resolve(process.cwd(), '..', 'data/item-catalog/source/道具表.xlsx');
  const customerHeaders = { 'x-user-role': 'customer', 'x-user-id': 'customer-a', 'x-display-name': '客服 A' };
  const managerHeaders = { 'x-user-role': 'manager', 'x-user-id': 'manager-b', 'x-display-name': '管理 B' };

  beforeAll(async () => {
    app = await createApp({ catalogPath, dataPath, usersPath, initialAdmin: { username: 'superadmin', displayName: '超级管理员', password: 'ContractTestPass1!' } });
  });
  afterAll(async () => {
    await app.close();
    for (const file of [dataPath, usersPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  it('requires an authenticated identity', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/operation-groups/options' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });

  it('omits commands from customer responses and exposes them only to managers', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/operation-groups', headers: { ...customerHeaders, 'idempotency-key': 'contract-1' },
      payload: { serverId: 'mushroom', account: 'acc', characterId: '123', playerQQ: '456', reason: { code: 'compensation' }, operations: [{ type: 'item', itemCode: '02000000', quantity: 2888 }] }
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('commands');

    const denied = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/queue', headers: customerHeaders });
    expect(denied.statusCode).toBe(403);
    const queue = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/queue', headers: managerHeaders });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().groups[0].commands.map((command: { text: string }) => command.text)).toEqual([
      'drop@123@02000000@1000', 'drop@123@02000000@1000', 'drop@123@02000000@888'
    ]);
  });

  it('returns category-filtered catalog items for authenticated users', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/item-catalog/by-class?class=consume&limit=2', headers: customerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.every((item: { itemClass?: string }) => item.itemClass === 'consume')).toBe(true);
  });
});
