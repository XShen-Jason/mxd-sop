import { businessDay } from '../domain/service.js';
import type { TeamViewService } from '../domain/service.js';

export class TeamViewScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  private pending?: Promise<void>;
  private completedDate?: string;
  private retryAt = 0;
  private controller?: AbortController;

  constructor(private readonly service: TeamViewService, private readonly onError: (error: unknown) => void = (error) => console.error('team-view daily sync failed', error), private readonly canSync: () => boolean = () => true) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.completedDate = undefined;
    this.retryAt = 0;
    this.schedule();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    await this.pending;
  }

  connectionChanged(enabled: boolean) {
    if (!this.running) return;
    if (!enabled) this.controller?.abort();
    this.retryAt = enabled ? 0 : Date.now() + 60_000;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) this.schedule();
  }

  private schedule() {
    if (!this.running) return;
    const now = new Date();
    const current = businessDay(now);
    const currentRun = new Date(`${current}T00:05:00+08:00`);
    const due = now >= currentRun && this.completedDate !== current;
    const runAt = due ? Math.max(now.getTime(), this.retryAt)
      : currentRun.getTime() + (now >= currentRun ? 86_400_000 : 0);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pending = this.run().finally(() => { this.pending = undefined; this.schedule(); });
    }, Math.max(1_000, runAt - now.getTime()));
    this.timer.unref();
  }

  private async run() {
    const now = new Date();
    const date = businessDay(now);
    if (now < new Date(`${date}T00:05:00+08:00`)) return;
    if (!this.canSync()) {
      this.retryAt = Date.now() + 60_000;
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.service.sync(date, controller.signal);
      this.completedDate = date;
      this.retryAt = 0;
    } catch (error) {
      this.retryAt = Date.now() + 60_000;
      if (this.running && this.canSync()) this.onError(error);
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
}
