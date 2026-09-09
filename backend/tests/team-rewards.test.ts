import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/infrastructure/sqlite.js';
import { appOptions } from '../src/config/options.js';
import { ItemCatalog } from '../src/modules/item-catalog/public/index.js';
import { JsonGroupRepository, OperationGroupsService } from '../src/modules/operation-groups/public/index.js';
import { SqliteGroupRepository } from '../src/modules/operation-groups/infrastructure/sqlite-store.js';
import { JsonDirectoryRepository, PlayerDirectoryService, SqliteDirectoryRepository } from '../src/modules/player-directory/public/index.js';
import { JsonTeamClearRepository, JsonTeamViewRepository, TeamViewService, type LockedTeam } from '../src/modules/team-view/public/index.js';
import { applyTeamRewards } from '../src/modules/team-view/application/apply-rewards.js';

const temporary: string[] = [];
const date = '2026-09-08';
const actor = { id: 'customer-a', role: 'customer' as const, displayName: '申请客服' };
const admin = { id: 'super-admin', role: 'super_admin' as const, displayName: '管理员' };
function temp() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-rewards-')); temporary.push(dir); return dir; }
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function team(id: string, members: string[], bossType: LockedTeam['bossType'] = 'black-dragon', serverId = 'mushroom'): LockedTeam {
  return { id, serverId, bossType, members: members.map(characterId => ({ characterId, joinedAt: '2026-09-07T00:00:00Z' })) };
}
const teams = [team('six', ['1', '2', '3', '4', '5', '6']), team('seven', ['11', '12', '13', '14', '15', '16', '17']),
  team('single', ['21']), team('uncleared', ['31', '32']), team('zakum', ['21', '1', '2', '3', '4'], 'zakum'), team('other', ['1', '2'], 'black-dragon', 'yeti')];
function seed(dir: string) {
  const snapshots = new JsonTeamViewRepository(path.join(dir, 'teams.json'));
  snapshots.save({ date, fetchedAt: `${date}T00:05:00Z`, source: 'test', teams });
  const clears = new JsonTeamClearRepository(`${path.join(dir, 'teams.json')}.clears.json`);
  const service = new TeamViewService(snapshots, { fetch: async () => teams }, appOptions.servers, clears);
  service.importClears(admin, 'mushroom', { name: 'clears.csv', content: 'char_id,reason,created_at\n1,副本赞助点:黑龙,8/9/2026\n11,副本赞助点:黑龙,8/9/2026\n21,副本赞助点:黑龙,8/9/2026\n21,副本赞助点:进阶扎昆,8/9/2026\n1,副本赞助点:进阶扎昆,8/9/2026\n2,副本赞助点:进阶扎昆,8/9/2026\n3,副本赞助点:进阶扎昆,8/9/2026\n4,副本赞助点:进阶扎昆,8/9/2026' });
  return service;
}
const rows = [...new Set(teams.flatMap(team => team.members.map(member => member.characterId)))].map(charId => ({
  serverId: 'mushroom', charId, sourceFile: 'mg-char-user-qq.csv', userId: charId, username: `account${charId}`, bindQQ: `12345${charId}`,
}));
const input = { date, serverId: 'mushroom', type: 'black-dragon' };

describe.each(['json', 'sqlite'] as const)('%s team reward chain', adapter => {
  it('uses exact directory data, distributes to all members, auto approves and deduplicates across users and reopen', () => {
    const dir = temp();
    const db = adapter === 'sqlite' ? openDatabase(path.join(dir, 'ops.sqlite')) : undefined;
    try {
      const repository = db ? new SqliteGroupRepository(db) : new JsonGroupRepository(path.join(dir, 'groups.json'));
      const directory = db ? new SqliteDirectoryRepository(db) : new JsonDirectoryRepository(path.join(dir, 'players.json'));
      directory.replace([...rows, { ...rows[0], serverId: 'yeti', username: 'wrong-server' },
        ...Array.from({ length: 25 }, (_, i) => ({ ...rows[0], charId: `100${i}`, userId: `0${i}`, username: 'fuzzy1' }))]);
      const catalog = new ItemCatalog([{ code: '100000069', name: '快乐百宝券', itemClass: 'consume' }]);
      const groups = new OperationGroupsService({ repository, catalog });
      let changes = 0;
      groups.subscribe(() => { changes++; });
      const service = seed(dir);
      const players = new PlayerDirectoryService(directory, appOptions.servers);
      const view = service.view(actor, date).servers[0].types;
      expect(view.map(type => type.displayName)).toEqual(['黑龙（150票/队）', '进阶扎昆（500票/队）']);
      expect(view[0].teams.filter(team => team.canApply).map(team => team.id)).toEqual(['seven', 'six', 'single']);
      expect(applyTeamRewards(service, groups, players, actor, input)).toEqual({ count: 14, skippedCount: 0, teamCount: 3 });
      expect(changes).toBe(1);
      for (const group of repository.all()) {
        expect(group).toMatchObject({ account: `account${group.characterId}`, playerQQ: `12345${group.characterId}`, status: 'approved',
          reason: { code: 'event-reward', text: `${date} 黑龙` }, submittedBy: { id: actor.id, displayName: actor.displayName },
          approvedBy: { id: 'system-admin', displayName: '系统' },
          operations: [{ type: 'item', itemCode: '100000069', itemName: '快乐百宝券', quantity: group.characterId === '21' ? 150 : Number(group.characterId) < 10 ? 25 : 22 }] });
      }
      expect(groups.listOwn(actor).groups[0]).not.toHaveProperty('commands');
      expect(groups.listReview(admin).groups[0].commands.length).toBeGreaterThan(0);
      expect(applyTeamRewards(service, groups, players, admin, input)).toMatchObject({ count: 0, skippedCount: 14 });
      expect(applyTeamRewards(service, groups, players, actor, { ...input, type: 'zakum' })).toMatchObject({ count: 5 });
      expect(repository.all().filter(group => group.reason.text?.endsWith('进阶扎昆')).every(group => group.operations[0].type === 'item' && group.operations[0].quantity === 100)).toBe(true);
      const characterRewards = repository.all().filter(group => group.characterId === '21');
      expect(characterRewards).toHaveLength(2);
      expect(characterRewards).toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: expect.objectContaining({ text: `${date} 黑龙` }), operations: [expect.objectContaining({ quantity: 150 })] }),
        expect.objectContaining({ reason: expect.objectContaining({ text: `${date} 进阶扎昆` }), operations: [expect.objectContaining({ quantity: 100 })] }),
      ]));
      expect(characterRewards.reduce((sum, group) => sum + (group.operations[0].type === 'item' ? group.operations[0].quantity : 0), 0)).toBe(250);
      const reopened = db ? new SqliteGroupRepository(db) : new JsonGroupRepository(path.join(dir, 'groups.json'));
      expect(applyTeamRewards(service, new OperationGroupsService({ repository: reopened, catalog }), players, admin, input).count).toBe(0);
      expect(reopened.all()).toHaveLength(19);
    } finally { db?.close(); }
  });

  it('rejects missing/conflicting players and invalid operations before writing anything', () => {
    const dir = temp();
    const db = adapter === 'sqlite' ? openDatabase(path.join(dir, 'ops.sqlite')) : undefined;
    try {
      const repository = db ? new SqliteGroupRepository(db) : new JsonGroupRepository(path.join(dir, 'groups.json'));
      const directory = db ? new SqliteDirectoryRepository(db) : new JsonDirectoryRepository(path.join(dir, 'players.json'));
      const service = seed(dir);
      const players = new PlayerDirectoryService(directory, appOptions.servers);
      const catalog = new ItemCatalog([{ code: '100000069', name: '票', itemClass: 'consume' }]);
      const groups = new OperationGroupsService({ repository, catalog });
      for (const data of [rows.filter(row => row.charId !== '6'), [...rows, { ...rows[0], username: 'conflict' }], rows.map(row => row.charId === '6' ? { ...row, bindQQ: '' } : row)]) {
        directory.replace(data);
        expect(() => applyTeamRewards(service, groups, players, actor, input)).toThrow();
        expect(repository.all()).toHaveLength(0);
      }
      directory.replace(rows);
      expect(() => applyTeamRewards(service, new OperationGroupsService({ repository, catalog: new ItemCatalog([]) }), players, actor, input)).toThrow();
      expect(repository.all()).toHaveLength(0);
      if (db) {
        db.exec("CREATE TRIGGER fail_reward BEFORE INSERT ON operation_groups WHEN json_extract(NEW.payload_json, '$.characterId') = '6' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
        expect(() => applyTeamRewards(service, groups, players, actor, input)).toThrow('test failure');
        expect(repository.all()).toHaveLength(0);
      }
    } finally { db?.close(); }
  });
});

it('connects authenticated HTTP submission to own records and manager review without exposing commands', async () => {
  const dir = temp();
  seed(dir);
  new JsonDirectoryRepository(path.join(dir, 'players.json')).replace(rows);
  const app = await createApp({ teamViewPath: path.join(dir, 'teams.json'), playerDirectoryPath: path.join(dir, 'players.json'),
    dataPath: path.join(dir, 'groups.json'), usersPath: path.join(dir, 'users.json'), enableTeamScheduler: false,
    initialAdmin: { username: 'admin', displayName: 'Admin', password: 'Admin123' } });
  const headers = { 'x-user-id': actor.id, 'x-user-role': actor.role };
  try {
    const request = { method: 'POST' as const, url: '/api/v1/team-view/apply', payload: input };
    expect((await app.inject(request)).statusCode).toBe(401);
    for (const payload of [{ ...input, date: '2026-02-30' }, { ...input, date: undefined }, { ...input, type: 'bad' }, { ...input, serverId: 'bad' }]) {
      expect((await app.inject({ ...request, headers, payload })).statusCode).toBe(400);
    }
    const result = await app.inject({ ...request, headers });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({ count: 14, skippedCount: 0, teamCount: 3 });
    expect(result.body).not.toContain('commands');
    const own = await app.inject({ method: 'GET', url: '/api/v1/operation-groups/mine', headers });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json().groups).toHaveLength(14);
    expect(own.body).not.toContain('commands');
    const managerHeaders = { 'x-user-id': 'manager-b', 'x-user-role': 'manager' };
    const review = await app.inject({ method: 'GET', url: '/api/v1/manager/operation-groups/reviews', headers: managerHeaders });
    expect(review.json().groups[0]).toMatchObject({ status: 'approved', approvedBy: { displayName: '系统' } });
    const id = review.json().groups[0].id;
    const issued = await app.inject({ method: 'POST', url: `/api/v1/manager/operation-groups/${id}/issue`, headers: { 'x-user-id': admin.id, 'x-user-role': admin.role } });
    expect(issued.statusCode, issued.body).toBe(200);
    expect(issued.json()).toMatchObject({ status: 'issued', submittedBy: { id: actor.id }, approvedBy: { displayName: '系统' } });
    expect((await app.inject({ ...request, headers: managerHeaders })).json()).toMatchObject({ count: 0, skippedCount: 14 });
  } finally { await app.close(); }
});
