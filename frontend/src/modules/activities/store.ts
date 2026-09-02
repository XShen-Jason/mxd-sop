import type { CatalogItem } from '../../types';

export type ActivityReward = {
  kind: 'item' | 'cash';
  quantity: number;
  itemCode?: string;
  itemName?: string;
  itemClass?: string;
  image?: string;
};

export type Activity = {
  id: string;
  name: string;
  description: string;
  rewards: ActivityReward[];
  updatedAt: string;
};

export const ACTIVITIES_KEY = 'game-support-activities';

export function readActivities(): Activity[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVITIES_KEY) ?? '[]') as Activity[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id && item.name && Array.isArray(item.rewards)).map((item) => {
      const itemCodes = new Set<string>();
      const rewards = item.rewards.filter((reward) => {
        if (!reward || (reward.kind !== 'cash' && reward.kind !== 'item') || !Number.isFinite(reward.quantity) || reward.quantity <= 0) return false;
        if (reward.kind === 'item' && (!reward.itemCode || itemCodes.has(reward.itemCode))) return false;
        if (reward.kind === 'item') itemCodes.add(reward.itemCode as string);
        return true;
      });
      return { ...item, rewards };
    }).filter((item) => item.rewards.length > 0) : [];
  } catch { return []; }
}

export function writeActivities(activities: Activity[]) {
  try { localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(activities)); } catch { /* private browsing can disable storage */ }
}

export function activityRewardLabel(reward: ActivityReward) {
  if (reward.kind === 'cash') return `点券 ×${reward.quantity}`;
  return `${reward.itemName || reward.itemCode || '物品'} ×${reward.quantity}`;
}

export function catalogToReward(item: CatalogItem, quantity = 1): ActivityReward {
  return { kind: 'item', quantity, itemCode: item.code, itemName: item.name, itemClass: item.itemClass, image: item.image };
}
