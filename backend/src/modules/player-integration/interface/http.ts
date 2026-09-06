import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type AuthService } from '../../auth/public/index.js';
import { PlayerIntegrationError, type PlayerIntegrationService } from '../public/index.js';

function body(request: FastifyRequest) {
  const value = request.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlayerIntegrationError('invalid-input');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !['mode', 'confirmation'].includes(key))) throw new PlayerIntegrationError('invalid-input');
  return result;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof PlayerIntegrationError) {
    const status = error.code === 'forbidden' ? 403 : error.code === 'endpoint-unavailable' ? 503 : error.code === 'endpoint-not-configured' ? 503 : 400;
    return reply.code(status).send({ error: { code: error.code, message: error.message } });
  }
  if (error instanceof AuthError) return reply.code(error.code === 'unauthorized' ? 401 : 403).send({ error: { code: error.code, message: error.message } });
  return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
}

export function registerPlayerIntegrationRoutes(app: FastifyInstance, service: PlayerIntegrationService, auth: AuthService) {
  const identity = (request: FastifyRequest) => auth.requestIdentity(request.headers as Record<string, unknown>);
  app.get('/api/v1/player-integration/status', async (request, reply) => {
    try { return reply.send(await service.status(identity(request))); } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/player-integration/switch', async (request, reply) => {
    try { const value = body(request); return reply.send(await service.switchMode(identity(request), value.mode, value.confirmation)); } catch (error) { return sendError(reply, error); }
  });
}
