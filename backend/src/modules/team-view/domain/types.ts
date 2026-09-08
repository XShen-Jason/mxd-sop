import type { ServerOption } from '../../../shared/types.js';

export const TEAM_BOSS_TYPES = ['black-dragon', 'zakum'] as const;
export type TeamBossType = typeof TEAM_BOSS_TYPES[number];
export type TeamSourceStatus = 'ready' | 'unavailable';

export interface LockedTeamMember {
  characterId: string;
  joinedAt: string;
}

export interface LockedTeam {
  id: string;
  serverId: string;
  bossType: TeamBossType;
  members: LockedTeamMember[];
  createdAt?: string;
}

export interface TeamSnapshot {
  date: string;
  fetchedAt: string;
  source: string;
  teams: LockedTeam[];
}

export interface TeamViewRepository {
  get(date: string): TeamSnapshot | null;
  save(snapshot: TeamSnapshot): void;
}

export interface LockedTeamSource {
  fetch(date: string, signal?: AbortSignal): Promise<LockedTeam[]>;
}

export interface TeamViewServer {
  server: ServerOption;
  types: TeamViewType[];
}

export interface TeamViewType {
  type: TeamBossType;
  displayName: string;
  teams: TeamViewTeam[];
}

export interface TeamViewTeam {
  id: string;
  sequence: number;
  memberCount: number;
  members: string[];
  clearedMembers: string[];
  cleared: boolean;
}

export interface TeamViewResult {
  date: string;
  fetchedAt: string | null;
  sourceStatus: TeamSourceStatus;
  servers: TeamViewServer[];
}
