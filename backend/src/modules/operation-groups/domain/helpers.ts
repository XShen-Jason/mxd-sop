import { createHash } from 'node:crypto';
import type { OperationGroup, SubmitGroupInput } from '../../../shared/types.js';
import { GroupError } from './errors.js';

export function safeText(value: unknown, field: string, max = 160) {
  if (typeof value !== 'string') throw new GroupError('invalid-input', `${field} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) throw new GroupError('invalid-input', `${field} is invalid`);
  return normalized;
}

export function strictText(value: unknown, field: string, max = 160) {
  if (typeof value !== 'string' || value !== value.trim()) throw new GroupError('invalid-input', `${field} is invalid`);
  return safeText(value, field, max);
}

export function quantity(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new GroupError('invalid-quantity');
  return value as number;
}

export function fingerprint(input: SubmitGroupInput) {
  return createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareText(a, b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}

export type PageCursor = { submittedAt: string; id: string; serverId?: string };
export function encodePageCursor(cursor: PageCursor) { return Buffer.from(JSON.stringify({ ...cursor, version: 2 }), 'utf8').toString('base64url'); }
export function decodePageCursor(cursor?: string): PageCursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { submittedAt?: unknown; id?: unknown; serverId?: unknown; version?: unknown };
    if (parsed.version !== 2 || typeof parsed.submittedAt !== 'string' || typeof parsed.id !== 'string' || (parsed.serverId !== undefined && typeof parsed.serverId !== 'string')) throw new Error();
    return { submittedAt: parsed.submittedAt, id: parsed.id, serverId: parsed.serverId };
  } catch { throw new GroupError('invalid-cursor'); }
}
export function encodeCursor(offset: number) { return Buffer.from(JSON.stringify({ offset, version: 1 }), 'utf8').toString('base64url'); }
export function decodeCursor(cursor?: string) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown; version?: unknown };
    if (parsed.version !== 1 || !Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) throw new Error();
    return parsed.offset as number;
  } catch { throw new GroupError('invalid-cursor'); }
}

export function compareText(a: string, b: string) { return a === b ? 0 : a < b ? -1 : 1; }
export function compareDesc(a: OperationGroup, b: OperationGroup) { return compareText(b.submittedAt, a.submittedAt) || compareText(b.id, a.id); }
export function compareAsc(a: OperationGroup, b: OperationGroup) { return compareText(a.submittedAt, b.submittedAt) || compareText(a.id, b.id); }
