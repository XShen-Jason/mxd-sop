import type { TeamBossType } from './types.js';

export const teamRewards: Record<TeamBossType, { name: string; tickets: number }> = {
  'black-dragon': { name: '黑龙', tickets: 150 },
  zakum: { name: '进阶扎昆', tickets: 500 },
};

export const rewardItemCode = '100000069';
