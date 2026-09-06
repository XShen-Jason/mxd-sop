export type TeamViewErrorCode = 'unauthorized' | 'invalid-date' | 'invalid-source' | 'source-unavailable';

export class TeamViewError extends Error {
  constructor(public readonly code: TeamViewErrorCode, message: string = code) {
    super(message);
  }
}
