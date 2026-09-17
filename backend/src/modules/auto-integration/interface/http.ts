import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type AuthService } from '../../auth/public/index.js';
import { AutoIntegrationError, type AutoAccountInput, type AutoIntegrationService, type AutoLoginInput, type AutoMessageInput, type AutoServerInput } from '../public/index.js';

type Body = Record<string, unknown>;

function body(request: FastifyRequest): Body {
  const value = request.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AutoIntegrationError('invalid-input', 'request body must be an object');
  return value as Body;
}

function only(value: Body, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new AutoIntegrationError('invalid-input', 'request contains an unknown field');
}

function text(value: unknown, name: string, required = true) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) throw new AutoIntegrationError('invalid-input', `${name} is invalid`);
  return value.trim();
}

function bool(value: unknown, name: string) {
  if (value !== undefined && typeof value !== 'boolean') throw new AutoIntegrationError('invalid-input', `${name} is invalid`);
  return value as boolean | undefined;
}

function serverInput(value: Body, partial: boolean): AutoServerInput | Partial<AutoServerInput> {
  only(value, ['id', 'name', 'address', 'version', 'map_id', 'enabled']);
  const result: Partial<AutoServerInput> = {};
  if (!partial || value.name !== undefined) result.name = text(value.name, 'name')!;
  if (!partial || value.address !== undefined) result.address = text(value.address, 'address')!;
  if (value.version !== undefined) result.version = text(value.version, 'version')!;
  if (!partial || value.map_id !== undefined) result.map_id = text(value.map_id, 'map_id')!;
  if (value.id !== undefined) result.id = text(value.id, 'id');
  if (value.enabled !== undefined) result.enabled = bool(value.enabled, 'enabled');
  return result as AutoServerInput;
}

function accountInput(value: Body, partial: boolean): AutoAccountInput | Partial<AutoAccountInput> {
  only(value, ['username', 'password', 'character_id', 'character_name', 'enabled', 'session_id']);
  const result: Partial<AutoAccountInput> = {};
  if (!partial || value.username !== undefined) result.username = text(value.username, 'username')!;
  if (!partial || value.character_id !== undefined) result.character_id = text(value.character_id, 'character_id')!;
  if (value.password !== undefined) result.password = text(value.password, 'password');
  if (value.character_name !== undefined) result.character_name = text(value.character_name, 'character_name', false);
  if (value.enabled !== undefined) result.enabled = bool(value.enabled, 'enabled');
  if (value.session_id !== undefined) result.session_id = text(value.session_id, 'session_id');
  return result as AutoAccountInput;
}

function loginInput(value: Body): AutoLoginInput {
  only(value, ['account', 'password']);
  return { account: text(value.account, 'account')!, password: text(value.password, 'password')! };
}

function characterInput(value: Body) {
  only(value, ['character_id']);
  return text(value.character_id, 'character_id')!;
}

function messageInput(value: Body): AutoMessageInput {
  only(value, ['message', 'mode']);
  const message = text(value.message, 'message')!;
  if (message.length > 512) throw new AutoIntegrationError('invalid-input', 'message is too long');
  const mode = value.mode ?? 'privateChat';
  if (mode !== 'scene' && mode !== 'guild' && mode !== 'team' && mode !== 'world' && mode !== 'privateChat') throw new AutoIntegrationError('invalid-input', 'mode is invalid');
  return { message, mode };
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AutoIntegrationError) {
    const status = error.code === 'forbidden' ? 403 : error.code === 'connection-disabled' || error.code === 'endpoint-not-configured' || error.code === 'endpoint-unavailable' ? 503 : error.code === 'not_found' || error.code === 'server_not_found' || error.code === 'account_not_found' || error.code === 'session_not_found' ? 404 : error.code === 'account_exists' || error.code === 'server_exists' || error.code === 'invalid_state' || error.code === 'session_server_mismatch' ? 409 : error.code === 'timeout' || error.code === 'map_initialization_timeout' ? 504 : error.code === 'auto-request-failed' ? 502 : 400;
    return reply.code(status).send({ error: { code: error.code, message: error.message } });
  }
  if (error instanceof AuthError) return reply.code(error.code === 'unauthorized' ? 401 : 403).send({ error: { code: error.code, message: error.message } });
  return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
}

export function registerAutoIntegrationRoutes(app: FastifyInstance, service: AutoIntegrationService, auth: AuthService) {
  const identity = (request: FastifyRequest) => auth.requestIdentity(request.headers as Record<string, unknown>);
  const route = async (request: FastifyRequest, reply: FastifyReply, action: () => Promise<unknown>) => {
    try { return reply.send(await action()); } catch (error) { return sendError(reply, error); }
  };

  app.get('/api/v1/auto/status', async (request, reply) => route(request, reply, () => service.status(identity(request))));
  app.post('/api/v1/auto/connection', async (request, reply) => {
    try { const value = body(request); only(value, ['enabled', 'confirmation']); return reply.send(await service.setConnection(identity(request), value.enabled, value.confirmation)); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/auto/overview', async (request, reply) => route(request, reply, () => service.overview(identity(request))));

  app.post('/api/v1/auto/servers/:serverId/sessions', async (request, reply) => {
    try { const params = request.params as { serverId: string }; return reply.code(201).send(await service.startSession(identity(request), params.serverId, loginInput(body(request)))); } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/auto/sessions/:sessionId/select-and-enter', async (request, reply) => {
    try { const params = request.params as { sessionId: string }; return reply.send(await service.selectAndEnterSession(identity(request), params.sessionId, characterInput(body(request)))); } catch (error) { return sendError(reply, error); }
  });
  app.delete('/api/v1/auto/sessions/:sessionId', async (request, reply) => {
    try { await service.stopSession(identity(request), (request.params as { sessionId: string }).sessionId); return reply.code(204).send(); } catch (error) { return sendError(reply, error); }
  });

  app.post('/api/v1/auto/servers', async (request, reply) => {
    try { const value = serverInput(body(request), false) as AutoServerInput; return reply.code(201).send(await service.createServer(identity(request), value)); } catch (error) { return sendError(reply, error); }
  });
  app.patch('/api/v1/auto/servers/:serverId', async (request, reply) => {
    try { return reply.send(await service.updateServer(identity(request), (request.params as { serverId: string }).serverId, serverInput(body(request), true))); } catch (error) { return sendError(reply, error); }
  });
  app.delete('/api/v1/auto/servers/:serverId', async (request, reply) => {
    try { await service.deleteServer(identity(request), (request.params as { serverId: string }).serverId); return reply.code(204).send(); } catch (error) { return sendError(reply, error); }
  });

  app.get('/api/v1/auto/servers/:serverId/accounts', async (request, reply) => route(request, reply, async () => {
    const overview = await service.overview(identity(request));
    const server = overview.servers.find((item) => item.id === (request.params as { serverId: string }).serverId);
    if (!server) throw new AutoIntegrationError('not_found');
    return { accounts: server.accounts };
  }));
  app.post('/api/v1/auto/servers/:serverId/accounts', async (request, reply) => {
    try { const result = await service.createAccount(identity(request), (request.params as { serverId: string }).serverId, accountInput(body(request), false) as AutoAccountInput); return reply.code(201).send(result); } catch (error) { return sendError(reply, error); }
  });
  app.patch('/api/v1/auto/servers/:serverId/accounts/:accountId', async (request, reply) => {
    try { return reply.send(await service.updateAccount(identity(request), (request.params as { serverId: string }).serverId, (request.params as { accountId: string }).accountId, accountInput(body(request), true))); } catch (error) { return sendError(reply, error); }
  });
  app.delete('/api/v1/auto/servers/:serverId/accounts/:accountId', async (request, reply) => {
    try { await service.deleteAccount(identity(request), (request.params as { serverId: string }).serverId, (request.params as { accountId: string }).accountId); return reply.code(204).send(); } catch (error) { return sendError(reply, error); }
  });

  for (const action of ['startAccount', 'stopAccount', 'reconnectAccount'] as const) {
    app.post(`/api/v1/auto/servers/:serverId/accounts/:accountId/${action.replace('Account', '').toLowerCase()}`, async (request, reply) => {
      try { const params = request.params as { serverId: string; accountId: string }; return reply.send(await service[action](identity(request), params.serverId, params.accountId)); } catch (error) { return sendError(reply, error); }
    });
  }
  app.post('/api/v1/auto/servers/:serverId/accounts/:accountId/message', async (request, reply) => {
    try { const params = request.params as { serverId: string; accountId: string }; return reply.send(await service.sendMessage(identity(request), params.serverId, params.accountId, messageInput(body(request)))); } catch (error) { return sendError(reply, error); }
  });
}
