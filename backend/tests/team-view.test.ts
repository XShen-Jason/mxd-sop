import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { TeamViewService, type LockedTeam, type LockedTeamSource, type TeamViewRepository } from '../src/modules/team-view/public/index.js';

const date = '2026-09-08';
const catalogPath = path.resolve(process.cwd(), '..', 'data/item-catalog/source/items.json');

describe('team-view workspace', () => {
  let app: FastifyInstance;
  const dataPath = path.join(os.tmpdir(), `team-view-${randomUUID()}.json`);
  const usersPath = path.join(os.tmpdir(), `team-view-users-${randomUUID()}.json`);
  const teamViewPath = path.join(os.tmpdir(), `team-view-snapshot-${randomUUID()}.json`);

  beforeAll(async () => {
    fs.writeFileSync(teamViewPath, JSON.stringify({ [date]: { date, fetchedAt: '2026-09-07T00:05:00.000Z', source: 'mxd-player', teams: fixtureTeams() } }));
    app = await createApp({ catalogPath, dataPath, usersPath, teamViewPath, initialAdmin: { username: 'team-admin', displayName: 'Team Admin', password: 'Admin123' } });
  });

  afterAll(async () => {
    await app?.close();
    for (const file of [dataPath, usersPath, teamViewPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  it('requires authentication and returns all server/type groups to every role', async () => {
    const denied = await app.inject({ method: 'GET', url: `/api/v1/team-view?date=${date}` });
    expect(denied.statusCode).toBe(401);
    const invalidDate = await app.inject({ method: 'GET', url: '/api/v1/team-view?date=2026-02-31', headers: { 'x-user-role': 'customer', 'x-user-id': 'customer-a', 'x-display-name': 'Customer' } });
    expect(invalidDate.statusCode).toBe(400);
    expect(invalidDate.json().error.code).toBe('invalid-date');
    for (const [role, id] of [['customer', 'customer-a'], ['manager', 'manager-b'], ['super_admin', 'super-admin']] as const) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/team-view?date=${date}`, headers: { 'x-user-role': role, 'x-user-id': id, 'x-display-name': role } });
      expect(response.statusCode).toBe(200);
      expect(response.json().servers).toHaveLength(5);
      expect(response.json().servers.every((server: { types: unknown[] }) => server.types.length === 2)).toBe(true);
    }
  });

  it('assigns deterministic sequence after member count and join-time sorting', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/v1/team-view?date=${date}`, headers: { 'x-user-role': 'customer', 'x-user-id': 'customer-a', 'x-display-name': 'Customer' } });
    const blackDragon = response.json().servers.find((server: { server: { id: string } }) => server.server.id === 'mushroom').types.find((type: { type: string }) => type.type === 'black-dragon');
    expect(blackDragon.teams.map((team: { id: string; sequence: number; memberCount: number }) => [team.id, team.sequence, team.memberCount])).toEqual([['early-team', 1, 2], ['large-team', 2, 2], ['small-team', 3, 1]]);
  });

  it('syncs through the source port and persists the usage date', async () => {
    const repository = new MemoryRepository();
    const source: LockedTeamSource = { fetch: async () => fixtureTeams().slice(0, 1) };
    const service = new TeamViewService(repository, source, [{ id: 'mushroom', displayName: 'Mushroom' }]);
    await service.sync(date);
    const result = service.view({ id: 'customer-id', role: 'customer', displayName: 'Customer' }, date);
    expect(result.sourceStatus).toBe('ready');
    expect(result.servers[0].types[0].teams).toHaveLength(1);
  });
});

function fixtureTeams(): LockedTeam[] {
  const member = (characterId: string, joinedAt: string) => ({ characterId, joinedAt });
  return [
    { id: 'small-team', serverId: 'mushroom', bossType: 'black-dragon', members: [member('101', '2026-09-07T03:00:00Z')] },
    { id: 'early-team', serverId: 'mushroom', bossType: 'black-dragon', members: [member('201', '2026-09-07T01:00:00Z'), member('202', '2026-09-07T02:00:00Z')] },
    { id: 'large-team', serverId: 'mushroom', bossType: 'black-dragon', members: [member('301', '2026-09-07T04:00:00Z'), member('302', '2026-09-07T05:00:00Z')] },
    { id: 'zakum-team', serverId: 'yeti', bossType: 'zakum', members: [member('401', '2026-09-07T01:00:00Z')] },
  ];
}

class MemoryRepository implements TeamViewRepository {
  private snapshot = new Map<string, ReturnType<TeamViewRepository['get']>>();
  get(date: string) { return this.snapshot.get(date) ?? null; }
  save(snapshot: NonNullable<ReturnType<TeamViewRepository['get']>>) { this.snapshot.set(snapshot.date, snapshot); }
}
