import type { Identity, ServerOption } from '../../../shared/types.js';
import { DirectoryError } from './errors.js';
import { groupRows } from './search.js';
import type { DirectoryPage, DirectoryRepository, DirectorySearchInput, PlayerAccountSync } from './types.js';
import { importCsvFile, type UploadFile } from '../infrastructure/csv.js';

export class PlayerDirectoryService {
  private readonly servers: ReadonlyMap<string, ServerOption>;

  constructor(private readonly repository: DirectoryRepository, servers: ServerOption[], private readonly playerSync?: PlayerAccountSync) {
    this.servers = new Map(servers.map((server) => [server.id, server]));
  }

  search(actor: Identity, input: DirectorySearchInput = {}): DirectoryPage {
    this.requireAuthenticated(actor);
    const query = normalizeQuery(input.query);
    const serverId = normalizeServer(input.serverId, this.servers);
    const limit = normalizeLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const result = this.repository.search({ query, serverId, limit, offset });
    const groups = groupRows(result.rows).map((group) => ({ ...group, server: this.server(group.serverId) }));
    return { accounts: groups, nextCursor: offset + groups.length < result.totalCount ? encodeCursor(offset + groups.length) : null, totalCount: result.totalCount };
  }

  async importFile(actor: Identity, serverId: string, file: UploadFile) {
    if (actor.role !== 'super_admin') throw new DirectoryError('forbidden');
    const targetServer = normalizeServer(serverId, this.servers);
    if (!targetServer) throw new DirectoryError('invalid-file', 'a server is required');
    const imported = importCsvFile(file, targetServer);
    if (this.playerSync) {
      try { await this.playerSync.sync(targetServer, file); }
      catch (error) { throw new DirectoryError('player-sync-failed', error instanceof Error ? error.message : 'player account sync failed'); }
    }
    this.repository.replaceServer(targetServer, imported.rows);
    return { serverId: targetServer, fileCount: 1, rowCount: imported.rows.length, skippedRows: imported.skippedRows, importedAt: new Date().toISOString() };
  }

  private server(id: string) { return this.servers.get(id) ?? { id, displayName: id }; }
  private requireAuthenticated(actor: Identity) { if (!actor?.id) throw new DirectoryError('forbidden'); }
}

function normalizeQuery(value: unknown) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) throw new DirectoryError('invalid-query');
  return value.trim();
}

function normalizeServer(value: unknown, servers: ReadonlyMap<string, ServerOption>) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !servers.has(value)) throw new DirectoryError('invalid-query');
  return value;
}

function normalizeLimit(value: unknown) {
  if (value === undefined) return 20;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new DirectoryError('invalid-query');
  return limit;
}

function encodeCursor(offset: number) { return Buffer.from(JSON.stringify({ offset, version: 1 }), 'utf8').toString('base64url'); }

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown; version?: unknown };
    if (parsed.version !== 1 || !Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) throw new Error();
    return parsed.offset as number;
  } catch { throw new DirectoryError('invalid-cursor'); }
}
