import type { FastifyInstance } from 'fastify';
import { loginResult, submittedUsername, type LoginAuditSink } from '../domain/login-audit.js';
import { canonicalClientIp } from '../domain/ip-access.js';

/** Observe completion once, including early denials, without reading raw bodies
 * or changing quota/admission order. Already parsed usernames are available on
 * request.body; an early response truthfully records username=null instead.
 */
export function registerLoginAudit(app: FastifyInstance, sink: LoginAuditSink) {
  let lastErrorAt = -Infinity;
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.method !== 'POST' || (route !== '/api/v1/auth/login' && route !== '/api/v1/login')) return;
    try {
      sink.append({ event: 'auth.login.attempt', time: new Date().toISOString(),
        requestId: request.id.slice(0, 64), ip: canonicalClientIp(request.ip).slice(0, 64), route,
        ...submittedUsername(request.body), status: reply.statusCode, result: loginResult(reply.statusCode) });
    } catch {
      // A full/unwritable log must not replace the real authentication result.
      // Emit a bounded, secret-free diagnostic and retry on the next request.
      const now = Date.now();
      if (now < lastErrorAt || now - lastErrorAt >= 60_000) {
        lastErrorAt = now;
        console.error(JSON.stringify({ event: 'auth.login.audit_error', reason: 'write-failed', time: new Date().toISOString() }));
      }
    }
  });
}
