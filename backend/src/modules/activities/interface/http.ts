import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type AuthService } from '../../auth/public/index.js';
import { ActivityError, type ActivitiesService } from '../public/index.js';
import type { Identity } from '../../../shared/types.js';

function identityFromRequest(request: FastifyRequest, auth: AuthService): Identity {
  return auth.requestIdentity(request.headers as Record<string, unknown>);
}

function bodyValue(request: FastifyRequest) {
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ActivityError('invalid-input');
  const object = body as Record<string, unknown>;
  if (Object.keys(object).some((key) => key !== 'activities')) throw new ActivityError('invalid-input');
  const value = object.activities;
  return value;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ActivityError) return reply.code(error.code === 'forbidden' ? 403 : 400).send({ error: { code: error.code, message: error.message } });
  if (error instanceof AuthError) return reply.code(error.code === 'unauthorized' ? 401 : 403).send({ error: { code: error.code, message: error.message } });
  return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
}

export function registerActivityRoutes(app: FastifyInstance, service: ActivitiesService, auth: AuthService) {
  app.get('/api/v1/activities', async (request, reply) => {
    try { return reply.send({ activities: service.list(identityFromRequest(request, auth)) }); } catch (error) { return sendError(reply, error); }
  });
  app.put('/api/v1/activities', async (request, reply) => {
    try { return reply.send({ activities: service.replaceAll(identityFromRequest(request, auth), bodyValue(request)) }); } catch (error) { return sendError(reply, error); }
  });
}
