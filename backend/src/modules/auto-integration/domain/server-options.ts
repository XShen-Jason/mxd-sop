import type { ServerOption } from '../../../shared/types.js';
import type { AutoServer } from './types.js';

export interface ServerOptionsRepository {
  get(): ServerOption[];
  save(servers: ServerOption[]): void;
}

/** A derived, durable identity projection; auto remains the configuration owner. */
export class ServerOptionsProjection {
  readonly servers: ServerOption[];
  private pending?: Promise<void>;
  private refreshAfter = 0;
  private revision = 0;

  constructor(legacy: ServerOption[], private readonly repository?: ServerOptionsRepository) {
    this.servers = [...new Map([...legacy, ...(repository?.get() ?? [])].map(server => [server.id, { ...server }])).values()];
  }

  merge(entries: Pick<AutoServer, 'id' | 'name'>[]) {
    if (!Array.isArray(entries) || entries.length > 1000) throw new Error('invalid server catalog');
    const incoming = entries.map(entry => {
      if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(entry.id)
        || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.trim().length > 80
        || /[\u0000-\u001f\u007f]/u.test(entry.name)) throw new Error('invalid server catalog');
      return { id: entry.id, displayName: entry.name.trim() };
    });
    const next = [...new Map([...this.servers, ...incoming].map(server => [server.id, server])).values()];
    if (next.length > 1000) throw new Error('server catalog capacity exceeded');
    if (JSON.stringify(next) === JSON.stringify(this.servers)) return;
    this.repository?.save(next);
    this.servers.splice(0, this.servers.length, ...next);
    this.revision += 1;
  }

  async refresh(read: () => Promise<Pick<AutoServer, 'id' | 'name'>[]>) {
    if (this.pending) return this.pending;
    if (Date.now() < this.refreshAfter) return;
    const revision = this.revision;
    this.pending = (async () => {
      try {
        const entries = await read();
        // A catalog response started before a successful mutation must not undo it.
        if (revision === this.revision) this.merge(entries);
      } catch { /* Keep the last successful projection for manual/offline work. */ }
      finally { this.refreshAfter = Date.now() + 15_000; this.pending = undefined; }
    })();
    return this.pending;
  }
}
