import type { FastifyInstance, FastifyReply } from 'fastify';
import { AuthError, type AuthService } from '../../auth/public/index.js';
import { TeamViewError, type TeamViewService } from '../public/index.js';
import { GroupError, type OperationGroupsService } from '../../operation-groups/public/index.js';
import type { PlayerDirectoryService } from '../../player-directory/public/index.js';
import { applyTeamRewards } from '../application/apply-rewards.js';

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof TeamViewError) return reply.code(error.code === 'unauthorized' ? 401 : error.code === 'forbidden' ? 403 : error.code === 'source-unavailable' ? 503 : 400).send({ error: { code: error.code, message: error.message } });
  if (error instanceof AuthError) return reply.code(error.code === 'unauthorized' ? 401 : 403).send({ error: { code: error.code, message: error.message } });
  if (error instanceof GroupError) return reply.code(error.code === 'forbidden' ? 403 : 400).send({ error: { code: error.code, message: error.message } });
  return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
}

export function registerTeamViewRoutes(app: FastifyInstance, service: TeamViewService, auth: AuthService, groups?: OperationGroupsService, directory?: PlayerDirectoryService) {
  app.post('/api/v1/team-view/clears/import', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    try {
      const identity = auth.requestIdentity(request.headers as Record<string, unknown>);
      const body = request.body as { serverId?: unknown; file?: unknown } | null;
      return reply.code(201).send(service.importClears(identity, body?.serverId, body?.file));
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/team-view', async (request, reply) => {
    try {
      const identity = auth.requestIdentity(request.headers as Record<string, unknown>);
      const query = request.query as Record<string, unknown>;
      return reply.send(service.view(identity, query.date === undefined ? undefined : String(query.date)));
    } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/team-view/apply', async (request, reply) => {
    try {
      if (!groups || !directory) throw new TeamViewError('source-unavailable', 'batch application unavailable');
      const actor = auth.requestIdentity(request.headers as Record<string, unknown>);
      return reply.send(applyTeamRewards(service, groups, directory, actor, request.body));
    } catch (error) { return sendError(reply, error); }
  });
}
