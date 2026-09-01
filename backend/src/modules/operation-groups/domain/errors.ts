export type GroupErrorCode =
  | 'invalid-input'
  | 'unknown-server'
  | 'unknown-item'
  | 'invalid-quantity'
  | 'catalog-unavailable'
  | 'idempotency-conflict'
  | 'forbidden'
  | 'group-not-found'
  | 'invalid-status-transition'
  | 'conflict'
  | 'invalid-cursor'
  | 'invalid-status'
  | 'generation-failed';

export class GroupError extends Error {
  constructor(public readonly code: GroupErrorCode, message: string = code) {
    super(message);
    this.name = 'GroupError';
  }
}
