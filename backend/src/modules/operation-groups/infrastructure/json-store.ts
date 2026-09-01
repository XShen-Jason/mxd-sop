import fs from 'node:fs';
import path from 'node:path';
import type { OperationGroup } from '../../../shared/types.js';

export interface GroupRepository {
  all(): OperationGroup[];
  findById(id: string): OperationGroup | undefined;
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
