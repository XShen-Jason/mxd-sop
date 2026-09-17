import { randomUUID } from 'node:crypto';
import { saveApprovedBatch, type ApprovedBatchEntry } from './approved-batch.js';
import { appOptions } from '../../../config/options.js';
import { hasWorkspaceAccess } from '../../auth/public/index.js';
import type { ItemCatalog } from '../../item-catalog/public/index.js';
import type {
  AppOptions,
  AutomationFailureReason,
  CustomerGroupProjection,
  GroupStatus,
  Identity,
  ManagerGroupProjection,
  OperationGroup,
  SubmitGroupInput,
  WorkspaceId
} from '../../../shared/types.js';
import type { GroupRepository } from '../infrastructure/json-store.js';
import { fingerprint, safeText } from './helpers.js';
import { GroupError } from './errors.js';
import { normalizeSubmission } from './normalization.js';
import { readGroupPage } from './pagination.js';
import { normalizeArchiveSearch } from './archive-search.js';
import { customerProjection, managerProjection } from './projections.js';
import { readOverview, readWorkspaceCounts } from './workspace-summary.js';
import { canCustomerModify, isIssuanceGroup, isNoReviewGroup } from './workflow-rules.js';
import { groupChangeState, type GroupChange, type GroupChangeState } from './changes.js';
import { changeReminder, clearReminder } from './reminders.js';

export { GroupError } from './errors.js';
export type { GroupErrorCode } from './errors.js';

interface ServiceDependencies {
  repository: GroupRepository;
  catalog: ItemCatalog;
  options?: AppOptions;
  resolveDisplayName?: (id: string) => string | undefined;
  now?: () => Date;
  idFactory?: () => string;
  onChange?: () => void;
}

export class OperationGroupsService {
  private readonly options: AppOptions;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly listeners = new Set<(changes: GroupChange[]) => void>();

  constructor(private readonly deps: ServiceDependencies) {
    this.options = deps.options ?? appOptions;
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? randomUUID;
    if (deps.onChange) this.listeners.add(deps.onChange);
  }

  subscribe(listener: (changes: GroupChange[]) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(group: OperationGroup, before?: GroupChangeState) {
    for (const listener of this.listeners) listener([{ before, after: groupChangeState(group) }]);
  }

  getOptions() {
    return structuredClone(this.options);
  }

  submitApprovedBatch(identity: Identity, entries: ApprovedBatchEntry[]) {
    this.requireAuthenticated(identity);
    this.requireWorkspace(identity, 'team-view');
    const result = saveApprovedBatch(this.deps.repository, this.deps.catalog, this.options, identity, entries, this.now());
    if (result.count) for (const listener of this.listeners) listener(result.groups.map(group => ({ after: groupChangeState(group) })));
    return { count: result.count, skippedCount: result.skippedCount };
  }

  submit(identity: Identity, input: SubmitGroupInput, idempotencyKey?: string): CustomerGroupProjection {
    this.requireAuthenticated(identity);
    this.requireWorkspace(identity, 'request');
    if (idempotencyKey && (idempotencyKey.length > 128 || /[\s\u0000-\u001f\u007f]/u.test(idempotencyKey))) throw new GroupError('invalid-input');
    if (idempotencyKey) {
      const existing = this.deps.repository.findByIdempotency?.(identity.id, idempotencyKey)
        ?? this.deps.repository.all().find((group) => group.idempotencyKey === idempotencyKey && group.submittedBy.id === identity.id);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint(input)) throw new GroupError('idempotency-conflict');
        return customerProjection(existing, this.deps.catalog, this.deps.resolveDisplayName);
      }
    }
    const normalized = normalizeSubmission(input, this.options, this.deps.catalog);
    const { server, account, characterId, playerQQ, reason, operations } = normalized;
    const noReview = isNoReviewGroup({ operations });
    const submittedAt = this.now().toISOString();
    const group: OperationGroup = {
      id: this.idFactory(), server, account, characterId, playerQQ, reason, operations,
      status: noReview ? 'approved' : 'pending', submittedAt,
      submittedBy: { id: identity.id, displayName: identity.displayName },
      commandRuleVersion: this.options.commandRuleVersion,
      idempotencyKey,
      requestFingerprint: idempotencyKey ? fingerprint(input) : undefined
    };
    this.deps.repository.insert(group);
    this.changed(group);
    return customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  listOwn(identity: Identity, limit = 20, cursor?: string, status?: GroupStatus | GroupStatus[], kind?: 'issuance' | 'regular') {
    this.requireAuthenticated(identity);
    this.requireWorkspace(identity, 'records');
    const statuses = status ? (Array.isArray(status) ? status : [status]) : [];
    if (statuses.some((value) => !['pending', 'approved', 'rejected', 'issued', 'completed', 'cancelled'].includes(value))) throw new GroupError('invalid-status');
    if (kind !== undefined && kind !== 'issuance' && kind !== 'regular') throw new GroupError('invalid-input', 'invalid kind');
    const page = readGroupPage(this.deps.repository, { ownerId: identity.id, status, kind, limit, order: 'desc' }, cursor);
    return { groups: page.groups.map((group) => customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName)), nextCursor: page.nextCursor };
  }

  listReminders(identity: Identity, limit = 20, cursor?: string, kind?: 'issuance' | 'regular') {
    this.requireAuthenticated(identity);
    this.requireWorkspace(identity, 'reminders');
    if (kind !== undefined && kind !== 'issuance' && kind !== 'regular') throw new GroupError('invalid-input', 'invalid kind');
    const page = readGroupPage(this.deps.repository, { ownerId: identity.id, status: 'approved', kind, reminded: true, limit, order: 'desc' }, cursor);
    return { groups: page.groups.map((group) => customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName)), nextCursor: page.nextCursor };
  }

  workspaceCounts(identity: Identity) {
    this.requireAuthenticated(identity);
    const counts = readWorkspaceCounts(this.deps.repository, identity.id);
    return {
      ...(hasWorkspaceAccess(identity, 'queue') ? { pending: counts.pending } : {}),
      ...(hasWorkspaceAccess(identity, 'ready') ? { ready: counts.approved } : {}),
      ...(hasWorkspaceAccess(identity, 'reminders') ? { reminders: counts.reminders, reminderIssuance: counts.reminderIssuance, reminderRegular: counts.reminderRegular } : {}),
      ...(hasWorkspaceAccess(identity, 'records') ? { ownIssuance: counts.ownIssuance, ownRegular: counts.ownRegular } : {})
    };
  }

  cancel(identity: Identity, id: string): CustomerGroupProjection {
    this.requireAuthenticated(identity);
    this.requireWorkspace(identity, 'records');
    const group = this.getGroup(id);
    if (group.submittedBy.id !== identity.id) throw new GroupError('forbidden');
    if (group.status === 'cancelled') return customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
    if (!canCustomerModify(group)) throw new GroupError('invalid-status-transition');
    const before = groupChangeState(group);
    group.status = 'cancelled';
    group.cancelledAt = this.now().toISOString();
    group.cancelledBy = { id: identity.id, displayName: identity.displayName };
    this.deps.repository.replace(group);
    this.changed(group, before);
    return customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  update(identity: Identity, id: string, input: SubmitGroupInput): CustomerGroupProjection {
    this.requireAuthenticated(identity);
    this.requireWorkspace(identity, 'records');
    const group = this.getGroup(id);
    if (group.submittedBy.id !== identity.id) throw new GroupError('forbidden');
    if (!canCustomerModify(group)) throw new GroupError('invalid-status-transition');
    const replacement = normalizeSubmission(input, this.options, this.deps.catalog);
    const before = groupChangeState(group);
    group.server = replacement.server;
    group.account = replacement.account;
    group.characterId = replacement.characterId;
    group.playerQQ = replacement.playerQQ;
    group.reason = replacement.reason;
    group.operations = replacement.operations;
    group.updatedAt = this.now().toISOString();
    group.updatedBy = { id: identity.id, displayName: identity.displayName };
    group.status = 'pending';
    delete group.completedAt;
    delete group.completedBy;
    delete group.approvedAt;
    delete group.approvedBy;
    delete group.rejectedAt;
    delete group.rejectedBy;
    delete group.rejectionReason;
    delete group.issuedAt;
    delete group.issuedBy;
    clearReminder(group);
    this.deps.repository.replace(group);
    this.changed(group, before);
    return customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  approve(identity: Identity, id: string): ManagerGroupProjection {
    this.requireWorkspace(identity, 'queue');
    const group = this.getGroup(id);
    if (group.status === 'approved') return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
    if (group.status !== 'pending') throw new GroupError('conflict');
    const before = groupChangeState(group);
    group.status = 'approved';
    group.approvedAt = this.now().toISOString();
    group.approvedBy = { id: identity.id, displayName: identity.displayName };
    this.deps.repository.replace(group);
    this.changed(group, before);
    return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  reject(identity: Identity, id: string, rejectionReason?: string): ManagerGroupProjection {
    this.requireWorkspace(identity, 'queue');
    const group = this.getGroup(id);
    if (group.status === 'rejected') return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
    if (group.status !== 'pending') throw new GroupError('conflict');
    const before = groupChangeState(group);
    group.status = 'rejected';
    group.rejectedAt = this.now().toISOString();
    group.rejectedBy = { id: identity.id, displayName: identity.displayName };
    if (rejectionReason !== undefined) group.rejectionReason = safeText(rejectionReason, 'rejectionReason', 500);
    this.deps.repository.replace(group);
    this.changed(group, before);
    return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  issue(identity: Identity, id: string, executionNote?: string): ManagerGroupProjection {
    this.requireWorkspace(identity, 'ready');
    const group = this.getGroup(id);
    if (group.status === 'issued') return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
    if (!isIssuanceGroup(group) || group.status !== 'approved') throw new GroupError('invalid-status-transition');
    const before = groupChangeState(group);
    if (executionNote !== undefined) group.executionNote = safeText(executionNote, 'executionNote', 500);
    group.status = 'issued';
    group.issuedAt = this.now().toISOString();
    group.issuedBy = { id: identity.id, displayName: identity.displayName };
    this.deps.repository.replace(group);
    this.changed(group, before);
    return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  listOverview(identity: Identity, limit = 100, cursor?: string) {
    this.requireWorkspace(identity, 'queue');
    return readOverview(this.deps.repository, limit, cursor, this.deps.resolveDisplayName);
  }

  listQueue(identity: Identity, limit = 20, cursor?: string, serverId?: string) {
    this.requireWorkspace(identity, 'queue');
    if (serverId && !this.options.servers.some((server) => server.id === serverId)) throw new GroupError('unknown-server');
    const page = readGroupPage(this.deps.repository, { status: 'pending', serverId, limit, order: 'asc', serverOrder: this.options.servers.map((server) => server.id) }, cursor);
    return { groups: page.groups.map((group) => managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName)), nextCursor: page.nextCursor };
  }

  listReview(identity: Identity, limit = 20, cursor?: string, serverId?: string) {
    this.requireWorkspace(identity, 'queue');
    if (serverId && !this.options.servers.some((server) => server.id === serverId)) throw new GroupError('unknown-server');
    const page = readGroupPage(this.deps.repository, { serverId, limit, order: 'asc', serverOrder: this.options.servers.map((server) => server.id) }, cursor);
    return { groups: page.groups.map((group) => managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName)), nextCursor: page.nextCursor };
  }

  complete(identity: Identity, id: string, executionNote?: string): ManagerGroupProjection {
    this.requireAuthenticated(identity);
    if (!hasWorkspaceAccess(identity, 'archive') && !hasWorkspaceAccess(identity, 'ready')) throw new GroupError('forbidden');
    const group = this.getGroup(id);
    if (group.status === 'completed') return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
    // Legacy warp records remain completable from pending. New regular
    // requests skip review and wait in approved until a manager completes them.
    const legacyWarp = group.status === 'pending' && group.operations.some((operation) => operation.type === 'warp');
    const regularReady = group.status === 'approved' && isNoReviewGroup(group);
    if (!legacyWarp && !regularReady) throw new GroupError('conflict');
    const before = groupChangeState(group);
    if (executionNote !== undefined) group.executionNote = safeText(executionNote, 'executionNote', 500);
    group.status = 'completed';
    group.completedAt = this.now().toISOString();
    group.completedBy = { id: identity.id, displayName: identity.displayName };
    this.deps.repository.replace(group);
    this.changed(group, before);
    return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  listArchive(identity: Identity, limit = 20, cursor?: string, status?: GroupStatus | GroupStatus[], serverId?: string, kind?: 'issuance' | 'regular', search = '') {
    this.requireAuthenticated(identity);
    if (serverId && !this.options.servers.some((server) => server.id === serverId)) throw new GroupError('unknown-server');
    const statuses = status ? (Array.isArray(status) ? status : [status]) : [];
    if (statuses.some((value) => !['pending', 'approved', 'rejected', 'issued', 'completed', 'cancelled'].includes(value))) throw new GroupError('invalid-status');
    if (kind !== undefined && kind !== 'issuance' && kind !== 'regular') throw new GroupError('invalid-input', 'invalid kind');
    this.requireArchiveAccess(identity, kind, statuses);
    const page = readGroupPage(this.deps.repository, { status, serverId, kind, search: normalizeArchiveSearch(search), limit, order: 'desc' }, cursor);
    return { groups: page.groups.map((group) => managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName)), nextCursor: page.nextCursor };
  }

  remind(identity: Identity, id: string) { return this.applyReminder(identity, id, 'remind'); }
  markOnline(identity: Identity, id: string) { return this.applyReminder(identity, id, 'online'); }

  /** Internal execution boundary used by the auto-process workflow. */
  automationProjection(id: string): ManagerGroupProjection {
    return managerProjection(this.getGroup(id), this.deps.catalog, this.deps.resolveDisplayName);
  }

  automationCustomerProjection(id: string): CustomerGroupProjection {
    return customerProjection(this.getGroup(id), this.deps.catalog, this.deps.resolveDisplayName);
  }

  recordAutomationFailure(id: string, reason: AutomationFailureReason = 'execution-failed') {
    const group = this.getGroup(id);
    if (group.status !== 'approved') return customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
    const before = groupChangeState(group);
    let changed = false;
    if (!group.reminderCount) {
      changeReminder(group, { id: 'auto-process', role: 'super_admin', displayName: 'auto-process' }, this.now(), 'remind');
      changed = true;
    }
    if (group.automationFailureReason !== reason) {
      group.automationFailureReason = reason;
      changed = true;
    }
    if (changed) {
      this.deps.repository.replace(group);
      this.changed(group, before);
    }
    return customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  recordAutomationSuccess(id: string, executionNote?: string) {
    const group = this.getGroup(id);
    if (group.status === 'issued' || group.status === 'completed') return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
    if (group.status !== 'approved') throw new GroupError('invalid-status-transition');
    const before = groupChangeState(group);
    if (executionNote) group.executionNote = safeText(executionNote, 'executionNote', 500);
    const actor = { id: 'auto-process', role: 'super_admin' as const, displayName: 'auto-process' };
    if (isIssuanceGroup(group)) {
      group.status = 'issued'; group.issuedAt = this.now().toISOString(); group.issuedBy = actor;
    } else {
      group.status = 'completed'; group.completedAt = this.now().toISOString(); group.completedBy = actor;
    }
    clearReminder(group);
    this.deps.repository.replace(group);
    this.changed(group, before);
    return managerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  private applyReminder(identity: Identity, id: string, action: 'remind' | 'online'): CustomerGroupProjection {
    this.requireAuthenticated(identity);
    this.requireWorkspace(identity, action === 'online' ? 'reminders' : 'ready');
    const group = this.getGroup(id);
    const before = groupChangeState(group);
    if (changeReminder(group, identity, this.now(), action)) {
      this.deps.repository.replace(group);
      this.changed(group, before);
    }
    return customerProjection(group, this.deps.catalog, this.deps.resolveDisplayName);
  }

  private requireWorkspace(identity: Identity, workspace: WorkspaceId) {
    this.requireAuthenticated(identity);
    if (!hasWorkspaceAccess(identity, workspace)) throw new GroupError('forbidden');
  }

  private requireArchiveAccess(identity: Identity, kind: 'issuance' | 'regular' | undefined, statuses: GroupStatus[]) {
    const readyOnly = statuses.length > 0 && statuses.every((value) => value === 'approved') && hasWorkspaceAccess(identity, 'ready');
    if (readyOnly) return;
    const workspaces: WorkspaceId[] = kind === 'issuance' ? ['reissue'] : kind === 'regular' ? ['archive'] : ['reissue', 'archive'];
    if (!workspaces.every((workspace) => hasWorkspaceAccess(identity, workspace))) throw new GroupError('forbidden');
  }

  private requireAuthenticated(identity: Identity) {
    if (!identity || !['customer', 'manager', 'super_admin'].includes(identity.role)) throw new GroupError('forbidden');
  }

  private getGroup(id: string) {
    const group = this.deps.repository.findById(id);
    if (!group) throw new GroupError('group-not-found');
    return group;
  }

}
