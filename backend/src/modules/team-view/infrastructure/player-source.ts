import { TeamViewError } from '../domain/errors.js';
import type { LockedTeam, LockedTeamMember, LockedTeamSource, TeamBossType } from '../domain/types.js';

export class UnavailableTeamSource implements LockedTeamSource {
  async fetch(_date: string): Promise<LockedTeam[]> { throw new TeamViewError('source-unavailable', 'mxd-player team snapshot endpoint is not configured'); }
}

export class HttpLockedTeamSource implements LockedTeamSource {
  constructor(private readonly endpoint: string | (() => string | undefined), private readonly token?: string | (() => string | undefined), private readonly timeoutMs = 10_000) {}

  async fetch(date: string, signal?: AbortSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const endpoint = typeof this.endpoint === 'function' ? this.endpoint() : this.endpoint;
      if (!endpoint) throw new TeamViewError('source-unavailable', 'mxd-player team snapshot endpoint is not configured');
      const token = typeof this.token === 'function' ? this.token() : this.token;
      const url = new URL(endpoint);
      url.searchParams.set('date', date);
      const response = await fetch(url, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: controller.signal });
      if (!response.ok) throw new TeamViewError('source-unavailable', `mxd-player returned ${response.status}`);
      return parsePayload(await response.json());
    } catch (error) {
      if (error instanceof TeamViewError) throw error;
      throw new TeamViewError('source-unavailable', 'mxd-player snapshot request failed');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}

function parsePayload(value: unknown): LockedTeam[] {
  const payload = value && typeof value === 'object' ? value as { teams?: unknown } : {};
  if (!Array.isArray(payload.teams)) throw new TeamViewError('invalid-source', 'mxd-player response must contain teams');
  return payload.teams.map((entry) => parseTeam(entry));
}

function parseTeam(value: unknown): LockedTeam {
  if (!value || typeof value !== 'object') throw new TeamViewError('invalid-source', 'mxd-player response contains an invalid team');
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : typeof item.inviteCode === 'string' ? item.inviteCode : '';
  const serverId = typeof item.serverId === 'string' ? item.serverId : typeof item.server === 'string' ? item.server : '';
  const bossType = item.bossType === 'black-dragon' || item.bossType === 'zakum' ? item.bossType : null;
  const rawMembers = Array.isArray(item.members) ? item.members : [];
  if (!id || !serverId || !bossType) throw new TeamViewError('invalid-source', 'mxd-player response contains an invalid team');
  const fallback = typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString();
  const members: LockedTeamMember[] = rawMembers.flatMap((member) => {
    if (typeof member === 'string') return [{ characterId: member, joinedAt: fallback }];
    if (!member || typeof member !== 'object') throw new TeamViewError('invalid-source', 'mxd-player response contains an invalid member');
    const value = member as Record<string, unknown>;
    const characterId = typeof value.characterId === 'string' ? value.characterId : '';
    const joinedAt = typeof value.joinedAt === 'string' ? value.joinedAt : fallback;
    if (!characterId) throw new TeamViewError('invalid-source', 'mxd-player response contains an invalid member');
    return [{ characterId, joinedAt }];
  });
  return { id, serverId, bossType: bossType as TeamBossType, members, ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}) };
}
