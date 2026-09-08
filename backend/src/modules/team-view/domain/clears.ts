import type { TeamBossType } from './types.js';

export interface TeamClear { date: string; serverId: string; bossType: TeamBossType; characterId: string }
export interface TeamClearRepository {
  get(date: string): TeamClear[];
  merge(rows: TeamClear[], importedAt: string): void;
}
export function clearKey(row: TeamClear) {
  return JSON.stringify([row.date, row.serverId, row.bossType, row.characterId]);
}
