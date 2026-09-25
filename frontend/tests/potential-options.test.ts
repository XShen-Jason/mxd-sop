import { describe, expect, it } from 'vitest';
import { equipmentSlots, hasSlotGap, replaceSlot, searchOptions, slotPayload, uniqueOptions } from '../src/modules/potential/potential-options';
import type { PotentialOption } from '../src/types';

const strength: PotentialOption = { statType: 'str', statName: '力量', value: '15', showValue: '15', grade: 'B', pool: 'low' };
describe('potential slot editing regression', () => {
  it('adds all three entries to equipment without existing potentials', () => {
    let slots = equipmentSlots({ instanceId: '1', templateId: '01302120', potentials: [] });
    slots = replaceSlot(slots, 0, 'equipatk:0.07');
    slots = replaceSlot(slots, 1, 'equipluk:0.06');
    slots = replaceSlot(slots, 2, 'fashionatk:0.04');
    expect(slotPayload(slots)).toEqual([
      { stat_type: 'equipatk', value: '0.07' }, { stat_type: 'equipluk', value: '0.06' }, { stat_type: 'fashionatk', value: '0.04' },
    ]);
  });
  it('adds slots to one-potential equipment while retaining the first entry', () => {
    expect(replaceSlot(['str:5'], 1, 'int:15')).toEqual(['str:5', 'int:15', '']);
    expect(hasSlotGap(['str:5', '', 'int:15'])).toBe(true);
  });
  it('deduplicates repeated pools and matches separated search tokens', () => {
    const options = uniqueOptions([strength, { ...strength, pool: 'high' }]);
    expect(options).toHaveLength(1);
    expect(searchOptions(options, '力量 15')).toEqual([expect.objectContaining({ statType: 'str' })]);
    expect(searchOptions(options, 'STR b')).toHaveLength(1);
    expect(searchOptions(options, '力量 20')).toHaveLength(0);
  });
});
