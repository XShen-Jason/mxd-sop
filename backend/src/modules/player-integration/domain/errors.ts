export type PlayerIntegrationErrorCode =
  | 'forbidden'
  | 'invalid-input'
  | 'confirmation-required'
  | 'endpoint-not-configured'
  | 'endpoint-unavailable'
  | 'player-import-failed';

export class PlayerIntegrationError extends Error {
  constructor(public readonly code: PlayerIntegrationErrorCode, message: string = code) {
    super(message);
    this.name = 'PlayerIntegrationError';
  }
}
