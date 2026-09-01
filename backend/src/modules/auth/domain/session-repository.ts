export interface SessionRepository {
  create(token: string, userId: string, expiresAt: number): void;
  find(token: string): { userId: string; expiresAt: number } | undefined;
  remove(token: string): void;
  removeForUser(userId: string): void;
}
