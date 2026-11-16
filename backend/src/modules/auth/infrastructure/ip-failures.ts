import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import { MAX_FAILURE_IPS, type IpFailureStore } from '../domain/ip-access.js';

/** Test adapter; production always injects SQLite. Returned counts have no shared mutable objects. */
export class MemoryIpFailureStore implements IpFailureStore {
  private readonly counts = new Map<string, number>();
  failures(ip: string) { return this.counts.get(ip) ?? 0; }
  increment(ip: string, ceiling: number) {
    if (!this.counts.has(ip) && this.counts.size >= MAX_FAILURE_IPS) return null;
    const count = Math.min(this.failures(ip) + 1, ceiling);
    this.counts.set(ip, count);
    return count;
  }
}

/** The caller owns the database connection. A single immediate transaction
 * reserves capacity and increments: concurrent writers cannot lose failures or
 * evict permanent bans. There are no credentials, audit events or source paths.
 */
export class SqliteIpFailureStore implements IpFailureStore {
  constructor(private readonly db: SqliteDatabase) {}
  failures(ip: string): number {
    return (this.db.prepare('SELECT failures FROM auth_ip_failures WHERE ip = ?').get(ip) as { failures: number } | undefined)?.failures ?? 0;
  }
  increment(ip: string, ceiling: number): number | null {
    return this.db.transaction(() => {
      if (!this.failures(ip)) {
        const { count } = this.db.prepare('SELECT COUNT(*) AS count FROM auth_ip_failures').get() as { count: number };
        if (count >= MAX_FAILURE_IPS) return null;
      }
      const row = this.db.prepare(`INSERT INTO auth_ip_failures (ip, failures) VALUES (?, 1)
        ON CONFLICT(ip) DO UPDATE SET failures = MIN(failures + 1, ?)
        RETURNING failures`).get(ip, ceiling) as { failures: number };
      return row.failures;
    }).immediate();
  }
}
