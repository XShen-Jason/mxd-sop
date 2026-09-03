import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, AuthService } from '../../auth/public/index.js';
import { CatalogError, type ItemCatalog } from '../../item-catalog/public/index.js';
import { GroupError, type OperationGroupsService } from '../public/index.js';
import type { GroupStatus, Identity, Role, SubmitGroupInput } from '../../../shared/types.js';

type Query = Record<string, unknown>;
export { AuthError };

function headerValue(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '';
}

/** Identity is resolved from the auth adapter; headers are only a local demo fallback. */
export function identityFromRequest(request: FastifyRequest, auth?: AuthService): Identity {
  if (auth) return auth.requestIdentity(request.headers as Record<string, unknown>);
  const roleValue = headerValue(request, 'x-user-role');
  const userId = headerValue(request, 'x-user-id');
  if (!roleValue || !userId || !userId.trim() || userId.length > 128 || /[\s\u0000-\u001f\u007f]/u.test(userId) || !['customer', 'manager', 'super_admin'].includes(roleValue)) throw new AuthError('unauthorized');
  const role: Role = roleValue as Role;
  return { id: userId, role, displayName: headerValue(request, 'x-display-name') || (role === 'customer' ? '演示客服' : role === 'manager' ? '演示管理' : '演示超管') };
}

function limitOf(query: Query, fallback = 20) {
  if (query.limit === undefined) return fallback;
  const value = Number(query.limit);
  if (!Number.isInteger(value)) throw new GroupError('invalid-input', 'invalid limit');
  return value;
}

function errorStatus(error: unknown) {
  if (error instanceof GroupError) {
    if (error.code === 'forbidden') return 403;
    if (error.code === 'group-not-found') return 404;
    if (['unknown-server', 'unknown-item', 'invalid-quantity', 'invalid-status'].includes(error.code)) return 422;
    if (['idempotency-conflict', 'conflict', 'invalid-status-transition'].includes(error.code)) return 409;
    if (error.code === 'generation-failed') return 500;
    return 400;
  }
  if (error instanceof AuthError) {
    if (error.code === 'unauthorized' || error.code === 'invalid-credentials') return 401;
    if (error.code === 'forbidden') return 403;
    if (error.code === 'username-taken' || error.code === 'conflict' || error.code === 'last-super-admin') return 409;
    if (error.code === 'user-not-found') return 404;
    return 400;
  }
  if (error instanceof CatalogError) return error.code === 'catalog-unavailable' ? 503 : 400;
  return 500;
}

export function sendError(reply: FastifyReply, error: unknown) {
  const status = errorStatus(error);
  const code = error instanceof AuthError && error.code === 'invalid-credentials' ? 'unauthorized' : error instanceof GroupError || error instanceof CatalogError || error instanceof AuthError ? error.code : 'internal-error';
  return reply.code(status).send({ error: { code, message: error instanceof Error ? error.message : 'internal error' } });
}

function bodyObject(request: FastifyRequest) {
  const body = request.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body) || body === null) throw new GroupError('invalid-input');
  return body as Record<string, unknown>;
}

export function registerOperationRoutes(app: FastifyInstance, service: OperationGroupsService, catalog: ItemCatalog, auth?: AuthService) {
  const identity = (request: FastifyRequest) => identityFromRequest(request, auth);
  app.get('/api/v1/operation-groups/options', async (request, reply) => {
    try { identity(request); return reply.send(service.getOptions()); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/item-catalog/search', async (request, reply) => {
    try { identity(request); const query = request.query as Query; return reply.send(catalog.search(String(query.q ?? ''), limitOf(query), query.cursor ? String(query.cursor) : undefined)); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/item-catalog/by-class', async (request, reply) => {
    try {
      identity(request);
      const query = request.query as Query;
      const itemClass = String(query.class ?? '').trim();
      const limit = limitOf(query);
      return reply.send(catalog.listByClass(itemClass, limit, query.cursor ? String(query.cursor) : undefined));
    } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/operation-groups', async (request, reply) => {
    try {
      const idempotencyKey = headerValue(request, 'idempotency-key');
      if (idempotencyKey && (idempotencyKey.length > 128 || /[\s\u0000-\u001f\u007f]/u.test(idempotencyKey))) throw new GroupError('invalid-input', 'invalid idempotency key');
      return reply.code(201).send(service.submit(identity(request), request.body as SubmitGroupInput, idempotencyKey || undefined));
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/operation-groups/mine', async (request, reply) => {
    try {
      const query = request.query as Query;
      const statuses = query.status === undefined ? undefined : (Array.isArray(query.status) ? query.status.map(String) : String(query.status).split(',')).filter(Boolean) as GroupStatus[];
      const kind = query.kind === undefined ? undefined : String(query.kind) as 'issuance' | 'regular';
      if (kind !== undefined && kind !== 'issuance' && kind !== 'regular') throw new GroupError('invalid-input', 'invalid kind');
      const normalizedStatus = statuses?.length ? (statuses.length === 1 ? statuses[0] : statuses) : undefined;
      return reply.send(service.listOwn(identity(request), limitOf(query), query.cursor ? String(query.cursor) : undefined, normalizedStatus, kind));
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/operation-groups/reminders', async (request, reply) => {
    try {
      const query = request.query as Query;
      const kind = query.kind === undefined ? undefined : String(query.kind) as 'issuance' | 'regular';
      if (kind !== undefined && kind !== 'issuance' && kind !== 'regular') throw new GroupError('invalid-input', 'invalid kind');
      return reply.send(service.listReminders(identity(request), limitOf(query), query.cursor ? String(query.cursor) : undefined, kind));
    } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/operation-groups/workspace-counts', async (request, reply) => {
    try { return reply.send(service.workspaceCounts(identity(request))); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/operation-groups/events', async (request, reply) => {
    try {
      identity(request);
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' });
      reply.raw.write(': connected\n\n');
      const writeEvent = (payload: string) => { if (reply.raw.writableEnded || reply.raw.destroyed) return; try { reply.raw.write(payload); } catch { /* The client may disconnect between the guard and write. */ } };
      const unsubscribe = service.subscribe(() => writeEvent('event: changed\ndata: {}\n\n'));
      const heartbeat = setInterval(() => writeEvent(': keepalive\n\n'), 25_000);
      const close = () => { clearInterval(heartbeat); unsubscribe(); };
      request.raw.once('close', close);
    } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/operation-groups/:groupId/cancel', async (request, reply) => {
    try { return reply.send(service.cancel(identity(request), (request.params as { groupId: string }).groupId)); } catch (error) { return sendError(reply, error); }
  });
  app.delete('/api/v1/operation-groups/:groupId', async (request, reply) => {
    try { return reply.send(service.cancel(identity(request), (request.params as { groupId: string }).groupId)); } catch (error) { return sendError(reply, error); }
  });
  app.put('/api/v1/operation-groups/:groupId', async (request, reply) => {
    try { return reply.send(service.update(identity(request), (request.params as { groupId: string }).groupId, request.body as SubmitGroupInput)); } catch (error) { return sendError(reply, error); }
  });
  app.patch('/api/v1/operation-groups/:groupId', async (request, reply) => {
    try { return reply.send(service.update(identity(request), (request.params as { groupId: string }).groupId, request.body as SubmitGroupInput)); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/manager/operation-groups/queue', async (request, reply) => {
    try { const query = request.query as Query; return reply.send(service.listQueue(identity(request), limitOf(query), query.cursor ? String(query.cursor) : undefined, query.serverId ? String(query.serverId) : undefined)); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/manager/operation-groups/reviews', async (request, reply) => {
    try { const query = request.query as Query; return reply.send(service.listReview(identity(request), limitOf(query), query.cursor ? String(query.cursor) : undefined, query.serverId ? String(query.serverId) : undefined)); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/manager/operation-groups/overview', async (request, reply) => {
    try { const query = request.query as Query; return reply.send(service.listOverview(identity(request), limitOf(query, 100), query.cursor ? String(query.cursor) : undefined)); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/manager/overview', async (request, reply) => {
    try { const query = request.query as Query; return reply.send(service.listOverview(identity(request), limitOf(query, 100), query.cursor ? String(query.cursor) : undefined)); } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/manager/operation-groups/:groupId/approve', async (request, reply) => {
    try { return reply.send(service.approve(identity(request), (request.params as { groupId: string }).groupId)); } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/manager/operation-groups/:groupId/confirm', async (request, reply) => {
    try { return reply.send(service.approve(identity(request), (request.params as { groupId: string }).groupId)); } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/manager/operation-groups/:groupId/reject', async (request, reply) => {
    try { const body = bodyObject(request); if (Object.keys(body).some((key) => key !== 'reason' && key !== 'rejectionReason')) throw new GroupError('invalid-input'); const reason = body.reason ?? body.rejectionReason; if (reason !== undefined && typeof reason !== 'string') throw new GroupError('invalid-input'); return reply.send(service.reject(identity(request), (request.params as { groupId: string }).groupId, reason as string | undefined)); } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/manager/operation-groups/:groupId/issue', async (request, reply) => {
    try { const body = bodyObject(request); if (Object.keys(body).some((key) => key !== 'executionNote')) throw new GroupError('invalid-input'); if (body.executionNote !== undefined && typeof body.executionNote !== 'string') throw new GroupError('invalid-input'); return reply.send(service.issue(identity(request), (request.params as { groupId: string }).groupId, body.executionNote as string | undefined)); } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/super-admin/operation-groups/:groupId/remind', async (request, reply) => {
    try { return reply.send(service.remind(identity(request), (request.params as { groupId: string }).groupId)); } catch (error) { return sendError(reply, error); }
  });
  app.post('/api/v1/manager/operation-groups/:groupId/deliver', async (request, reply) => {
    try { const body = bodyObject(request); if (Object.keys(body).some((key) => key !== 'executionNote')) throw new GroupError('invalid-input'); if (body.executionNote !== undefined && typeof body.executionNote !== 'string') throw new GroupError('invalid-input'); return reply.send(service.issue(identity(request), (request.params as { groupId: string }).groupId, body.executionNote as string | undefined)); } catch (error) { return sendError(reply, error); }
  });
  // Legacy completion endpoint remains available for old clients.
  app.post('/api/v1/manager/operation-groups/:groupId/complete', async (request, reply) => {
    try { const body = bodyObject(request); if (Object.keys(body).some((key) => key !== 'executionNote')) throw new GroupError('invalid-input'); if (body.executionNote !== undefined && typeof body.executionNote !== 'string') throw new GroupError('invalid-input'); return reply.send(service.complete(identity(request), (request.params as { groupId: string }).groupId, body.executionNote as string | undefined)); } catch (error) { return sendError(reply, error); }
  });
  app.get('/api/v1/manager/operation-groups/archive', async (request, reply) => {
    try {
      const query = request.query as Query;
      const status = query.status === undefined ? undefined : (Array.isArray(query.status) ? query.status.map(String) : String(query.status).split(',')).filter(Boolean) as GroupStatus[];
      const kind = query.kind === undefined ? undefined : String(query.kind) as 'issuance' | 'regular';
      if (kind !== undefined && kind !== 'issuance' && kind !== 'regular') throw new GroupError('invalid-input', 'invalid kind');
      const normalizedStatus = status?.length ? (status.length === 1 ? status[0] : status) : undefined;
      return reply.send(service.listArchive(identity(request), limitOf(query), query.cursor ? String(query.cursor) : undefined, normalizedStatus, query.serverId ? String(query.serverId) : undefined, kind));
    } catch (error) { return sendError(reply, error); }
  });
}
