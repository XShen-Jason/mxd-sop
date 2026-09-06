import fs from 'node:fs';
import path from 'node:path';
import { groupRows } from '../domain/search.js';
import type { DirectoryRepository, DirectoryRow } from '../domain/types.js';

export class JsonDirectoryRepository implements DirectoryRepository {
  private rows: DirectoryRow[];

  constructor(private readonly filePath: string) { this.rows = this.read(); }

  replace(rows: DirectoryRow[]) { this.rows = structuredClone(rows); this.persist(); }
  replaceServer(serverId: string, rows: DirectoryRow[]) {
    this.rows = [...this.rows.filter((row) => row.serverId !== serverId), ...structuredClone(rows)];
    this.persist();
  }
  count() { return this.rows.length; }

  search(input: { query: string; serverId?: string; limit: number; offset: number }) {
    const normalized = input.query.toLocaleLowerCase();
    const filtered = this.rows.filter((row) => (!input.serverId || row.serverId === input.serverId) && (!normalized || [row.serverId, row.userId, row.username, row.bindQQ, row.charId].some((value) => value.toLocaleLowerCase().includes(normalized))));
    const grouped = groupRows(filtered);
    const page = grouped.slice(input.offset, input.offset + input.limit).flatMap((group) => group.characterIds.map((charId) => ({ serverId: group.serverId, sourceFile: group.sourceFiles[0], charId, userId: group.userId, username: group.username, bindQQ: group.bindQQ })));
    return { rows: page, totalCount: grouped.length };
  }

  private read() {
    if (!fs.existsSync(this.filePath)) return [];
    try { const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown; return Array.isArray(parsed) ? parsed as DirectoryRow[] : []; }
    catch (error) { throw new Error(`cannot read player directory: ${String(error)}`); }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.rows), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}
