import { isIP } from 'node:net';

export const PERMANENT_FAILURE_LIMIT = 20;
export const MAX_FAILURE_IPS = 100_000;

/** Only cumulative failures are durable; credentials and request bodies are never stored. */
export interface IpFailureStore {
  failures(ip: string): number;
  /** Atomically increment up to ceiling; null means new-address capacity is exhausted. */
  increment(ip: string, ceiling: number): number | null;
}

export class IpAccessError extends Error {
  constructor(public readonly code: 'ipv6-disabled' | 'ip-permanently-banned' | 'ip-protection-capacity' | 'invalid-client-ip',
    public readonly status: 400 | 403 | 503, message: string) { super(message); }
}

/** Normalize equivalent addresses first, so mapped IPv4 is still treated as IPv4. */
export function canonicalClientIp(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const canonical = new URL(`http://[${ip.split('%')[0]}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/u.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

/** Auth owns the permanent policy. Each request rechecks storage, so an operator's
 * explicit unban takes effect without a restart. Success/temporary expiry never
 * clears the lifetime count; denied requests never count as password failures.
 */
export class IpAccessPolicy {
  constructor(private readonly store: IpFailureStore) {}

  assertAllowed(address: string): string {
    const ip = canonicalClientIp(address);
    if (isIP(ip) === 6) throw new IpAccessError('ipv6-disabled', 403, '本站仅允许 IPv4 访问，请使用 IPv4 网络');
    if (isIP(ip) !== 4) throw new IpAccessError('invalid-client-ip', 400, '客户端 IP 无效');
    this.checkCount(this.store.failures(ip));
    return ip;
  }

  recordFailure(ip: string) {
    const count = this.store.increment(ip, PERMANENT_FAILURE_LIMIT + 1);
    if (count === null) throw new IpAccessError('ip-protection-capacity', 503, '登录保护存储已满，请联系管理员');
    this.checkCount(count);
  }

  private checkCount(count: number) {
    if (count > PERMANENT_FAILURE_LIMIT) {
      throw new IpAccessError('ip-permanently-banned', 403, `该 IP 密码错误累计超过 ${PERMANENT_FAILURE_LIMIT} 次，已永久封禁，请联系管理员`);
    }
  }
}
