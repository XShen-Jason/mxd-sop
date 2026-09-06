import type { PlayerIntegrationRepository, PlayerIntegrationState } from '../domain/types.js';

export class MemoryPlayerIntegrationRepository implements PlayerIntegrationRepository {
  private state: PlayerIntegrationState | null = null;
  get() { return this.state ? structuredClone(this.state) : null; }
  save(state: PlayerIntegrationState) { this.state = structuredClone(state); }
}
