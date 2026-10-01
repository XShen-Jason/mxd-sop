import type { OperationGroup } from '../../../shared/types.js';
import { GroupError } from './errors.js';

export type ArchiveSearchField = 'characterId' | 'playerQQ' | 'itemName' | 'itemCode';

export function normalizeArchiveSearch(value: string) {
  const query = value.trim();
  if (query.length > 100) throw new GroupError('invalid-input', 'search query exceeds 100 characters');
  return query.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function normalizeArchiveSearchField(value?: string): ArchiveSearchField | undefined {
  if (value === undefined || value === '') return undefined;
  if (!['characterId', 'playerQQ', 'itemName', 'itemCode'].includes(value)) throw new GroupError('invalid-input', 'invalid search field');
  return value as ArchiveSearchField;
}

export function matchesArchiveSearch(group: OperationGroup, query?: string, field?: ArchiveSearchField) {
  if (!query) return true;
  const includes = (value: string | undefined) => value?.replace(/[A-Z]/g, (letter) => letter.toLowerCase()).includes(query) ?? false;
  const issuance = group.operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
  if (field === 'characterId') return includes(group.characterId);
  if (!issuance) return field === undefined && includes(group.characterId);
  if (field === 'playerQQ') return includes(group.playerQQ);
  if (field === 'itemName') return group.operations.some((operation) => operation.type === 'item' && includes(operation.itemName));
  if (field === 'itemCode') return group.operations.some((operation) => operation.type === 'item' && includes(operation.itemCode));
  if (includes(group.characterId)) return true;
  return includes(group.playerQQ) || group.operations.some((operation) =>
    operation.type === 'item' && (includes(operation.itemCode) || includes(operation.itemName)));
}
