import type { Identity, ServerOption } from '../../../shared/types.js';
import { TeamViewError } from './errors.js';
import { clearKey, type TeamClearRepository } from './clears.js';
import { parseClearFile } from '../infrastructure/clear-csv.js';
import { TEAM_BOSS_TYPES, type LockedTeam, type LockedTeamSource, type TeamBossType, type TeamSnapshot, type TeamViewRepository, type TeamViewResult, type TeamViewServer } from './types.js';

const beijing = 'Asia/Shanghai';
const bossNames: Record<TeamBossType, string> = { 'black-dragon': '黑龙', zakum: '进阶扎昆' };

export class TeamViewService {
  constructor(private readonly repository: TeamViewRepository, private readonly source: LockedTeamSource, private readonly servers: ServerOption[], private readonly clears?: TeamClearRepository) {}

  importClears(actor: Identity, serverId: unknown, file: unknown) {
    this.requireAuthenticated(actor);
    if (actor.role !== 'super_admin') throw new TeamViewError('forbidden');
    if (typeof serverId !== 'string' || !this.servers.some(server => server.id === serverId)) throw new TeamViewError('unknown-server');
    const parsed = parseClearFile(file, serverId);
    const importedAt = new Date().toISOString();
    if (!this.clears) throw new Error('team clear repository is not configured');
    this.clears.merge(parsed.rows, importedAt);
    return { serverId, dates: [...new Set(parsed.rows.map(row => row.date))].sort(), rowCount: parsed.rows.length, skippedRows: parsed.skippedRows, importedAt };
  }

  view(actor: Identity, date?: string): TeamViewResult {
    this.requireAuthenticated(actor);
    const targetDate = normalizeDate(date) ?? businessDay(new Date());
    const snapshot = this.repository.get(targetDate);
    return this.project(targetDate, snapshot);
  }

  async sync(date: string, signal?: AbortSignal): Promise<TeamSnapshot> {
    const targetDate = normalizeDate(date);
    if (!targetDate) throw new TeamViewError('invalid-date', 'date must use YYYY-MM-DD');
    const teams = await this.source.fetch(targetDate, signal);
    const snapshot: TeamSnapshot = { date: targetDate, fetchedAt: new Date().toISOString(), source: 'mxd-player', teams: normalizeTeams(teams, this.servers) };
    this.repository.save(snapshot);
    return snapshot;
  }

  private project(date: string, snapshot: TeamSnapshot | null): TeamViewResult {
    const cleared = new Set((this.clears?.get(date) ?? []).map(clearKey));
    const groups = new Map<string, Map<TeamBossType, LockedTeam[]>>();
    for (const server of this.servers) groups.set(server.id, new Map(TEAM_BOSS_TYPES.map((type) => [type, []])));
    for (const team of snapshot?.teams ?? []) {
      const server = groups.get(team.serverId);
      if (server?.has(team.bossType)) server.get(team.bossType)!.push(team);
    }
    const servers: TeamViewServer[] = this.servers.map((server) => ({
      server,
      types: TEAM_BOSS_TYPES.map((type) => {
        const teams = (groups.get(server.id)?.get(type) ?? []).slice().sort(compareTeams);
        return { type, displayName: bossNames[type], teams: teams.map((team, index) => {
          const members = team.members.map(member => member.characterId);
          const clearedMembers = members.filter(characterId => cleared.has(clearKey({ date, serverId: server.id, bossType: type, characterId })));
          return { id: team.id, sequence: index + 1, memberCount: members.length, members, clearedMembers, cleared: members.length > 0 && clearedMembers.length === members.length };
        }) };
      }),
    }));
    return { date, fetchedAt: snapshot?.fetchedAt ?? null, sourceStatus: snapshot ? 'ready' : 'unavailable', servers };
  }

  private requireAuthenticated(actor: Identity) {
    if (!actor?.id) throw new TeamViewError('unauthorized', 'authentication required');
  }
}

function normalizeTeams(teams: LockedTeam[], servers: ServerOption[]) {
  if (!Array.isArray(teams)) throw new TeamViewError('invalid-source', 'teams must be an array');
  const validServers = new Set(servers.map((server) => server.id));
  for (const team of teams) {
    if (!team || !validServers.has(team.serverId) || !TEAM_BOSS_TYPES.includes(team.bossType) || !team.id || !Array.isArray(team.members) || team.members.length < 1 || team.members.length > 10) throw new TeamViewError('invalid-source', 'team snapshot contains an invalid team');
    if (team.members.some((member) => !member || !/^[0-9]+$/u.test(member.characterId) || !member.joinedAt)) throw new TeamViewError('invalid-source', 'team snapshot contains an invalid character ID');
  }
  return teams.map((team) => ({
    ...team,
    members: team.members.slice(0, 10),
  }));
}

function compareTeams(left: LockedTeam, right: LockedTeam) {
  if (left.members.length !== right.members.length) return right.members.length - left.members.length;
  const leftJoined = left.members[0]?.joinedAt ?? left.createdAt ?? '';
  const rightJoined = right.members[0]?.joinedAt ?? right.createdAt ?? '';
  return leftJoined.localeCompare(rightJoined) || left.id.localeCompare(right.id);
}

function normalizeDate(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new TeamViewError('invalid-date', 'date must use YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || parsed.toLocaleDateString('en-CA', { timeZone: beijing }) !== value) throw new TeamViewError('invalid-date', 'date is invalid');
  return value;
}

function businessDay(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: beijing, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export { bossNames, normalizeDate, businessDay };
