import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/infrastructure/sqlite.js';
import XLSX from '@e965/xlsx';
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
const records = [record('a'), record('b'), record('c', { status: 'pending', submittedAt: '2026-09-03T00:00:00.000Z' }),
  record('d', { server: { id: 'yeti', displayName: '雪人' } }),
  record('regular', { characterId: '005678', status: 'completed', operations: [{ type: 'kick' }] }),
  record('cash', { characterId: '777', operations: [{ type: 'cash', quantity: 1 }] }),
  record('target', { characterId: '4242', playerQQ: '111111', status: 'pending' }),
  record('target-related', { characterId: '4242', playerQQ: '111111', status: 'pending', operations: [{ ...item, itemName: '其他物品', itemCode: '02000000' }] }),
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
  async function exportCsv(q: string, extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ kind: 'issuance', q, ...extra });
    const response = await app.inject({ method: 'GET', url: `/api/v1/manager/operation-groups/issuance-export?${params}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const workbook = XLSX.read(response.rawPayload, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return { rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true }), sheet };
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
    expect((await search('   ', { limit: '100' })).groups).toHaveLength(32);
  });
  it('supports explicit fields and exports all filtered rows with optional related records', async () => {
    expect((await search('998877', { searchField: 'playerQQ', status: 'issued', serverId: 'mushroom' })).groups.map((group: OperationGroup) => group.id)).toEqual(['cash', 'b', 'a']);
    const direct = await exportCsv('历史面巾', { searchField: 'itemName', serverId: 'mushroom' });
    const related = await exportCsv('历史面巾', { searchField: 'itemName', serverId: 'mushroom', includeRelated: 'true' });
    expect(direct.rows).toHaveLength(5);
    expect(related.rows).toHaveLength(6);
    expect(direct.rows[0]).toEqual(['服务器', '游戏账号', '玩家 QQ', '角色 ID', '物品代码', '物品名称', '物品类型', '数量', '申请理由', '记录状态', '提交时间', '审核时间', '发放时间', '完成时间', '提交人', '审核人', '发放人', '异常提示']);
    expect(direct.sheet['!autofilter']).toEqual({ ref: 'A1:R5' });
    expect(direct.rows.slice(1).every((row) => row[10] instanceof Date)).toBe(true);
    const submittedTimes = direct.rows.slice(1).map((row) => (row[10] as Date).getTime());
    expect(submittedTimes).toEqual([...submittedTimes].sort((left, right) => right - left));
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
