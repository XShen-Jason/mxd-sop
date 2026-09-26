import { createHash } from 'node:crypto';
import { AutoIntegrationError, type AutoIntegrationService, type AutoExecutionResult } from '../../auto-integration/public/index.js';
import type { AutomationFailureReason, Identity, ManagerGroupProjection } from '../../../shared/types.js';
import { OperationGroupsService } from '../domain/service.js';

const AUTO_ACTOR = { id: 'auto-process', role: 'super_admin' as const, displayName: 'auto-process' };

export class OperationAutomationWorkflow {
  constructor(private readonly groups: OperationGroupsService, private readonly auto: AutoIntegrationService) {}

  async approveAndExecute(identity: Identity, id: string): Promise<ManagerGroupProjection> {
    this.groups.approve(identity, id);
    return this.execute(id, false);
  }

  async retryAfterOnline(identity: Identity, id: string) {
    this.groups.markOnline(identity, id);
    return this.execute(id, true);
  }

  async executeApproved(id: string) {
    return this.execute(id, false);
  }

  private async execute(id: string, retry: boolean): Promise<ManagerGroupProjection> {
    const group = this.groups.automationProjection(id);
    if (group.status !== 'approved') return group;
    if (!this.auto.isEnabled()) return group;
    // Preserve one auto command per generated operation/chunk. Auto sends each
    // entry as its own private chat, so never concatenate this list here.
    const commands = group.commands.map((command) => ({ id: `${command.operationIndex}:${command.sequence}`, text: command.text }));
    // A customer edit resets the group to pending but intentionally keeps the
    // stable group ID for audit/history. Auto's idempotency key must still
    // change for that new version, otherwise it reuses the old failure or
    // rejects the request as a command-batch conflict. Retries of the same
    // edited version keep this derived ID and use retry=true.
    const executionId = automationExecutionId(group, commands);
    let result: AutoExecutionResult;
    try {
      result = await this.auto.execute(AUTO_ACTOR, group.server.id, { execution_id: executionId, commands, retry });
    } catch (error) {
      // The connection may be switched off after the preflight check. This is
      // an intentional manual fallback, not an automation delivery failure.
      if (error instanceof AutoIntegrationError && error.code === 'connection-disabled') return this.groups.automationProjection(id);
      this.groups.recordAutomationFailure(id, 'execution-failed');
      return this.groups.automationProjection(id);
    }
    if (result.status === 'success') return this.groups.recordAutomationSuccess(id);
    if (result.status === 'unknown') return this.groups.recordAutomationUnknown(id);
    this.groups.recordAutomationFailure(id, automationFailureReason(result.failure_reason));
    return this.groups.automationProjection(id);
  }
}

function automationFailureReason(reason: AutoExecutionResult['failure_reason']): AutomationFailureReason {
  return reason === 'no_online_accounts' ? 'no-online-accounts' : 'execution-failed';
}

function automationExecutionId(group: ManagerGroupProjection, commands: Array<{ id: string; text: string }>) {
  if (!group.updatedAt) return group.id;
  const revision = createHash('sha256').update(JSON.stringify({
    updatedAt: group.updatedAt,
    serverId: group.server.id,
    account: group.account,
    characterId: group.characterId,
    playerQQ: group.playerQQ,
    reason: group.reason,
    commands,
  })).digest('hex').slice(0, 20);
  return `${group.id}:revision-${revision}`;
}
