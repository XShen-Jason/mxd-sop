import { formatTargetDay } from './day';

export const errorMessages: Record<string, string> = {
  'account-not-found': '账号信息不匹配，请确认服务器、QQ 和游戏账号',
  'team-not-found': '邀请码无效或已过期',
  'team-full': '队伍已满（最多 10 人）',
  'already-in-team': '该副本已经加入其他队伍',
  'leader-locked': '你已经是该副本队长，队伍已锁定，不能加入他人队伍',
  'already-applied': '已经申请过这个队伍，请等待队长同意',
  'leader-cannot-leave': '队长不能退出队伍',
  'not-in-team': '你当前不在该队伍中',
  'request-not-found': '该申请已被处理或已过期',
  'merge-target-not-found': '合并目标队伍不存在或已锁定',
  'merge-boss-mismatch': '只能合并同一副本、同一服务器的队伍',
  'merge-already-applied': '已经向该队伍提交过合并申请',
  'merge-request-not-found': '合并申请已处理或已失效',
  'not-team-leader': '只有队长可以发起队伍合并',
  'server-mismatch': '邀请码所属服务器与当前服务器不一致',
  'character-not-owned': '所选角色不属于该账号',
  'invalid-input': '请检查输入格式',
  unauthorized: '验证已过期，请重新进入',
  'request-failed': '无法连接服务器，请稍后再试',
  'internal-error': '服务器暂时不可用，请稍后再试',
};

export function messageForError(error: unknown, day = '') {
  const value = error as Error & { code?: string; detail?: string };
  if (value.code === 'already-in-team' && day) return `该副本${formatTargetDay(day)}已经加入其他队伍`;
  return errorMessages[value.code ?? ''] ?? value.detail ?? '操作失败';
}
