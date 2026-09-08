import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/infrastructure/sqlite.js';
import { parseClearFile } from '../src/modules/team-view/infrastructure/clear-csv.js';
import { JsonTeamClearRepository, JsonTeamViewRepository, SqliteTeamClearRepository, SqliteTeamViewRepository, TeamViewService, type LockedTeam } from '../src/modules/team-view/public/index.js';

const temporary: string[] = [];
function directory() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-clears-')); temporary.push(dir); return dir; }
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const admin = { id: 'admin', role: 'super_admin' as const, displayName: 'Admin' };
const servers = [{ id: 'mushroom', displayName: 'Mushroom' }, { id: 'yeti', displayName: 'Yeti' }];
const csv = (rows: string[]) => ({ name: 'arbitrary.csv', content: `char_id,reason,created_at\n${rows.join('\n')}` });
const row = (id: string, boss = '黑龙', date = '8/9/2026 00:00:00') => `${id},副本赞助点:${boss},${date}`;
const teams: LockedTeam[] = servers.flatMap(server => ['black-dragon', 'zakum'].map(bossType => ({
  id: `${server.id}-${bossType}`, serverId: server.id, bossType: bossType as LockedTeam['bossType'],
  members: ['17', '193'].map(characterId => ({ characterId, joinedAt: '2026-09-07T00:00:00Z' })),
})));

describe('clear CSV interpretation', () => {
  it('reads the actual day/month/year export and quoted extra columns', () => {
    const content = fs.readFileSync(path.resolve('../data/player-directory/source/9-8.csv'), 'utf8');
    const result = parseClearFile({ name: '9-8.csv', content }, 'mushroom');
    expect(result.rows).toContainEqual({ date: '2026-09-08', serverId: 'mushroom', bossType: 'zakum', characterId: '17' });
    expect(result.rows).toContainEqual({ date: '2026-09-08', serverId: 'mushroom', bossType: 'black-dragon', characterId: '193' });
    const quoted = parseClearFile({ name: 'x.csv', content: '\uFEFF"char_id","reason","created_at","nickname"\r\n"00017","副本赞助点:黑龙","8/9/2026 23:59:59","A,\r\nB ""C"""' }, 'mushroom');
    expect(quoted.rows[0]).toMatchObject({ characterId: '00017', date: '2026-09-08' });
  });
  it('does not guess dates, reasons or IDs and bounds file sizes', () => {
    for (const date of ['31/2/2026', '8/9', '', '8/9/2026 24:00:00', '2026-09-08T23:00:00Z']) {
      expect(() => parseClearFile(csv([row('17', '黑龙', date)]), 'mushroom')).toThrow();
    }
    expect(() => parseClearFile(csv([row('1e3')]), 'mushroom')).toThrow();
    expect(() => parseClearFile(csv([row('17', '扎昆')]), 'mushroom')).toThrow();
    expect(() => parseClearFile({ name: 'x.csv', content: 'a'.repeat(1_000_001) }, 'mushroom')).toThrow();
    expect(() => parseClearFile({ name: 'x.csv', content: 'char_id,reason\n17,"unterminated' }, 'mushroom')).toThrow();
    expect(parseClearFile(csv([row('17'), row('17'), row('193', '其他')]), 'mushroom')).toMatchObject({ rows: [expect.objectContaining({ characterId: '17' })], skippedRows: 1 });
  });
});

describe.each(['json', 'sqlite'] as const)('%s clear persistence and matching', adapter => {
  it('isolates date/server/boss, accumulates idempotently, survives reopen and snapshot sync', async () => {
    const dir = directory();
    const db = adapter === 'sqlite' ? openDatabase(path.join(dir, 'ops.sqlite')) : undefined;
    const createClears = () => db ? new SqliteTeamClearRepository(db) : new JsonTeamClearRepository(path.join(dir, 'clears.json'));
    const snapshots = db ? new SqliteTeamViewRepository(db) : new JsonTeamViewRepository(path.join(dir, 'snapshots.json'));
    try {
      const service = new TeamViewService(snapshots, { fetch: async () => teams }, servers, createClears());
      service.importClears(admin, 'mushroom', csv([row('17'), row('193', '进阶扎昆'), row('193', '黑龙', '9/9/2026 00:00:00')]));
      for (const date of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-08-09', '2025-09-08']) await service.sync(date);
      const projection = service.view(admin, '2026-09-08');
      expect(projection.servers[0].types[0].teams[0]).toMatchObject({ clearedMembers: ['17'], cleared: false });
      expect(projection.servers[0].types[1]).toMatchObject({ displayName: '进阶扎昆', teams: [expect.objectContaining({ clearedMembers: ['193'], cleared: false })] });
      expect(projection.servers[1].types.every(type => type.teams[0].clearedMembers.length === 0)).toBe(true);
      for (const date of ['2026-09-07', '2026-08-09', '2025-09-08']) expect(service.view(admin, date).servers[0].types[0].teams[0].clearedMembers).toEqual([]);
      expect(service.view(admin, '2026-09-09').servers[0].types[0].teams[0].clearedMembers).toEqual(['193']);
      expect(() => service.importClears(admin, 'mushroom', csv([row('193'), row('1', '黑龙', 'invalid')]))).toThrow();
      expect(service.view(admin, '2026-09-08').servers[0].types[0].teams[0].cleared).toBe(false);
      for (let i = 0; i < 2; i++) service.importClears(admin, 'mushroom', csv([row('193')]));
      await service.sync('2026-09-08');
      const reopened = new TeamViewService(snapshots, { fetch: async () => [] }, servers, createClears());
      expect(reopened.view(admin, '2026-09-08').servers[0].types[0].teams[0]).toMatchObject({ cleared: true, clearedMembers: ['17', '193'] });
      expect(createClears().get('2026-09-08')).toHaveLength(3);
    } finally { db?.close(); }
  });
});

it('enforces HTTP authorization, validates inputs and persists imports for readers', async () => {
  const dir = directory();
  const teamViewPath = path.join(dir, 'teams.json');
  new JsonTeamViewRepository(teamViewPath).save({ date: '2026-09-08', fetchedAt: '2026-09-08T00:00:00Z', source: 'test', teams });
  const config = { teamViewPath, dataPath: path.join(dir, 'groups.json'), usersPath: path.join(dir, 'users.json'), catalogPath: path.resolve('../data/item-catalog/source/items.json'), enableTeamScheduler: false, initialAdmin: { username: 'admin', displayName: 'Admin', password: 'Admin123' } };
  const app = await createApp(config);
  try {
    const url = '/api/v1/team-view/clears/import';
    const payload = { serverId: 'mushroom', file: csv([row('17')]) };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    for (const role of ['customer', 'manager']) expect((await app.inject({ method: 'POST', url, payload, headers: { 'x-user-id': role === 'customer' ? 'customer-a' : 'manager-b', 'x-user-role': role } })).statusCode).toBe(403);
    const headers = { 'x-user-id': 'super-admin', 'x-user-role': 'super_admin' };
    expect((await app.inject({ method: 'POST', url, headers, payload: { ...payload, serverId: '' } })).statusCode).toBe(400);
    const response = await app.inject({ method: 'POST', url, headers, payload });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ dates: ['2026-09-08'], rowCount: 1, skippedRows: 0 });
  } finally { await app.close(); }
  const reopened = await createApp(config);
  try {
    const response = await reopened.inject({ method: 'GET', url: '/api/v1/team-view?date=2026-09-08', headers: { 'x-user-id': 'customer-a', 'x-user-role': 'customer' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().servers[0].types[0].teams[0]).toMatchObject({ clearedMembers: ['17'], cleared: false });
  } finally { await reopened.close(); }
});
