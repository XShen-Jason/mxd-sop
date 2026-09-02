import type { AppOptions } from '../shared/types.js';

export const appOptions: AppOptions = {
  servers: [
    { id: 'mushroom', displayName: '蘑菇' },
    { id: 'yeti', displayName: '雪人' },
    { id: 'red-snail', displayName: '红蜗牛' },
    { id: 'uu', displayName: 'UU' },
    { id: 'piaopiao-pig', displayName: '漂漂猪' }
  ],
  reasons: [
    { code: 'bug-recovery', displayName: 'BUG补发' },
    { code: 'event-reward', displayName: '活动奖励' },
    { code: 'compensation', displayName: '补偿' },
    { code: 'internal', displayName: '自己人' },
    { code: 'other', displayName: '其他' }
  ],
  actionReasons: {
    kick: [
      { code: 'corpse', displayName: '尸体' },
      { code: 'abnormal-behavior', displayName: '抢吸' },
      { code: 'player-request', displayName: '玩家反馈' },
      { code: 'other', displayName: '其他' }
    ],
    ban: [
      { code: 'cheating', displayName: '外挂/作弊' },
      { code: 'player-request', displayName: '玩家举报' },
      { code: 'abuse', displayName: '违规行为' },
      { code: 'other', displayName: '其他' }
    ]
  },
  operations: [
    { type: 'item', displayName: '发物品', fields: ['itemCode', 'quantity'], allowMultiple: true },
    { type: 'cash', displayName: '发点券', fields: ['quantity'], allowMultiple: true },
    { type: 'kick', displayName: '拖人', fields: [], allowMultiple: true },
    { type: 'ban', displayName: '封禁', fields: [], allowMultiple: true }
  ],
  commandRuleVersion: 'v1'
};

export function findServer(id: string) { return appOptions.servers.find((server) => server.id === id); }
export function findReason(code: string) { return appOptions.reasons.find((reason) => reason.code === code); }
export function isOperationType(value: unknown): value is 'item' | 'cash' | 'kick' | 'ban' | 'warp' { return typeof value === 'string' && (value === 'warp' || appOptions.operations.some((operation) => operation.type === value)); }
