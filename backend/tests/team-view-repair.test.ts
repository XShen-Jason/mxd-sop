import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openDatabase } from '../src/infrastructure/sqlite.js';
import { SqliteTeamViewRepository } from '../src/modules/team-view/public/index.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'team-repair-'));
const databasePath = path.join(directory, 'ops.sqlite');
const requests: string[] = [];
let endpoint: string;
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== 'Bearer test-service-token') {
    response.writeHead(401).end();
    return;
  }
  requests.push(request.url!);
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ date: '2026-09-08', teams: [{
    id: 'retained-team', serverId: 'mushroom', bossType: 'zakum',
    members: [{ characterId: '00123', joinedAt: '2026-09-07T12:00:00Z' }],
  }] }));
});

beforeAll(async () => {
  openDatabase(databasePath).close();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(directory, { recursive: true, force: true });
});

it('repairs one historical date using service authentication and the retained player roster', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--import', 'tsx', path.resolve('src/sync-team-view.ts'), '2026-09-08'], {
      env: { ...process.env, DATABASE_PATH: databasePath, MXD_PLAYER_LOCAL_URL: endpoint,
        MXD_PLAYER_SERVICE_TOKEN: 'test-service-token', MXD_PLAYER_DEPLOYMENT_MODE: 'local',
        MXD_PLAYER_TEAM_SNAPSHOT_URL: '' },
    });
  expect(JSON.parse(stdout)).toMatchObject({ date: '2026-09-08', teamCount: 1 });
  expect(requests).toEqual(['/api/v1/internal/player/teams/snapshot?date=2026-09-08']);
  const db = openDatabase(databasePath);
  try {
    const repository = new SqliteTeamViewRepository(db);
    expect(repository.get('2026-09-08')?.teams[0].members[0].characterId).toBe('00123');
    expect(repository.get('2026-09-09')).toBeNull();
  } finally { db.close(); }
});
