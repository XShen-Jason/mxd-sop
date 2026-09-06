// Use the Vite/Nginx same-origin proxy by default; deployments with a separate
// player API can provide VITE_PLAYER_API explicitly.
const API = import.meta.env.VITE_PLAYER_API ?? '';
export type Account = { server: string; qq: string; gameAccount: string; characters: string[] };
export type BossType = 'black-dragon' | 'zakum';
export type TeamRequest = { requestId: string; gameAccount: string; characterId: string; requestedAt: string };
export type TeamMergeRequest = { requestId: string; sourceInviteCode: string; bossType: BossType; memberCount: number; requestedAt: string };
export type Team = { bossType: BossType; inviteCode: string; server: string; leader: boolean; members: Array<{ gameAccount: string; characterId: string; isLeader: boolean }>; pendingRequests?: TeamRequest[]; pendingMergeRequests?: TeamMergeRequest[] };
export type TeamApplication = { requestId: string; bossType: BossType; inviteCode: string; characterId: string; status: 'pending' | 'approved' | 'rejected'; day: string; requestedAt: string };
let serversPromise: Promise<string[]> | undefined;

async function call<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  } catch {
    const error = new Error('request-failed') as Error & { code?: string; detail?: string };
    error.code = 'request-failed';
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.code ?? data.error?.code ?? 'request-failed') as Error & { code?: string; detail?: string };
    error.code = data.code ?? data.error?.code;
    error.detail = data.message ?? data.error?.message;
    throw error;
  }
  return data as T;
}
export const verify = (body: { server: string; qq: string; gameAccount: string }) => call<{ token: string; account: Account }>('/api/v1/player/verify', undefined, { method: 'POST', body: JSON.stringify(body) });
export const getServers = () => {
  serversPromise ??= call<{ servers: string[] }>('/api/v1/player/servers').then((result) => result.servers).catch((error) => {
    serversPromise = undefined;
    throw error;
  });
  return serversPromise;
};
export const getTeams = (token: string) => call<{ teams: Team[]; applications: TeamApplication[]; history: TeamApplication[]; day: string }>('/api/v1/player/teams', token);
export const createTeam = (token: string, bossType: BossType, characterId: string) => call<Team>('/api/v1/player/teams', token, { method: 'POST', body: JSON.stringify({ bossType, characterId }) });
export const joinTeam = (token: string, inviteCode: string, characterId: string) => call<{ status: 'pending'; requestId: string; bossType: BossType; inviteCode: string; characterId: string }>('/api/v1/player/teams/join', token, { method: 'POST', body: JSON.stringify({ inviteCode, characterId }) });
export const previewTeamJoin = (token: string, inviteCode: string) => call<{ bossType: BossType; inviteCode: string; day: string; memberCount: number }>('/api/v1/player/teams/preview', token, { method: 'POST', body: JSON.stringify({ inviteCode }) });
export const approveTeamJoin = (token: string, requestId: string) => call<Team>('/api/v1/player/teams/approve', token, { method: 'POST', body: JSON.stringify({ requestId }) });
export const mergeTeams = (token: string, sourceInviteCode: string, targetInviteCode: string) => call<{ status: 'pending'; requestId: string }>('/api/v1/player/teams/merge', token, { method: 'POST', body: JSON.stringify({ sourceInviteCode, targetInviteCode }) });
export const approveTeamMerge = (token: string, requestId: string) => call<Team>('/api/v1/player/teams/merge/approve', token, { method: 'POST', body: JSON.stringify({ requestId }) });
