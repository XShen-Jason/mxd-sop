export type TeamViewErrorCode = 'unauthorized' | 'forbidden' | 'invalid-file' | 'unknown-server' | 'invalid-date' | 'invalid-source' | 'source-unavailable';

export class TeamViewError extends Error {
  constructor(public readonly code: TeamViewErrorCode, message: string = code) {
    super(message);
  }
}
