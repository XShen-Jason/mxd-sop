import fs from 'node:fs';
import path from 'node:path';
import type { Activity } from '../../../shared/types.js';

export interface ActivityRepository {
  all(): Activity[];
  replaceAll(activities: Activity[]): void;
}

export class JsonActivityRepository implements ActivityRepository {
  private activities: Activity[];

  constructor(private readonly filePath: string) {
    this.activities = this.read();
  }

  all() { return this.activities.map((activity) => structuredClone(activity)); }

  replaceAll(activities: Activity[]) {
    this.activities = activities.map((activity) => structuredClone(activity));
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.activities, null, 2), 'utf8');
    fs.renameSync(temporary, this.filePath);
  }

  private read() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('root must be an array');
      return parsed as Activity[];
    } catch (error) {
      throw new Error(`cannot read activity store: ${String(error)}`);
    }
  }
}
