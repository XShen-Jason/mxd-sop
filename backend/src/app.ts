import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { appOptions } from './config/options.js';
import { AuthService } from './modules/auth/public/index.js';
import { JsonUserRepository } from './modules/auth/public/index.js';
import { SqliteUserRepository } from './modules/auth/infrastructure/sqlite-users.js';
import { SqliteSessionRepository } from './modules/auth/infrastructure/sqlite-sessions.js';
import { registerAuthRoutes } from './modules/auth/interface/http.js';
import { loadCatalogFromCsv, loadCatalogFromExcel, loadCatalogFromJson, loadCatalogImageMap } from './modules/item-catalog/public/index.js';
import { registerOperationRoutes } from './modules/operation-groups/interface/http.js';
import { OperationGroupsService } from './modules/operation-groups/public/index.js';
import { JsonGroupRepository } from './modules/operation-groups/public/index.js';
import { SqliteGroupRepository } from './modules/operation-groups/infrastructure/sqlite-store.js';
import { registerActivityRoutes } from './modules/activities/interface/http.js';
import { ActivitiesService, JsonActivityRepository } from './modules/activities/public/index.js';
import { SqliteActivityRepository } from './modules/activities/infrastructure/sqlite-store.js';
import { openDatabase } from './infrastructure/sqlite.js';
import { loadEnvironment } from './config/environment.js';

loadEnvironment();

export interface AppConfig {
  catalogPath?: string;
  catalogImageMapPath?: string;
  dataPath?: string;
  usersPath?: string;
  activitiesPath?: string;
  databasePath?: string;
  initialAdmin?: { username: string; displayName: string; password: string };
}

export async function createApp(config: AppConfig = {}) {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: true });
  const allowedOrigin = process.env.CORS_ORIGIN;
  await app.register(cors, allowedOrigin ? { origin: allowedOrigin, credentials: true } : { origin: false });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: string }).code;
    if (code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(400).send({ error: { code: 'invalid-input', message: 'invalid JSON body' } });
    }
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'invalid-input', message: 'request body too large' } });
    }
    return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
  });
  const projectRoot = findProjectRoot(process.cwd());
  const projectPath = (relative: string) => path.isAbsolute(relative) ? relative : path.join(projectRoot, relative);
  const catalogPath = config.catalogPath ?? projectPath('data/item-catalog/source/道具表-9-5.csv');
  const catalogExtension = path.extname(catalogPath).toLowerCase();
  const imageMapPath = config.catalogImageMapPath ?? projectPath('data/item-catalog/source/item-image-map.json');
  const tabularOptions = () => ({ skipInvalidRows: true, images: loadCatalogImageMap(imageMapPath) });
  const catalog = catalogExtension === '.json'
    ? loadCatalogFromJson(catalogPath, { skipInvalidRows: true })
    : catalogExtension === '.csv'
      ? loadCatalogFromCsv(catalogPath, tabularOptions())
      : loadCatalogFromExcel(catalogPath, tabularOptions());
  const testPersistence = Boolean(config.dataPath || config.usersPath);
  const databasePath = projectPath(config.databasePath ?? process.env.DATABASE_PATH ?? 'data/ops.sqlite');
  const databaseExisted = !testPersistence && fs.existsSync(databasePath);
  const db = testPersistence ? undefined : openDatabase(databasePath);
  const repository = testPersistence ? new JsonGroupRepository(config.dataPath ?? projectPath('data/generated/operation-groups.json')) : new SqliteGroupRepository(db!);
  const activitiesRepository = testPersistence
    ? new JsonActivityRepository(config.activitiesPath ?? `${config.dataPath ?? projectPath('data/generated/operation-groups.json')}.activities.json`)
    : new SqliteActivityRepository(db!);
  let auth: AuthService;
  try {
    auth = testPersistence
      ? new AuthService(new JsonUserRepository(config.usersPath ?? projectPath('data/generated/users.json')), { allowLegacyHeaders: true, initialAdmin: config.initialAdmin })
      : new AuthService(new SqliteUserRepository(db!), { sessions: new SqliteSessionRepository(db!), allowLegacyHeaders: false, initialAdmin: config.initialAdmin ?? { username: process.env.INITIAL_ADMIN_USERNAME ?? 'superadmin', displayName: process.env.INITIAL_ADMIN_DISPLAY_NAME ?? '超级管理员', password: process.env.INITIAL_ADMIN_PASSWORD ?? '' } });
  } catch (error) {
    db?.close();
    if (!databaseExisted && error instanceof Error && error.message.includes('INITIAL_ADMIN_PASSWORD')) {
      for (const suffix of ['', '-wal', '-shm']) {
        const file = `${databasePath}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
    throw error;
  }
  const service = new OperationGroupsService({ repository, catalog, options: appOptions, resolveDisplayName: (id) => auth.resolveDisplayName(id) });
  registerAuthRoutes(app, auth);
  registerOperationRoutes(app, service, catalog, auth);
  registerActivityRoutes(app, new ActivitiesService(activitiesRepository), auth);
  app.get('/health', async () => ({ status: 'ok', catalogItems: catalog.size }));
  if (db) app.addHook('onClose', async () => { db.close(); });
  return app;
}

function findProjectRoot(start: string) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(current, 'backend/package.json')) && fs.existsSync(path.join(current, 'frontend/package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start);
}
