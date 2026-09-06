import type { Identity, ServerOption } from '../../../shared/types.js';
import { TeamViewError } from './errors.js';
import { TEAM_BOSS_TYPES, type LockedTeam, type LockedTeamSource, type TeamBossType, type TeamSnapshot, type TeamViewRepository, type TeamViewResult, type TeamViewServer } from './types.js';

const beijing = 'Asia/Shanghai';
const bossNames: Record<TeamBossType, string> = { 'black-dragon': '黑龙', zakum: '扎昆' };

export class TeamViewService {
  constructor(private readonly repository: TeamViewRepository, private readonly source: LockedTeamSource, private readonly servers: ServerOption[]) {}

  view(actor: Identity, date?: string): TeamViewResult {
    this.requireAuthenticated(actor);
    const targetDate = normalizeDate(date) ?? nextBusinessDay(new Date());
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
        return { type, displayName: bossNames[type], teams: teams.map((team, index) => ({ id: team.id, sequence: index + 1, memberCount: team.members.length, members: team.members.map((member) => member.characterId) })) };
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

function nextBusinessDay(now: Date) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: beijing, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const parsed = new Date(`${date}T00:00:00+08:00`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toLocaleDateString('en-CA', { timeZone: beijing });
}

export { bossNames, normalizeDate, nextBusinessDay };
