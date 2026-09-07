export type Account = { server: string; qq: string; gameAccount: string; characters: string[] };
export type BossType = 'black-dragon' | 'zakum';
export type TeamHistory = {
  day: string;
  today: string;
  teams: Array<Pick<Team, 'bossType' | 'members'>>;
};
export type TeamRequest = { requestId: string; characterId: string; requestedAt: string };
export type TeamMergeRequest = { requestId: string; sourceInviteCode: string; bossType: BossType; memberCount: number; requestedAt: string };
export type Team = {
  bossType: BossType;
  inviteCode: string;
  server: string;
  leader: boolean;
  members: Array<{ characterId: string; isLeader: boolean }>;
  pendingRequests?: TeamRequest[];
  pendingMergeRequests?: TeamMergeRequest[];
};
export type TeamApplication = {
  requestId: string;
  bossType: BossType;
  inviteCode: string;
  characterId: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: 'joined-other-team' | 'left-team' | 'team-merged' | 'leader-rejected' | string;
  day: string;
  requestedAt: string;
};
