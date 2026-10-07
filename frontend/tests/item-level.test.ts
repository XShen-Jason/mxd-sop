import { describe, expect, it } from 'vitest';
import { codeForLevel, normalizeEquipmentLevel, splitEquipmentCode } from '../src/shared/item-level';
import { activityRewardLabel, catalogToReward } from '../src/modules/activities/store';

describe('equipment levels without the ten-level cap', () => {
  it.each([1, 10, 11, 100, Number.MAX_SAFE_INTEGER])('preserves level %s in codes and activity rewards', (itemLevel) => {
    const itemCode = itemLevel === 1 ? '01012190' : `01012190_${itemLevel}`;
    expect(normalizeEquipmentLevel(itemLevel)).toBe(itemLevel);
    expect(codeForLevel('01012190', 'equip', itemLevel)).toBe(itemCode);
    const reward = catalogToReward({ code: itemCode, name: '测试装备', itemClass: 'equip' });
    expect(reward).toMatchObject({ itemCode: '01012190', itemLevel });
    expect(activityRewardLabel(reward)).toBe(`测试装备（${itemLevel}级） ×1`);
  });

  it.each([undefined, 0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('defaults invalid or omitted level %s to one', (value) => {
    expect(normalizeEquipmentLevel(value)).toBe(1);
  });

  it('preserves high legacy levels and bound non-equipment codes', () => {
    expect(splitEquipmentCode('01012190_100')).toEqual({ baseCode: '01012190', level: 100 });
    expect(codeForLevel('02046830_1', 'consume', 100)).toBe('02046830_1');
  });
});
