import { MAX_ITEM_CHUNKS } from '../../command-generation/public/index.js';
import type { ItemCatalog } from '../../item-catalog/public/index.js';
import type { AppOptions, GroupReason, Operation, OperationType, SubmitGroupInput } from '../../../shared/types.js';
import { GroupError } from './errors.js';
import { quantity, safeText, strictText } from './helpers.js';

export function normalizeReason(value: unknown, options: AppOptions, actionType?: 'kick' | 'ban'): GroupReason {
  if (!value || typeof value !== 'object') throw new GroupError('invalid-input', 'reason is required');
  const reason = value as Record<string, unknown>;
  const code = strictText(reason.code, 'reason.code', 64);
  const configuredReasons = actionType ? (options.actionReasons?.[actionType] ?? options.reasons) : options.reasons;
  if (!configuredReasons.some((candidate) => candidate.code === code)) throw new GroupError('invalid-input', 'unknown reason');
  const text = reason.text === undefined ? undefined : safeText(reason.text, 'reason.text', 500);
  if (code === 'other' && !text) throw new GroupError('invalid-input', 'reason.text is required');
  if (Object.keys(reason).some((key) => !['code', 'text'].includes(key))) throw new GroupError('invalid-input', 'reason has unknown fields');
  return text ? { code, text } : { code };
}

export function normalizeOperation(value: unknown, options: AppOptions, catalog: ItemCatalog): Operation {
  if (!value || typeof value !== 'object') throw new GroupError('invalid-input', 'invalid operation');
  const operation = value as Record<string, unknown>;
  if (typeof operation.type !== 'string' || (operation.type !== 'warp' && !options.operations.some((candidate) => candidate.type === operation.type))) throw new GroupError('invalid-input', 'unknown operation type');
  const type = operation.type as OperationType;
  switch (type) {
    case 'item': {
      if (Object.keys(operation).some((key) => !['type', 'itemCode', 'quantity'].includes(key))) throw new GroupError('invalid-input');
      const itemCode = strictText(operation.itemCode, 'itemCode', 64);
      if (/[\s@]/u.test(itemCode)) throw new GroupError('invalid-input', 'unsafe item code');
      const item = catalog.lookup(itemCode);
      if (!item) throw new GroupError('unknown-item');
      const itemQuantity = quantity(operation.quantity);
      if (Math.ceil(itemQuantity / 1000) > MAX_ITEM_CHUNKS) throw new GroupError('invalid-quantity');
      return { type: 'item', itemCode: item.code, itemName: item.name, itemClass: item.itemClass, ...(item.image ? { itemImage: item.image } : {}), quantity: itemQuantity };
    }
    case 'cash':
      if (Object.keys(operation).some((key) => !['type', 'quantity'].includes(key))) throw new GroupError('invalid-input');
      return { type: 'cash', quantity: quantity(operation.quantity) };
    case 'kick':
    case 'warp':
    case 'ban':
      if (Object.keys(operation).length !== 1) throw new GroupError('invalid-input');
      return { type };
    default: throw new GroupError('invalid-input', 'unsupported operation type');
  }
}

export function normalizeSubmission(input: SubmitGroupInput, options: AppOptions, catalog: ItemCatalog) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new GroupError('invalid-input');
  if (Object.keys(input).some((key) => !['serverId', 'account', 'characterId', 'playerQQ', 'reason', 'operations'].includes(key))) throw new GroupError('invalid-input');
  const serverId = strictText(input.serverId, 'serverId', 64);
  const server = options.servers.find((candidate) => candidate.id === serverId);
  if (!server) throw new GroupError('unknown-server');
  const account = input.account === undefined ? undefined : safeText(input.account, 'account');
  const characterId = strictText(input.characterId, 'characterId', 64);
  if (!/^[0-9]+$/u.test(characterId)) throw new GroupError('invalid-input', 'characterId must contain digits');
  const playerQQ = input.playerQQ === undefined ? undefined : safeText(input.playerQQ, 'playerQQ', 32);
  if (!Array.isArray(input.operations) || input.operations.length === 0 || input.operations.length > 100) throw new GroupError('invalid-input', 'operations must not be empty');
  const operations = Array.from(input.operations, (operation) => normalizeOperation(operation, options, catalog));
  const itemCodes = new Set<string>();
  for (const operation of operations) {
    if (operation.type !== 'item') continue;
    if (itemCodes.has(operation.itemCode)) throw new GroupError('invalid-input', 'duplicate itemCode is not allowed');
    itemCodes.add(operation.itemCode);
  }
  const action = operations.length > 0 && operations.every((operation) => operation.type === 'kick' || operation.type === 'ban' || operation.type === 'warp')
    ? operations[0]
    : undefined;
  const actionType = action?.type === 'ban' ? 'ban' : action?.type === 'kick' || action?.type === 'warp' ? 'kick' : undefined;
  const reason = normalizeReason(input.reason, options, actionType);
  const usesPlayerAccount = operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
  if (usesPlayerAccount && (!account || !playerQQ)) throw new GroupError('invalid-input', 'account and playerQQ are required for item/cash operations');
  const keepsLegacyPlayerFields = operations.some((operation) => operation.type === 'warp');
  const retainPlayerFields = usesPlayerAccount || keepsLegacyPlayerFields;
  return { server, account: retainPlayerFields ? account : undefined, characterId, playerQQ: retainPlayerFields ? playerQQ : undefined, reason, operations };
}
