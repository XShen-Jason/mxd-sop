export type DirectoryErrorCode = 'invalid-query' | 'invalid-file' | 'forbidden' | 'invalid-cursor' | 'player-sync-failed';

export class DirectoryError extends Error {
  constructor(public readonly code: DirectoryErrorCode, message: string = code) {
    super(message);
    this.name = 'DirectoryError';
  }
}
