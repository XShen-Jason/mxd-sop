export type ActivityErrorCode = 'invalid-input' | 'forbidden';

export class ActivityError extends Error {
  constructor(public readonly code: ActivityErrorCode, message: string = code) {
    super(message);
  }
}
