import { isManager } from '../../auth/public/index.js';
import type { Identity, Activity, ActivityReward } from '../../../shared/types.js';
import type { ActivityRepository } from '../infrastructure/json-store.js';
import { ActivityError } from './errors.js';

export class ActivitiesService {
  constructor(private readonly repository: ActivityRepository, private readonly now: () => Date = () => new Date()) {}

  list(identity: Identity) {
    this.requireAuthenticated(identity);
    return this.repository.all();
  }

  replaceAll(identity: Identity, value: unknown) {
    this.requireManager(identity);
    const activities = normalizeActivities(value, this.now().toISOString());
    this.repository.replaceAll(activities);
    return activities;
  }

  private requireManager(identity: Identity) {
    this.requireAuthenticated(identity);
    if (!isManager(identity)) throw new ActivityError('forbidden');
  }

  private requireAuthenticated(identity: Identity) {
    if (!identity || !['customer', 'manager', 'super_admin'].includes(identity.role)) throw new ActivityError('forbidden');
  }
}

function normalizeActivities(value: unknown, updatedAt: string): Activity[] {
  if (!Array.isArray(value)) throw new ActivityError('invalid-input', 'activities must be an array');
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ActivityError('invalid-input', 'invalid activity');
    const input = entry as Record<string, unknown>;
    const id = text(input.id, 128);
    const name = text(input.name, 200);
    const description = optionalText(input.description, 2000) ?? '';
    if (ids.has(id)) throw new ActivityError('invalid-input', 'duplicate activity id');
    ids.add(id);
    if (!Array.isArray(input.rewards) || input.rewards.length === 0 || input.rewards.length > 100) throw new ActivityError('invalid-input', 'activity rewards are invalid');
    const rewards = input.rewards.map((reward) => normalizeReward(reward));
    const itemKeys = rewards.filter((reward) => reward.kind === 'item').map((reward) => `${reward.itemCode}:${reward.itemClass ?? ''}:${reward.itemLevel ?? 1}`);
    if (new Set(itemKeys).size !== itemKeys.length) throw new ActivityError('invalid-input', 'duplicate item reward');
    return { id, name, description, rewards, updatedAt: optionalText(input.updatedAt, 64) ?? updatedAt };
  });
}

function normalizeReward(value: unknown): ActivityReward {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ActivityError('invalid-input', 'invalid activity reward');
  const input = value as Record<string, unknown>;
  if (input.kind !== 'cash' && input.kind !== 'item') throw new ActivityError('invalid-input', 'invalid reward kind');
  if (!Number.isInteger(input.quantity) || Number(input.quantity) <= 0) throw new ActivityError('invalid-input', 'invalid reward quantity');
  if (input.kind === 'cash') return { kind: 'cash', quantity: Number(input.quantity) };
  const reward: ActivityReward = { kind: 'item', quantity: Number(input.quantity), itemCode: text(input.itemCode, 128) };
  for (const key of ['itemName', 'itemClass', 'image'] as const) {
    const value = optionalText(input[key], 500);
    if (value !== undefined) reward[key] = value;
  }
  if (input.itemLevel !== undefined) {
    if (!Number.isInteger(input.itemLevel) || Number(input.itemLevel) < 1 || Number(input.itemLevel) > 10) throw new ActivityError('invalid-input', 'invalid item level');
    reward.itemLevel = Number(input.itemLevel);
  }
  return reward;
}

function text(value: unknown, maxLength: number) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maxLength) throw new ActivityError('invalid-input', 'invalid text');
  return normalized;
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) throw new ActivityError('invalid-input', 'invalid text');
  return value.trim();
}
