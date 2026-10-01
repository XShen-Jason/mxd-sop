import type { AppOptions, GroupStatus, ManagerGroupProjection, OperationGroup } from '../../../shared/types.js';
import { matchesArchiveSearch, type ArchiveSearchField } from './archive-search.js';
import { GroupError } from './errors.js';
import { managerProjection } from './projections.js';
import { isIssuanceGroup } from './workflow-rules.js';
import type { GroupRepository } from '../infrastructure/json-store.js';
import type { ItemCatalog } from '../../item-catalog/public/index.js';

export function listIssuanceExport(input: {
  repository: GroupRepository;
  catalog: ItemCatalog;
  options: AppOptions;
  resolveDisplayName?: (id: string) => string | undefined;
  status?: GroupStatus | GroupStatus[];
  serverId?: string;
  query: string;
  field?: ArchiveSearchField;
  includeRelated: boolean;
}): ManagerGroupProjection[] {
  if (input.serverId && !input.options.servers.some((server) => server.id === input.serverId)) throw new GroupError('unknown-server');
  const statuses = input.status ? (Array.isArray(input.status) ? input.status : [input.status]) : [];
  if (statuses.some((value) => !['pending', 'approved', 'rejected', 'issued', 'completed', 'cancelled'].includes(value))) throw new GroupError('invalid-status');
  const all = input.repository.all().filter((group) => isIssuanceGroup(group)
    && (!input.serverId || group.server.id === input.serverId)
    && (!statuses.length || statuses.includes(group.status)));
  const matches = all.filter((group) => matchesArchiveSearch(group, input.query, input.field));
  const selected = !input.includeRelated || !input.query ? matches : relatedRecords(all, matches);
  return selected.map((group) => managerProjection(group, input.catalog, input.resolveDisplayName));
}

function relatedRecords(all: OperationGroup[], matches: OperationGroup[]) {
  const people = new Set(matches.map((group) => `${group.server.id}\u0000${group.characterId}`));
  return all.filter((group) => people.has(`${group.server.id}\u0000${group.characterId}`));
}
