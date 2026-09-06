import type { ServerOption } from '../../../shared/types.js';

export interface DirectoryRow {
  serverId: string;
  sourceFile: string;
  charId: string;
  userId: string;
  username: string;
  bindQQ: string;
}

export interface DirectoryAccount {
  server: ServerOption;
  userId: string;
  username: string;
  bindQQ: string;
  characterIds: string[];
  sourceFiles: string[];
}

export interface DirectoryPage {
  accounts: DirectoryAccount[];
  nextCursor: string | null;
  totalCount: number;
}

export interface DirectorySearchInput {
  query?: string;
  serverId?: string;
  limit?: number;
  cursor?: string;
}

export interface DirectoryRepository {
  replace(rows: DirectoryRow[]): void;
  replaceServer(serverId: string, rows: DirectoryRow[]): void;
  count(): number;
  search(input: { query: string; serverId?: string; limit: number; offset: number }): { rows: DirectoryRow[]; totalCount: number };
}

export interface PlayerAccountSync {
  sync(serverId: string, file: { name: string; content: string }, signal?: AbortSignal): Promise<unknown>;
}
