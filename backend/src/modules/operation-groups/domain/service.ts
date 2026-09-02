import { randomUUID } from 'node:crypto';
import { appOptions } from '../../../config/options.js';
import { isManager, isSuperAdmin } from '../../auth/public/index.js';
import { generateCommands } from '../../command-generation/public/index.js';
import type { ItemCatalog } from '../../item-catalog/public/index.js';
import type {
  AppOptions,
  CustomerGroupProjection,
  GroupStatus,
  Identity,
  ManagerGroupProjection,
  OperationGroup,
  SubmitGroupInput
} from '../../../shared/types.js';
import type { GroupRepository } from '../infrastructure/json-store.js';
import { compareDesc, compareText, decodeCursor, encodeCursor, fingerprint, safeText } from './helpers.js';
import { GroupError } from './errors.js';
import { normalizeSubmission } from './normalization.js';
import { readGroupPage } from './pagination.js';

export { GroupError } from './errors.js';
export type { GroupErrorCode } from './errors.js';

interface ServiceDependencies {
  repository: GroupRepository;
  catalog: ItemCatalog;
  options?: AppOptions;
  resolveDisplayName?: (id: string) => string | undefined;
  now?: () => Date;
  idFactory?: () => string;
}

const actorFields = ['submittedBy', 'completedBy', 'approvedBy', 'rejectedBy', 'issuedBy', 'cancelledBy', 'updatedBy'] as const;

export class OperationGroupsService {
  private readonly options: AppOptions;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly deps: ServiceDependencies) {
    this.options = deps.options ?? appOptions;
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? randomUUID;
  }

  getOptions() {
    return structuredClone(this.options);
  }

  submit(identity: Identity, input: SubmitGroupInput, idempotencyKey?: string): CustomerGroupProjection {
    this.requireAuthenticated(identity);
    if (idempotencyKey && (idempotencyKey.length > 128 || /[\s\u0000-\u001f\u007f]/u.test(idempotencyKey))) throw new GroupError('invalid-input');
    if (idempotencyKey) {
      const existing = this.deps.repository.findByIdempotency?.(identity.id, idempotencyKey)
        ?? this.deps.repository.all().find((group) => group.idempotencyKey === idempotencyKey && group.submittedBy.id === identity.id);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint(input)) throw new GroupError('idempotency-conflict');
        return this.customerProjection(existing);
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
    return this.customerProjection(group);
  }

  listOwn(identity: Identity, limit = 20, cursor?: string, status?: GroupStatus | GroupStatus[], kind?: 'issuance' | 'regular') {
    this.requireAuthenticated(identity);
    const statuses = status ? (Array.isArray(status) ? status : [status]) : [];
    if (statuses.some((value) => !['pending', 'approved', 'rejected', 'issued', 'completed', 'cancelled'].includes(value))) throw new GroupError('invalid-status');
    if (kind !== undefined && kind !== 'issuance' && kind !== 'regular') throw new GroupError('invalid-input', 'invalid kind');
    const page = readGroupPage(this.deps.repository, { ownerId: identity.id, status, kind, limit, order: 'desc' }, cursor);
    return { groups: page.groups.map((group) => this.customerProjection(group)), nextCursor: page.nextCursor };
  }

  cancel(identity: Identity, id: string): CustomerGroupProjection {
    this.requireAuthenticated(identity);
    const group = this.getGroup(id);
    if (group.submittedBy.id !== identity.id) throw new GroupError('forbidden');
    if (group.status === 'cancelled') return this.customerProjection(group);
    if (!canCustomerModify(group)) throw new GroupError('invalid-status-transition');
    group.status = 'cancelled';
    group.cancelledAt = this.now().toISOString();
    group.cancelledBy = { id: identity.id, displayName: identity.displayName };
    this.deps.repository.replace(group);
    return this.customerProjection(group);
  }

  update(identity: Identity, id: string, input: SubmitGroupInput): CustomerGroupProjection {
    this.requireAuthenticated(identity);
    const group = this.getGroup(id);
    if (group.submittedBy.id !== identity.id) throw new GroupError('forbidden');
    if (!canCustomerModify(group)) throw new GroupError('invalid-status-transition');
    const replacement = normalizeSubmission(input, this.options, this.deps.catalog);
    group.server = replacement.server;
    group.account = replacement.account;
    group.characterId = replacement.characterId;
    group.playerQQ = replacement.playerQQ;
    group.reason = replacement.reason;
    group.operations = replacement.operations;
    group.updatedAt = this.now().toISOString();
    group.updatedBy = { id: identity.id, displayName: identity.displayName };
    const noReview = isNoReviewGroup(replacement);
    group.status = noReview ? 'approved' : 'pending';
    delete group.completedAt;
    delete group.completedBy;
    this.deps.repository.replace(group);
    return this.customerProjection(group);
  }

  approve(identity: Identity, id: string): ManagerGroupProjection {
    this.requireManager(identity);
    const group = this.getGroup(id);
    if (group.status === 'approved') return this.managerProjection(group);
    if (group.status !== 'pending') throw new GroupError('conflict');
    group.status = 'approved';
    group.approvedAt = this.now().toISOString();
    group.approvedBy = { id: identity.id, displayName: identity.displayName };
    this.deps.repository.replace(group);
    return this.managerProjection(group);
  }

  reject(identity: Identity, id: string, rejectionReason?: string): ManagerGroupProjection {
    this.requireManager(identity);
    const group = this.getGroup(id);
    if (group.status === 'rejected') return this.managerProjection(group);
    if (group.status !== 'pending') throw new GroupError('conflict');
    group.status = 'rejected';
    group.rejectedAt = this.now().toISOString();
    group.rejectedBy = { id: identity.id, displayName: identity.displayName };
    if (rejectionReason !== undefined) group.rejectionReason = safeText(rejectionReason, 'rejectionReason', 500);
    this.deps.repository.replace(group);
    return this.managerProjection(group);
  }

  issue(identity: Identity, id: string, executionNote?: string): ManagerGroupProjection {
    if (!isSuperAdmin(identity)) throw new GroupError('forbidden');
    const group = this.getGroup(id);
    if (group.status === 'issued') return this.managerProjection(group);
    if (!isIssuanceGroup(group) || group.status !== 'approved') throw new GroupError('invalid-status-transition');
    if (executionNote !== undefined) group.executionNote = safeText(executionNote, 'executionNote', 500);
    group.status = 'issued';
    group.issuedAt = this.now().toISOString();
    group.issuedBy = { id: identity.id, displayName: identity.displayName };
    this.deps.repository.replace(group);
    return this.managerProjection(group);
  }

  listOverview(identity: Identity, limit = 100, cursor?: string) {
    this.requireManager(identity);
    const groups = this.deps.repository.all().sort(compareDesc);
    const byCustomer = new Map<string, { customer: { id: string; displayName: string }; total: number; pending: number; approved: number; rejected: number; issued: number; cancelled: number }>();
    for (const group of groups) {
      const key = group.submittedBy.id;
      const item = byCustomer.get(key) ?? { customer: this.currentActor(group.submittedBy), total: 0, pending: 0, approved: 0, rejected: 0, issued: 0, cancelled: 0 };
      item.total += 1;
      if (group.status === 'pending') item.pending += 1;
      if (group.status === 'approved') item.approved += 1;
      if (group.status === 'rejected') item.rejected += 1;
      if (group.status === 'issued' || group.status === 'completed') item.issued += 1;
      if (group.status === 'cancelled') item.cancelled += 1;
      byCustomer.set(key, item);
    }
    const values = [...byCustomer.values()].sort((a, b) => compareText(a.customer.id, b.customer.id));
    const page = this.page(values, limit, cursor);
    return { customers: page.groups, nextCursor: page.nextCursor };
  }

  listQueue(identity: Identity, limit = 20, cursor?: string, serverId?: string) {
    this.requireManager(identity);
    if (serverId && !this.options.servers.some((server) => server.id === serverId)) throw new GroupError('unknown-server');
    const page = readGroupPage(this.deps.repository, { status: 'pending', serverId, limit, order: 'asc', serverOrder: this.options.servers.map((server) => server.id) }, cursor);
    return { groups: page.groups.map((group) => this.managerProjection(group)), nextCursor: page.nextCursor };
  }

  listReview(identity: Identity, limit = 20, cursor?: string, serverId?: string) {
    this.requireManager(identity);
    if (serverId && !this.options.servers.some((server) => server.id === serverId)) throw new GroupError('unknown-server');
    const page = readGroupPage(this.deps.repository, { serverId, limit, order: 'asc', serverOrder: this.options.servers.map((server) => server.id) }, cursor);
    return { groups: page.groups.map((group) => this.managerProjection(group)), nextCursor: page.nextCursor };
  }

  complete(identity: Identity, id: string, executionNote?: string): ManagerGroupProjection {
    this.requireManager(identity);
    const group = this.getGroup(id);
    if (group.status === 'completed') return this.managerProjection(group);
    // Legacy warp records remain completable from pending. New regular
    // requests skip review and wait in approved until a manager completes them.
    const legacyWarp = group.status === 'pending' && group.operations.some((operation) => operation.type === 'warp');
    const regularReady = group.status === 'approved' && isNoReviewGroup(group);
    if (!legacyWarp && !regularReady) throw new GroupError('conflict');
    if (executionNote !== undefined) group.executionNote = safeText(executionNote, 'executionNote', 500);
    group.status = 'completed';
    group.completedAt = this.now().toISOString();
    group.completedBy = { id: identity.id, displayName: identity.displayName };
    this.deps.repository.replace(group);
    return this.managerProjection(group);
  }

  listArchive(identity: Identity, limit = 20, cursor?: string, status?: GroupStatus | GroupStatus[], serverId?: string, kind?: 'issuance' | 'regular') {
    this.requireManager(identity);
    if (serverId && !this.options.servers.some((server) => server.id === serverId)) throw new GroupError('unknown-server');
    const statuses = status ? (Array.isArray(status) ? status : [status]) : [];
    if (statuses.some((value) => !['pending', 'approved', 'rejected', 'issued', 'completed', 'cancelled'].includes(value))) throw new GroupError('invalid-status');
    if (kind !== undefined && kind !== 'issuance' && kind !== 'regular') throw new GroupError('invalid-input', 'invalid kind');
    const page = readGroupPage(this.deps.repository, { status, serverId, kind, limit, order: 'desc' }, cursor);
    return { groups: page.groups.map((group) => this.managerProjection(group)), nextCursor: page.nextCursor };
  }

  private page<T>(items: T[], limit: number, cursor?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new GroupError('invalid-input', 'invalid limit');
    const offset = decodeCursor(cursor);
    const page = items.slice(offset, offset + limit);
    return { groups: page, nextCursor: offset + page.length < items.length ? encodeCursor(offset + page.length) : null };
  }

  private requireManager(identity: Identity) {
    this.requireAuthenticated(identity);
    if (!isManager(identity)) throw new GroupError('forbidden');
  }

  private requireAuthenticated(identity: Identity) {
    if (!identity || !['customer', 'manager', 'super_admin'].includes(identity.role)) throw new GroupError('forbidden');
  }

  private getGroup(id: string) {
    const group = this.deps.repository.findById(id);
    if (!group) throw new GroupError('group-not-found');
    return group;
  }

  private customerProjection(group: OperationGroup): CustomerGroupProjection {
    const { commandRuleVersion: _version, idempotencyKey: _key, requestFingerprint: _fingerprint, ...projection } = this.withCurrentActorNames(group);
    return projection;
  }

  private managerProjection(group: OperationGroup): ManagerGroupProjection {
    let commands;
    try {
      commands = generateCommands(group.characterId, group.operations);
    } catch (error) {
      throw new GroupError('generation-failed', error instanceof Error ? error.message : 'command generation failed');
    }
    const projection = this.customerProjection(group);
    return { ...projection, commands, commandRuleVersion: group.commandRuleVersion };
  }

  private withCurrentActorNames(group: OperationGroup) {
    const projection = structuredClone(group);
    projection.operations = projection.operations.map((operation) => {
      if (operation.type !== 'item' || operation.itemImage) return operation;
      const baseCode = operation.itemCode.replace(/_[0-9]+$/u, '');
      const image = this.deps.catalog.lookup(operation.itemCode)?.image ?? this.deps.catalog.lookup(baseCode)?.image;
      return image ? { ...operation, itemImage: image } : operation;
    });
    for (const field of actorFields) {
      const actor = projection[field];
      if (actor) actor.displayName = this.deps.resolveDisplayName?.(actor.id) ?? actor.displayName;
    }
    return projection;
  }

  private currentActor(actor: { id: string; displayName: string }) {
    return { ...actor, displayName: this.deps.resolveDisplayName?.(actor.id) ?? actor.displayName };
  }
}

function isIssuanceGroup(group: Pick<OperationGroup, 'operations'>) {
  return group.operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
}

function canCustomerModify(group: OperationGroup) {
  return group.status === 'pending' || (isNoReviewGroup(group) && group.status === 'approved');
}

function isNoReviewGroup(group: Pick<OperationGroup, 'operations'>) {
  return group.operations.length > 0 && group.operations.every((operation) => operation.type === 'kick' || operation.type === 'ban');
}
