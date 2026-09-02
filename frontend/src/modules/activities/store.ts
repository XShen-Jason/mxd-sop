import type { CatalogItem } from '../../types';
import { codeForLevel, isEquipment, normalizeEquipmentLevel, splitEquipmentCode } from '../../shared/item-level';

export type ActivityReward = {
  kind: 'item' | 'cash';
  quantity: number;
  itemCode?: string;
  itemLevel?: number;
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
        if (reward.kind === 'item' && !reward.itemCode) return false;
        if (reward.kind === 'item') {
          const parsed = splitEquipmentCode(reward.itemCode as string);
          const level = isEquipment(reward.itemClass) ? normalizeEquipmentLevel(reward.itemLevel ?? parsed.level) : undefined;
          const baseCode = isEquipment(reward.itemClass) ? parsed.baseCode : reward.itemCode as string;
          const key = codeForLevel(baseCode, reward.itemClass, level);
          if (itemCodes.has(key)) return false;
          itemCodes.add(key);
          reward.itemLevel = level;
          reward.itemCode = baseCode;
        }
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
  const parsed = reward.itemCode ? splitEquipmentCode(reward.itemCode) : undefined;
  const level = reward.kind === 'item' && isEquipment(reward.itemClass) ? `（${normalizeEquipmentLevel(reward.itemLevel ?? parsed?.level)}级）` : '';
  return `${reward.itemName || reward.itemCode || '物品'}${level} ×${reward.quantity}`;
}

export function catalogToReward(item: CatalogItem, quantity = 1, itemLevel = 1): ActivityReward {
  const parsed = isEquipment(item.itemClass) ? splitEquipmentCode(item.code) : { baseCode: item.code, level: undefined };
  return { kind: 'item', quantity, itemCode: parsed.baseCode, ...(isEquipment(item.itemClass) ? { itemLevel: normalizeEquipmentLevel(itemLevel === 1 ? parsed.level ?? itemLevel : itemLevel) } : {}), itemName: item.name, itemClass: item.itemClass, image: item.image };
}
