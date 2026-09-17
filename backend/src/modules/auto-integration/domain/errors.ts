export type AutoIntegrationErrorCode = 'forbidden' | 'connection-disabled' | 'confirmation-required' | 'endpoint-not-configured' | 'endpoint-unavailable' | 'invalid-input' | 'auto-request-failed' | string;

export class AutoIntegrationError extends Error {
  constructor(public readonly code: AutoIntegrationErrorCode, message = code) {
    super(message);
  }
}
