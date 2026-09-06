import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type AuthService } from '../../auth/public/index.js';
import { TeamViewError, type TeamViewService } from '../public/index.js';

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof TeamViewError) return reply.code(error.code === 'unauthorized' ? 401 : error.code === 'source-unavailable' ? 503 : 400).send({ error: { code: error.code, message: error.message } });
  if (error instanceof AuthError) return reply.code(error.code === 'unauthorized' ? 401 : 403).send({ error: { code: error.code, message: error.message } });
  return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
}

export function registerTeamViewRoutes(app: FastifyInstance, service: TeamViewService, auth: AuthService) {
  app.get('/api/v1/team-view', async (request, reply) => {
    try {
      const identity = auth.requestIdentity(request.headers as Record<string, unknown>);
      const query = request.query as Record<string, unknown>;
      return reply.send(service.view(identity, query.date === undefined ? undefined : String(query.date)));
    } catch (error) { return sendError(reply, error); }
  });
}
