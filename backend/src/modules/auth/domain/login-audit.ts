/** Operational evidence stays outside the business database. These fields are
 * an explicit allowlist: never pass a whole request, response, user or error.
 */
export interface LoginAttemptRecord {
  event: 'auth.login.attempt';
  time: string;
  requestId: string;
  ip: string;
  route: '/api/v1/auth/login' | '/api/v1/login';
  username: string | null;
  usernameState: 'provided' | 'truncated' | 'missing' | 'invalid-type' | 'body-unavailable';
  status: number;
  result: 'success' | 'invalid-credentials' | 'invalid-request' | 'blocked' | 'limited' | 'unavailable' | 'failed';
}

export interface LoginAuditSink {
  /** Synchronous append of one bounded record; callers isolate storage failures from authentication. */
  append(record: LoginAttemptRecord): void;
}

/** Preserve the submitted spelling, spaces and case; truncation is explicit.
 * Username syntax/normalization is still owned by credential validation. This
 * projection does not access passwords, headers, cookies or response bodies.
 */
export function submittedUsername(body: unknown): Pick<LoginAttemptRecord, 'username' | 'usernameState'> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { username: null, usernameState: 'body-unavailable' };
  const input = body as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(input, 'username')) return { username: null, usernameState: 'missing' };
  if (typeof input.username !== 'string') return { username: null, usernameState: 'invalid-type' };
  return { username: input.username.slice(0, 128), usernameState: input.username.length > 128 ? 'truncated' : 'provided' };
}

export function loginResult(status: number): LoginAttemptRecord['result'] {
  if (status >= 200 && status < 300) return 'success';
  if (status === 401) return 'invalid-credentials';
  if (status === 400 || status === 413 || status === 415) return 'invalid-request';
  if (status === 403) return 'blocked';
  if (status === 429) return 'limited';
  if (status >= 500) return 'unavailable';
  return 'failed';
}
