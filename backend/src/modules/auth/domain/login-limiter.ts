import { AuthError } from './service.js';

const WINDOW_MS = 5 * 60_000;
const MAX_REQUESTS = 10;
const MAX_FAILURES = 5;
const BLOCK_MS = 20 * 60_000;
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_TRACKED_IPS = 10_000;

interface Attempts {
  requests: number[];
  failures: number;
  blockedUntil: number;
}

export class LoginLimitError extends Error {
  constructor(
    public readonly code: 'login-rate-limited' | 'login-blocked' | 'login-capacity',
    public readonly retryAfterSeconds: number,
    message: string,
  ) { super(message); }
}

/**
 * Auth-owned, single-process IP protection. Both HTTP login aliases share one
 * instance. Times are milliseconds; failures survive five-minute window rollover,
 * and reset only on successful authentication or expiry of the twenty-minute ban.
 * No credentials are retained. Restarting the process clears this transient state.
 */
export class LoginLimiter {
  private readonly attempts = new Map<string, Attempts>();
  private nextCleanupAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Reserve one request before body parsing, including malformed login requests. */
  admit(ip: string) {
    const now = this.now();
    const state = this.state(ip, now);
    this.checkBlock(state, now);
    state.requests = state.requests.filter((time) => time > now - WINDOW_MS);
    if (state.requests.length >= MAX_REQUESTS) {
      const retry = Math.ceil((state.requests[0] + WINDOW_MS - now) / 1000);
      throw new LoginLimitError('login-rate-limited', retry, `登录请求过于频繁，每 ${WINDOW_MS / 60_000} 分钟最多 ${MAX_REQUESTS} 次，请在 ${retry} 秒后重试`);
    }
    state.requests.push(now);
  }

  /**
   * Run synchronous credential verification and session creation without yielding.
   * Recheck the ban after body parsing: another in-flight request may have locked
   * this IP since admission. Only invalid credentials count as authentication
   * failures; validation/storage errors do not. Never pass an async callback.
   */
  authenticate<T>(ip: string, verify: () => T): T {
    const now = this.now();
    const state = this.state(ip, now);
    this.checkBlock(state, now);
    let result: T;
    try { result = verify(); }
    catch (error) {
      if (error instanceof AuthError && error.code === 'invalid-credentials') {
        state.failures += 1;
        // Lock on the fifth failure itself, even with request quota remaining.
        if (state.failures >= MAX_FAILURES) {
          state.blockedUntil = this.now() + BLOCK_MS;
          this.checkBlock(state, this.now());
        }
      }
      throw error;
    }
    state.failures = 0;
    // Successful logins still consume the shared five-minute request quota.
    return result;
  }

  private checkBlock(state: Attempts, now: number) {
    if (state.blockedUntil > now) {
      const retry = Math.ceil((state.blockedUntil - now) / 1000);
      throw new LoginLimitError('login-blocked', retry, `该 IP 登录失败次数过多，已暂停登录 ${BLOCK_MS / 60_000} 分钟，请在 ${retry} 秒后重试`);
    }
    if (state.blockedUntil) {
      state.blockedUntil = 0;
      state.failures = 0;
    }
  }

  private state(ip: string, now: number): Attempts {
    if (now >= this.nextCleanupAt) {
      this.cleanup(now);
      this.nextCleanupAt = now + CLEANUP_INTERVAL_MS;
    }
    let state = this.attempts.get(ip);
    if (!state) {
      // Never evict active bans or failure counts to admit a new address: that
      // would let IP churn bypass protection. Fail closed at a fixed memory cap.
      if (this.attempts.size >= MAX_TRACKED_IPS) {
        throw new LoginLimitError('login-capacity', 60, '登录服务繁忙，请稍后重试');
      }
      state = { requests: [], failures: 0, blockedUntil: 0 };
      this.attempts.set(ip, state);
    }
    return state;
  }

  /** At most 10,000 entries once per minute; each entry has at most ten times. */
  private cleanup(now: number) {
    for (const [ip, state] of this.attempts) {
      const lastRequest = state.requests.at(-1) ?? -Infinity;
      const expiredBan = state.blockedUntil > 0 && state.blockedUntil <= now;
      if (lastRequest <= now - WINDOW_MS && (expiredBan || (!state.blockedUntil && !state.failures))) {
        this.attempts.delete(ip);
      }
    }
  }
}
