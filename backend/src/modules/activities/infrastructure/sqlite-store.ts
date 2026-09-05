import type { SqliteDatabase } from '../../../infrastructure/sqlite.js';
import type { Activity } from '../../../shared/types.js';
import type { ActivityRepository } from './json-store.js';

type ActivityRow = { id: string; name: string; description: string; rewards_json: string; updated_at: string };

export class SqliteActivityRepository implements ActivityRepository {
  constructor(private readonly db: SqliteDatabase) {}

  all() {
    return (this.db.prepare('SELECT id, name, description, rewards_json, updated_at FROM activities ORDER BY updated_at DESC, id DESC').all() as ActivityRow[]).map(toActivity);
  }

  replaceAll(activities: Activity[]) {
    const replace = this.db.transaction((items: Activity[]) => {
      this.db.prepare('DELETE FROM activities').run();
      const insert = this.db.prepare('INSERT INTO activities (id, name, description, rewards_json, updated_at) VALUES (?, ?, ?, ?, ?)');
      for (const activity of items) insert.run(activity.id, activity.name, activity.description, JSON.stringify(activity.rewards), activity.updatedAt);
    });
    replace(activities);
  }
}

function toActivity(row: ActivityRow): Activity {
  return { id: row.id, name: row.name, description: row.description, rewards: JSON.parse(row.rewards_json), updatedAt: row.updated_at };
}
