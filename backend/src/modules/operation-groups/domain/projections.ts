import { generateCommands } from '../../command-generation/public/index.js';
import type { ItemCatalog } from '../../item-catalog/public/index.js';
import type { CustomerGroupProjection, ManagerGroupProjection, OperationGroup } from '../../../shared/types.js';
import { GroupError } from './errors.js';

const actorFields = ['submittedBy', 'completedBy', 'approvedBy', 'rejectedBy', 'issuedBy', 'cancelledBy', 'updatedBy', 'lastRemindedBy'] as const;

export function customerProjection(group: OperationGroup, catalog: ItemCatalog, resolveDisplayName?: (id: string) => string | undefined): CustomerGroupProjection {
  const { commandRuleVersion: _version, idempotencyKey: _key, requestFingerprint: _fingerprint, ...projection } = withCurrentActorNames(group, catalog, resolveDisplayName);
  return projection;
}

export function managerProjection(group: OperationGroup, catalog: ItemCatalog, resolveDisplayName?: (id: string) => string | undefined): ManagerGroupProjection {
  let commands;
  try {
    commands = generateCommands(group.characterId, group.operations);
  } catch (error) {
    throw new GroupError('generation-failed', error instanceof Error ? error.message : 'command generation failed');
  }
  return { ...customerProjection(group, catalog, resolveDisplayName), commands, commandRuleVersion: group.commandRuleVersion };
}

function withCurrentActorNames(group: OperationGroup, catalog: ItemCatalog, resolveDisplayName?: (id: string) => string | undefined) {
  const projection = structuredClone(group);
  projection.operations = projection.operations.map((operation) => {
    if (operation.type !== 'item' || operation.itemImage) return operation;
    const baseCode = operation.itemCode.replace(/_[0-9]+$/u, '');
    const image = catalog.lookup(operation.itemCode)?.image ?? catalog.lookup(baseCode)?.image;
    return image ? { ...operation, itemImage: image } : operation;
  });
  for (const field of actorFields) {
    const actor = projection[field];
    if (actor) actor.displayName = resolveDisplayName?.(actor.id) ?? actor.displayName;
  }
  return projection;
}
