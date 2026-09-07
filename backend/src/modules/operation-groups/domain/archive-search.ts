import type { OperationGroup } from '../../../shared/types.js';
import { GroupError } from './errors.js';

export function normalizeArchiveSearch(value: string) {
  const query = value.trim();
  if (query.length > 100) throw new GroupError('invalid-input', 'search query exceeds 100 characters');
  return query.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function matchesArchiveSearch(group: OperationGroup, query?: string) {
  if (!query) return true;
  const includes = (value: string | undefined) => value?.replace(/[A-Z]/g, (letter) => letter.toLowerCase()).includes(query) ?? false;
  if (includes(group.characterId)) return true;
  const issuance = group.operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
  return issuance && (includes(group.playerQQ) || group.operations.some((operation) =>
    operation.type === 'item' && (includes(operation.itemCode) || includes(operation.itemName))));
}
