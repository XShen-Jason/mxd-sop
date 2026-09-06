import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type AuthService } from '../../auth/public/index.js';
import { DirectoryError, type PlayerDirectoryService } from '../public/index.js';
import type { UploadFile } from '../public/index.js';

function identity(request: FastifyRequest, auth: AuthService) { return auth.requestIdentity(request.headers as Record<string, unknown>); }

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof DirectoryError) return reply.code(error.code === 'forbidden' ? 403 : error.code === 'player-sync-failed' ? 503 : 400).send({ error: { code: error.code, message: error.message } });
  if (error instanceof AuthError) return reply.code(error.code === 'unauthorized' ? 401 : 403).send({ error: { code: error.code, message: error.message } });
  return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
}

function bodyObject(request: FastifyRequest) {
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DirectoryError('invalid-file');
  const value = body as Record<string, unknown>;
  if (typeof value.serverId !== 'string' || !value.file || typeof value.file !== 'object' || Array.isArray(value.file)) throw new DirectoryError('invalid-file');
  return { serverId: value.serverId, file: value.file as UploadFile };
}

export function registerPlayerDirectoryRoutes(app: FastifyInstance, service: PlayerDirectoryService, auth: AuthService) {
  app.get('/api/v1/player-directory/search', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      return reply.send(service.search(identity(request, auth), { query: query.q === undefined ? undefined : String(query.q), serverId: query.serverId === undefined ? undefined : String(query.serverId), cursor: query.cursor === undefined ? undefined : String(query.cursor), limit: query.limit === undefined ? undefined : Number(query.limit) }));
    } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/player-directory/import', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    try { const input = bodyObject(request); return reply.code(201).send(await service.importFile(identity(request, auth), input.serverId, input.file)); }
    catch (error) { return sendError(reply, error); }
  });
}
