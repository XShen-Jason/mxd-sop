import fs from 'node:fs';
import path from 'node:path';
import type { TeamSnapshot, TeamViewRepository } from '../domain/types.js';

export class JsonTeamViewRepository implements TeamViewRepository {
  private snapshots: Record<string, TeamSnapshot>;

  constructor(private readonly filePath: string) { this.snapshots = this.read(); }

  get(date: string) { return this.snapshots[date] ?? null; }

  save(snapshot: TeamSnapshot) {
    this.snapshots[snapshot.date] = structuredClone(snapshot);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.snapshots), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }

  private read(): Record<string, TeamSnapshot> {
    if (!fs.existsSync(this.filePath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, TeamSnapshot> : {};
    } catch (error) { throw new Error(`cannot read team snapshots: ${String(error)}`); }
  }
}
