import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, hasWorkspaceAccess, type AuthService } from '../auth/public/index.js';
import type { ItemCatalog } from '../item-catalog/public/index.js';
import { AutoIntegrationError, type AutoIntegrationService } from '../auto-integration/public/index.js';
import { buildPotentialCommand, loadPool } from './pool.js';
import { parseResponse } from './parser.js';

function actor(request: FastifyRequest, auth: AuthService) {
  const identity = auth.requestIdentity(request.headers as Record<string, unknown>);
  if (identity.role !== 'super_admin' || !hasWorkspaceAccess(identity, 'potential-editor')) throw new AuthError('forbidden');
  return identity;
}
function body(request: FastifyRequest) {
  const value = request.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AutoIntegrationError('invalid-input');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new AutoIntegrationError('invalid-input', `${name} is invalid`);
  return value.trim();
}
function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError) return reply.code(error.code === 'unauthorized' ? 401 : 403)
    .send({ error: { code: error.code, message: error.message } });
  if (error instanceof AutoIntegrationError) {
    const status = error.code === 'forbidden' ? 403 : error.code === 'potential-list-unconfirmed' ? 502 : 400;
    return reply.code(status).send({ error: { code: error.code, message: error.message } });
  }
  return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
}

export function registerPotentialRoutes(
  app: FastifyInstance, service: AutoIntegrationService, auth: AuthService, catalog: ItemCatalog, poolPath: string,
) {
  const pool = loadPool(poolPath);
  app.get('/api/v1/potential-pool', async (request, reply) => {
    try { actor(request, auth); return reply.send({ options: pool }); }
    catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/potentials/list', async (request, reply) => {
    try {
      const identity = actor(request, auth);
      const sessionId = text(body(request).session_id, 'session_id');
      const result = await service.sendSessionMessage(identity, sessionId, { message: 'potential@list', mode: 'privateChat' });
      return reply.send({ session: result.session, equipment: parseResponse(result.server_response, catalog, pool), result });
    } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/potentials/set', async (request, reply) => {
    try {
      const identity = actor(request, auth);
      const value = body(request);
      const sessionId = text(value.session_id, 'session_id');
      const message = buildPotentialCommand(text(value.instance_id, 'instance_id'), value.potentials, pool);
      const result = await service.sendSessionMessage(identity, sessionId, { message, mode: 'privateChat' });
      return reply.send({ session: result.session, result });
    } catch (error) { return sendError(reply, error); }
  });
}
export function potentialPoolPath(projectRoot: string) { return path.join(projectRoot, 'data', 'tbl_potential_pool.csv'); }
