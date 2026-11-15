import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../src/modules/auth/public/index.js';
import { LoginLimiter } from '../src/modules/auth/domain/login-limiter.js';

describe('auth IP login protection', () => {
  let now: number;
  let limiter: LoginLimiter;
  const ip = '192.0.2.1';
  const invalid = () => { throw new AuthError('invalid-credentials'); };
  const attempt = (verify = invalid) => {
    limiter.admit(ip);
    return limiter.authenticate(ip, verify);
  };

  beforeEach(() => {
    now = 1_000_000;
    limiter = new LoginLimiter(() => now);
  });

  it('uses a sliding five-minute window and does not extend it on rejection', () => {
    limiter.admit(ip);
    now += 150_000;
    for (let i = 0; i < 9; i++) limiter.admit(ip);
    now += 149_001;
    expect(() => limiter.admit(ip)).toThrow(expect.objectContaining({ code: 'login-rate-limited', retryAfterSeconds: 1 }));
    now += 999;
    expect(() => limiter.admit(ip)).not.toThrow();
    expect(() => limiter.admit(ip)).toThrow(expect.objectContaining({ code: 'login-rate-limited', retryAfterSeconds: 150 }));
    expect(() => limiter.admit('192.0.2.2')).not.toThrow();
  });

  it('blocks on the fifth failure across request windows and recovers at exactly twenty minutes', () => {
    for (let i = 0; i < 4; i++) {
      expect(attempt).toThrow(expect.objectContaining({ code: 'invalid-credentials' }));
      now += 300_000;
    }
    expect(attempt).toThrow(expect.objectContaining({ code: 'login-blocked', retryAfterSeconds: 1200 }));
    const verify = vi.fn(() => 'session');
    now += 1_199_001;
    expect(() => limiter.authenticate(ip, verify)).toThrow(expect.objectContaining({ code: 'login-blocked', retryAfterSeconds: 1 }));
    expect(verify).not.toHaveBeenCalled();
    now += 999;
    expect(attempt).toThrow(expect.objectContaining({ code: 'invalid-credentials' }));
    expect(limiter.authenticate(ip, verify)).toBe('session');
  });

  it('clears failures on success but still counts successful login requests', () => {
    for (let i = 0; i < 4; i++) expect(attempt).toThrow(AuthError);
    limiter.admit(ip);
    expect(limiter.authenticate(ip, () => 'session')).toBe('session');
    for (let i = 0; i < 4; i++) expect(attempt).toThrow(AuthError);
    limiter.admit(ip);
    limiter.authenticate(ip, () => 'another session');
    expect(() => limiter.admit(ip)).toThrow(expect.objectContaining({ code: 'login-rate-limited' }));
    now += 300_000;
    for (let i = 0; i < 4; i++) expect(attempt).toThrow(AuthError);
    expect(attempt).toThrow(expect.objectContaining({ code: 'login-blocked' }));
  });

  it('does not count throttled, invalid-structure or internal errors as credential failures', () => {
    for (let i = 0; i < 4; i++) expect(attempt).toThrow(AuthError);
    for (let i = 0; i < 6; i++) {
      const error = i % 2 ? new AuthError('invalid-input') : new Error('storage failed');
      limiter.admit(ip);
      expect(() => limiter.authenticate(ip, () => { throw error; })).toThrow(error);
    }
    for (let i = 0; i < 20; i++) expect(attempt).toThrow(expect.objectContaining({ code: 'login-rate-limited' }));
    now += 300_000;
    expect(attempt).toThrow(expect.objectContaining({ code: 'login-blocked' }));
  });

  it('rechecks the ban for requests admitted before another request causes a lock', () => {
    for (let i = 0; i < 4; i++) expect(attempt).toThrow(AuthError);
    limiter.admit(ip);
    limiter.admit(ip);
    expect(() => limiter.authenticate(ip, invalid)).toThrow(expect.objectContaining({ code: 'login-blocked' }));
    const verify = vi.fn(() => 'session');
    expect(() => limiter.authenticate(ip, verify)).toThrow(expect.objectContaining({ code: 'login-blocked' }));
    expect(verify).not.toHaveBeenCalled();
  });

  it('bounds memory without evicting failures, and reclaims completed windows', () => {
    for (let i = 0; i < 10_000; i++) {
      const address = `client-${i}`;
      limiter.admit(address);
      expect(() => limiter.authenticate(address, invalid)).toThrow(AuthError);
    }
    now += 300_000;
    expect(() => limiter.admit('new-client')).toThrow(expect.objectContaining({ code: 'login-capacity' }));
    // Existing clients can still recover; the next cleanup frees their window.
    limiter.admit('client-0');
    limiter.authenticate('client-0', () => 'session');
    now += 300_000;
    expect(() => limiter.admit('new-client')).not.toThrow();
  });

  it('reclaims expired bans while retaining unexpired bans', () => {
    for (let i = 0; i < 4; i++) expect(attempt).toThrow(AuthError);
    expect(attempt).toThrow(expect.objectContaining({ code: 'login-blocked' }));
    now += 60_000;
    limiter.admit('another-ip');
    expect(attempt).toThrow(expect.objectContaining({ code: 'login-blocked', retryAfterSeconds: 1140 }));
    now += 1_140_000;
    expect(attempt).toThrow(expect.objectContaining({ code: 'invalid-credentials' }));
  });
});
