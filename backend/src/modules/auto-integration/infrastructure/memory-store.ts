import type { AutoIntegrationRepository, AutoIntegrationState } from '../domain/types.js';

export class MemoryAutoIntegrationRepository implements AutoIntegrationRepository {
  private state: AutoIntegrationState | null = null;
  get() { return this.state ? structuredClone(this.state) : null; }
  save(state: AutoIntegrationState) { this.state = structuredClone(state); }
}
