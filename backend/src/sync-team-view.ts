import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from './config/environment.js';
import { appOptions } from './config/options.js';
import { openDatabase } from './infrastructure/sqlite.js';
import { HttpPlayerIntegrationClient, loadPlayerEndpointConfig, PlayerIntegrationService, SqlitePlayerIntegrationRepository } from './modules/player-integration/public/index.js';
import { businessDay, normalizeDate, HttpLockedTeamSource, SqliteTeamViewRepository, TeamViewService } from './modules/team-view/public/index.js';

async function main() {
  loadEnvironment();
  const date = normalizeDate(process.argv[2]);
  if (!date || date > businessDay(new Date())) throw new Error('Specify a locked Beijing date: YYYY-MM-DD (today or earlier)');
  const databasePath = process.env.DATABASE_PATH;
  if (!databasePath || !path.isAbsolute(databasePath) || !fs.existsSync(databasePath)) {
    throw new Error('DATABASE_PATH must name an existing operations SQLite database using an absolute path');
  }
  const db = openDatabase(databasePath);
  try {
    const config = loadPlayerEndpointConfig();
    const integration = new PlayerIntegrationService(new SqlitePlayerIntegrationRepository(db), config, new HttpPlayerIntegrationClient(config.timeoutMs));
    const sourceUrl = process.env.MXD_PLAYER_TEAM_SNAPSHOT_URL;
    const source = sourceUrl
      ? new HttpLockedTeamSource(sourceUrl, process.env.MXD_PLAYER_TEAM_SNAPSHOT_TOKEN)
      : new HttpLockedTeamSource(() => integration.teamSnapshotEndpoint(), () => integration.serviceToken());
    const service = new TeamViewService(new SqliteTeamViewRepository(db), source, appOptions.servers);
    const snapshot = await service.sync(date);
    console.log(JSON.stringify({ date: snapshot.date, teamCount: snapshot.teams.length, fetchedAt: snapshot.fetchedAt }));
  } finally { db.close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'team synchronization failed');
  process.exitCode = 1;
});
