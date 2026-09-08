import type { Identity } from '../../../shared/types.js';
import type { OperationGroupsService } from '../../operation-groups/public/index.js';
import type { PlayerDirectoryService } from '../../player-directory/public/index.js';
import type { TeamViewService } from '../domain/service.js';
import { TeamViewError } from '../domain/errors.js';
import { rewardItemCode, teamRewards } from '../domain/rewards.js';

export function applyTeamRewards(service: TeamViewService, groups: OperationGroupsService, directory: PlayerDirectoryService, actor: Identity, input: unknown) {
  const body = (input ?? {}) as { serverId?: unknown; type?: unknown; date?: unknown };
  if (typeof body.serverId !== 'string' || (body.type !== 'black-dragon' && body.type !== 'zakum')) throw new TeamViewError('invalid-source', '服务器或队伍类型无效');
  if (typeof body.date !== 'string') throw new TeamViewError('invalid-date', '请选择名单日期');
  const view = service.view(actor, body.date);
  if (view.sourceStatus !== 'ready') throw new TeamViewError('source-unavailable', '该日期尚未同步队伍');
  const type = view.servers.find(server => server.server.id === body.serverId)?.types.find(type => type.type === body.type);
  if (!type) throw new TeamViewError('unknown-server');
  const teams = type.teams.filter(team => team.canApply);
  const characterIds = teams.flatMap(team => team.members);
  if (characterIds.length > 2000 || new Set(characterIds).size !== characterIds.length) throw new TeamViewError('invalid-source', '名单超过2000人或存在重复角色，请检查名单');
  const rows = directory.findCharacters(actor, body.serverId, characterIds);
  const players = new Map<string, typeof rows>();
  for (const row of rows) players.set(row.charId, [...(players.get(row.charId) ?? []), row]);
  const reward = teamRewards[body.type];
  const entries = teams.flatMap(team => team.members.map(characterId => {
    const matches = players.get(characterId) ?? [];
    if (matches.length !== 1) throw new TeamViewError('invalid-source', `角色 ${characterId} 的玩家账号${matches.length ? '存在冲突' : '不存在'}，本次未提交任何申请`);
    const player = matches[0];
    return {
      key: JSON.stringify([view.date, body.serverId, body.type, characterId]),
      input: { serverId: body.serverId as string, account: player.username, characterId, playerQQ: player.bindQQ,
        reason: { code: 'event-reward', text: `${view.date} ${reward.name}` },
        operations: [{ type: 'item' as const, itemCode: rewardItemCode, quantity: Math.ceil(reward.tickets / team.memberCount) }] },
    };
  }));
  return { ...groups.submitApprovedBatch(actor, entries), teamCount: teams.length };
}
