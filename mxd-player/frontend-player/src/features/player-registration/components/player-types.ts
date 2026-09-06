import type { BossType, TeamMergeRequest, TeamRequest } from '../api/types';

export type Modal =
  | { kind: 'join'; invite: string; boss: string }
  | { kind: 'approve'; request: TeamRequest; boss: string }
  | { kind: 'merge'; request: TeamMergeRequest; boss: string }
  | null;

export type CreatePrompt = {
  bossType: BossType;
  boss: string;
  character: string;
};
