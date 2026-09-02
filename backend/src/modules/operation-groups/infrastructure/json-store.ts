import fs from 'node:fs';
import path from 'node:path';
import type { GroupStatus, OperationGroup } from '../../../shared/types.js';
import { compareAsc, compareDesc } from '../domain/helpers.js';

export type GroupPageQuery = {
  ownerId?: string;
  status?: GroupStatus | GroupStatus[];
  serverId?: string;
  kind?: 'issuance' | 'regular';
  limit: number;
  order: 'asc' | 'desc';
  after?: { submittedAt: string; id: string; serverId?: string };
  serverOrder?: string[];
};

export interface GroupRepository {
  all(): OperationGroup[];
  findById(id: string): OperationGroup | undefined;
  findByIdempotency?(submittedById: string, idempotencyKey: string): OperationGroup | undefined;
  listPage?(query: GroupPageQuery): OperationGroup[];
  insert(group: OperationGroup): void;
  replace(group: OperationGroup): void;
}

export class JsonGroupRepository implements GroupRepository {
  private groups: OperationGroup[];

  constructor(private readonly filePath: string) {
    this.groups = this.read();
  }

  all() {
    return this.groups.map((group) => structuredClone(group));
  }

  findById(id: string) {
    const group = this.groups.find((candidate) => candidate.id === id);
    return group ? structuredClone(group) : undefined;
  }

  findByIdempotency(submittedById: string, idempotencyKey: string) {
    const group = this.groups.find((candidate) => candidate.submittedBy.id === submittedById && candidate.idempotencyKey === idempotencyKey);
    return group ? structuredClone(group) : undefined;
  }

  listPage(query: GroupPageQuery) {
    const serverOrder = new Map((query.serverOrder ?? []).map((id, index) => [id, index]));
    const groups = this.groups.filter((group) => {
      if (query.ownerId && group.submittedBy.id !== query.ownerId) return false;
      if (query.status && (Array.isArray(query.status) ? !query.status.includes(group.status) : group.status !== query.status)) return false;
      if (query.serverId && group.server.id !== query.serverId) return false;
      if (query.kind) {
        const issuance = group.operations.some((operation) => operation.type === 'item' || operation.type === 'cash');
        if (query.kind === 'issuance' !== issuance) return false;
      }
      return true;
    });
    groups.sort((a, b) => {
      if (query.serverOrder?.length) {
        const serverCompare = (serverOrder.get(a.server.id) ?? Number.MAX_SAFE_INTEGER) - (serverOrder.get(b.server.id) ?? Number.MAX_SAFE_INTEGER);
        if (serverCompare) return serverCompare;
      }
      return query.order === 'asc' ? compareAsc(a, b) : compareDesc(a, b);
    });
    const start = query.after ? groups.findIndex((group) => group.submittedAt === query.after!.submittedAt && group.id === query.after!.id) + 1 : 0;
    return groups.slice(Math.max(0, start), Math.max(0, start) + query.limit + 1).map((group) => structuredClone(group));
  }

  insert(group: OperationGroup) {
    this.groups.push(structuredClone(group));
    this.persist();
  }

  replace(group: OperationGroup) {
    const index = this.groups.findIndex((candidate) => candidate.id === group.id);
    if (index < 0) throw new Error('group not found');
    this.groups[index] = structuredClone(group);
    this.persist();
  }

  private read(): OperationGroup[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('root must be an array');
      return parsed as OperationGroup[];
    } catch (error) {
      throw new Error(`cannot read operation store: ${String(error)}`);
    }
  }

  private persist() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.groups, null, 2), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }
}
