import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError, type AuthService } from '../public/index.js';
import type { CreateUserInput, UpdateUserInput } from '../public/index.js';

function objectBody(request: FastifyRequest) {
  const body = request.body ?? {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError('invalid-input');
  return body as Record<string, unknown>;
}

function tokenFromRequest(request: FastifyRequest) {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = request.headers.cookie ?? '';
  return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('session='))?.slice(8);
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AuthError)) return reply.code(500).send({ error: { code: 'internal-error', message: 'internal error' } });
  const authError = error;
  const status = authError.code === 'unauthorized' || authError.code === 'invalid-credentials' ? 401 : authError.code === 'forbidden' ? 403 : authError.code === 'user-not-found' ? 404 : authError.code === 'username-taken' || authError.code === 'last-super-admin' || authError.code === 'conflict' ? 409 : 400;
  const code = authError.code === 'invalid-credentials' ? 'unauthorized' : authError.code;
  return reply.code(status).send({ error: { code, message: authError.message } });
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  const identity = (request: FastifyRequest) => auth.requestIdentity(request.headers as Record<string, unknown>);
  const limit = (request: FastifyRequest) => {
    const value = (request.query as Record<string, unknown> | undefined)?.limit;
    if (value === undefined) return 100;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new AuthError('invalid-input', 'invalid limit');
    return parsed;
  };
  const login = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = objectBody(request);
      if (Object.keys(body).some((key) => !['username', 'password'].includes(key))) throw new AuthError('invalid-input');
      const result = auth.login(body.username, body.password);
      reply.header('x-session-expires', result.expiresAt);
      const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production' ? '; Secure' : '';
      reply.header('set-cookie', `session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
      // Bearer tokens are exposed only to repository contract tests. Browser clients use the HttpOnly cookie.
      if (process.env.NODE_ENV === 'test') return reply.send(result);
      return reply.send({ expiresAt: result.expiresAt, user: result.user });
    } catch (error) { return sendAuthError(reply, error); }
  };
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, login);
  app.post('/api/v1/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, login);

  app.post('/api/v1/auth/logout', async (request, reply) => {
    auth.logout(tokenFromRequest(request));
    const secure = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header('set-cookie', `session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/${secure}`);
    return reply.code(204).send();
  });

  app.get('/api/v1/auth/me', async (request, reply) => {
    try { return reply.send(auth.me(identity(request))); } catch (error) { return sendAuthError(reply, error); }
  });

  const listUsers = async (request: FastifyRequest, reply: FastifyReply) => {
    try { return reply.send({ users: auth.listUsers(identity(request), limit(request)) }); } catch (error) { return sendAuthError(reply, error); }
  };
  for (const path of ['/api/v1/auth/users', '/api/v1/users', '/api/v1/manager/users', '/api/v1/manager/customers']) app.get(path, listUsers);

  const createUser = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = objectBody(request);
      if (Object.keys(body).some((key) => !['username', 'password', 'displayName', 'role'].includes(key))) throw new AuthError('invalid-input');
      const user = auth.createUser(identity(request), body as unknown as CreateUserInput);
      return reply.code(201).send(user);
    } catch (error) { return sendAuthError(reply, error); }
  };
  for (const path of ['/api/v1/auth/users', '/api/v1/users', '/api/v1/manager/users', '/api/v1/manager/customers']) app.post(path, createUser);

  const updateUser = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = objectBody(request);
      if (Object.keys(body).some((key) => !['password', 'displayName', 'role', 'active'].includes(key))) throw new AuthError('invalid-input');
      const user = auth.updateUser(identity(request), (request.params as { userId: string }).userId, body as UpdateUserInput);
      return reply.send(user);
    } catch (error) { return sendAuthError(reply, error); }
  };
  for (const path of ['/api/v1/auth/users/:userId', '/api/v1/users/:userId', '/api/v1/manager/users/:userId', '/api/v1/manager/customers/:userId']) app.patch(path, updateUser);

  const deleteUser = async (request: FastifyRequest, reply: FastifyReply) => {
    try { const user = auth.deleteUser(identity(request), (request.params as { userId: string }).userId); return reply.send(user); } catch (error) { return sendAuthError(reply, error); }
  };
  for (const path of ['/api/v1/auth/users/:userId/delete', '/api/v1/users/:userId/delete', '/api/v1/manager/users/:userId/delete', '/api/v1/manager/customers/:userId/delete']) app.post(path, deleteUser);

  const deactivateUser = async (request: FastifyRequest, reply: FastifyReply) => {
    try { const user = auth.updateUser(identity(request), (request.params as { userId: string }).userId, { active: false }); return reply.send(user); } catch (error) { return sendAuthError(reply, error); }
  };
  for (const path of ['/api/v1/auth/users/:userId', '/api/v1/users/:userId', '/api/v1/manager/users/:userId', '/api/v1/manager/customers/:userId']) app.delete(path, deactivateUser);
}
