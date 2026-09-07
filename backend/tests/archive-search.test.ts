import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/infrastructure/sqlite.js';
import { JsonGroupRepository } from '../src/modules/operation-groups/infrastructure/json-store.js';
import { SqliteGroupRepository } from '../src/modules/operation-groups/infrastructure/sqlite-store.js';
import { readGroupPage } from '../src/modules/operation-groups/domain/pagination.js';
import type { OperationGroup } from '../src/shared/types.js';

const item = { type: 'item' as const, itemCode: '01012190_2', itemName: '历史面巾ABC_50%', quantity: 1 };
function record(id: string, overrides: Partial<OperationGroup> = {}): OperationGroup {
  return { id, server: { id: 'mushroom', displayName: '蘑菇' }, characterId: '001234',
    account: 'not-searchable', playerQQ: '998877', reason: { code: 'compensation' },
    operations: [item], status: 'issued', submittedAt: '2026-09-01T00:00:00.000Z',
    submittedBy: { id: 'customer', displayName: 'Customer' }, commandRuleVersion: 'v1', ...overrides };
}
const records = [record('a'), record('b'), record('c', { status: 'pending' }),
  record('d', { server: { id: 'yeti', displayName: '雪人' } }),
  record('regular', { characterId: '005678', status: 'completed', operations: [{ type: 'kick' }] }),
  record('cash', { characterId: '777', operations: [{ type: 'cash', quantity: 1 }] }),
  ...Array.from({ length: 25 }, (_, index) => record(`noise-${index}`, {
    characterId: '900', playerQQ: '800', operations: [{ ...item, itemName: '其他物品', itemCode: '02000000' }],
    submittedAt: '2026-09-02T00:00:00.000Z'
  }))];

describe.each(['sqlite', 'json'] as const)('archive search HTTP (%s)', (adapter) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-search-'));
  let app: FastifyInstance;
  let cookie: string;
  beforeAll(async () => {
    const databasePath = path.join(directory, 'ops.sqlite');
    const dataPath = path.join(directory, 'groups.json');
    if (adapter === 'sqlite') {
      const db = openDatabase(databasePath);
      const repository = new SqliteGroupRepository(db);
      records.forEach((group) => repository.insert(group));
      db.close();
    } else {
      const repository = new JsonGroupRepository(dataPath);
      records.forEach((group) => repository.insert(group));
    }
    app = await createApp({ ...(adapter === 'sqlite' ? { databasePath } : { dataPath, usersPath: path.join(directory, 'users.json') }),
      enableTeamScheduler: false, initialAdmin: { username: 'owner', displayName: 'Owner', password: 'Test123!' } });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'owner', password: 'Test123!' } });
    expect(login.statusCode).toBe(200);
    cookie = String(login.headers['set-cookie']).split(';', 1)[0];
  });
  afterAll(async () => { await app?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  async function search(q: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ kind: 'issuance', q, ...extra });
    const response = await app.inject({ method: 'GET', url: `/api/v1/manager/operation-groups/archive?${params}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it.each(['9988', '00123', '历史面巾', '01012190_2', ' abc_50% ', '%', '_'])('matches snapshot field: %s', async (query) => {
    const result = await search(query, { status: 'issued', serverId: 'mushroom' });
    expect(result.groups.map((group: OperationGroup) => group.id)).toEqual(query === '9988' ? ['cash', 'b', 'a'] : ['b', 'a']);
  });
  it('searches before pagination and carries filters into continuation pages', async () => {
    const first = await search('面巾', { status: 'issued', serverId: 'mushroom', limit: '1' });
    expect(first.groups.map((group: OperationGroup) => group.id)).toEqual(['b']);
    expect(first.nextCursor).toEqual(expect.any(String));
    const next = await search('面巾', { status: 'issued', serverId: 'mushroom', limit: '1', cursor: first.nextCursor });
    expect(next.groups.map((group: OperationGroup) => group.id)).toEqual(['a']);
    expect(next.nextCursor).toBeNull();
  });
  it('matches only character IDs for regular records', async () => {
    expect((await search('00567', { kind: 'regular' })).groups.map((group: OperationGroup) => group.id)).toEqual(['regular']);
    expect((await search('998877', { kind: 'regular' })).groups).toEqual([]);
    expect((await search('面巾', { kind: 'regular' })).groups).toEqual([]);
  });
  it('ignores other fields, handles misses, and restores results on clearing', async () => {
    expect((await search('not-searchable')).groups).toEqual([]);
    expect((await search('no-match')).nextCursor).toBeNull();
    expect((await search('   ', { limit: '100' })).groups).toHaveLength(30);
  });
  it('rejects oversized/repeated queries and unauthenticated access', async () => {
    for (const query of [`q=${'a'.repeat(101)}`, 'q=one&q=two']) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/manager/operation-groups/archive?${query}`, headers: { cookie } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid-input');
    }
    const denied = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/archive?q=00123' });
    expect(denied.statusCode).toBe(401);
  });
});

it('applies the same search in repositories without a listPage implementation', () => {
  const repository = { all: () => records, findById: () => undefined, insert: () => {}, replace: () => {} };
  const page = readGroupPage(repository, { search: '面巾', kind: 'issuance', status: 'issued', serverId: 'mushroom', limit: 1, order: 'desc' });
  expect(page.groups.map((group) => group.id)).toEqual(['b']);
  expect(readGroupPage(repository, { search: '9988', kind: 'regular', limit: 20, order: 'desc' }).groups).toEqual([]);
});
