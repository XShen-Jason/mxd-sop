import { createHash } from 'node:crypto';
import type { AppOptions, Identity, OperationGroup, SubmitGroupInput } from '../../../shared/types.js';
import type { ItemCatalog } from '../../item-catalog/public/index.js';
import type { GroupRepository } from '../infrastructure/json-store.js';
import { normalizeSubmission } from './normalization.js';
import { GroupError } from './errors.js';

export interface ApprovedBatchEntry { key: string; input: SubmitGroupInput }

// Internal application boundary only; HTTP callers cannot choose approvals or keys.
export function saveApprovedBatch(repository: GroupRepository, catalog: ItemCatalog, options: AppOptions, actor: Identity, entries: ApprovedBatchEntry[], now: Date) {
  if (entries.length > 2000 || !repository.insertMany) throw new GroupError('invalid-input', 'batch limit or persistence unavailable');
  const groups: OperationGroup[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = `team-reward-${createHash('sha256').update(entry.key).digest('hex')}`;
    if (seen.has(id)) throw new GroupError('invalid-input', 'duplicate reward character');
    seen.add(id);
    if (repository.findById(id)) continue;
    const normalized = normalizeSubmission(entry.input, options, catalog);
    groups.push({ ...normalized, id, status: 'approved', submittedAt: now.toISOString(),
      submittedBy: { id: actor.id, displayName: actor.displayName },
      approvedAt: now.toISOString(), approvedBy: { id: 'system-admin', displayName: '系统' },
      commandRuleVersion: options.commandRuleVersion });
  }
  if (groups.length) repository.insertMany(groups);
  return { count: groups.length, skippedCount: entries.length - groups.length, groups };
}
