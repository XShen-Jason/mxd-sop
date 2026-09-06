import { nextBusinessDay } from '../domain/service.js';
import type { TeamViewService } from '../domain/service.js';

const beijing = 'Asia/Shanghai';

export class TeamViewScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private readonly service: TeamViewService, private readonly onError: (error: unknown) => void = (error) => console.error('team-view daily sync failed', error)) {}

  start() { this.schedule(); }

  stop() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }

  private schedule() {
    this.stop();
    const now = new Date();
    const current = new Intl.DateTimeFormat('en-CA', { timeZone: beijing, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const currentRun = new Date(`${current}T00:05:00+08:00`);
    const runAt = now < currentRun ? currentRun : new Date(currentRun.getTime() + 86_400_000);
    this.timer = setTimeout(() => {
      void this.run(runAt).finally(() => this.schedule());
    }, Math.max(1_000, runAt.getTime() - now.getTime()));
    this.timer.unref();
  }

  private async run(runAt: Date) {
    try { await this.service.sync(nextBusinessDay(runAt)); }
    catch (error) { this.onError(error); }
  }
}
