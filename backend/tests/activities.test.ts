import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';

describe('shared activities', () => {
  let app: FastifyInstance;
  const dataPath = path.join(os.tmpdir(), `game-support-activities-${randomUUID()}.json`);
  const usersPath = path.join(os.tmpdir(), `game-support-activity-users-${randomUUID()}.json`);
  const activitiesPath = `${dataPath}.activities.json`;
  const customer = { 'x-user-role': 'customer', 'x-user-id': 'customer-a' };
  const manager = { 'x-user-role': 'super_admin', 'x-user-id': 'super-admin' };

  beforeAll(async () => {
    app = await createApp({ dataPath, usersPath, activitiesPath, initialAdmin: { username: 'superadmin', displayName: '超管', password: 'ContractTestPass1!' } });
  });

  afterAll(async () => {
    await app.close();
    for (const file of [dataPath, usersPath, activitiesPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  it('allows managers to publish activities that customers can read', async () => {
    const activity = { id: 'event-1', name: '周年庆', description: '', rewards: [{ kind: 'cash', quantity: 100 }], updatedAt: new Date().toISOString() };
    const denied = await app.inject({ method: 'PUT', url: '/api/v1/activities', headers: customer, payload: { activities: [activity] } });
    expect(denied.statusCode).toBe(403);

    const saved = await app.inject({ method: 'PUT', url: '/api/v1/activities', headers: manager, payload: { activities: [activity] } });
    expect(saved.statusCode).toBe(200);
    const listed = await app.inject({ method: 'GET', url: '/api/v1/activities', headers: customer });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().activities).toEqual([activity]);
  });
});
