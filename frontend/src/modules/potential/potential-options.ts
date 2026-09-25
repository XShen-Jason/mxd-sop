import type { PotentialEquipment, PotentialOption } from '../../types';

export const optionKey = (option: PotentialOption) => `${option.statType}:${option.value}`;
export const optionLabel = (option: PotentialOption) => `${option.statName} +${option.showValue} (${option.grade})`;

export function uniqueOptions(pool: PotentialOption[]) {
  return [...new Map(pool.map((option) => [optionKey(option), option])).values()];
}

export function searchOptions(options: PotentialOption[], query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  return options.filter((option) => {
    const text = `${optionLabel(option)} ${option.statType} ${option.value}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}

export function equipmentSlots(item: PotentialEquipment) {
  return Array.from({ length: 3 }, (_, index) => {
    const entry = item.potentials.find((potential) => potential.slot === index + 1);
    return entry ? `${entry.statType}:${entry.value}` : '';
  });
}

export function replaceSlot(values: string[], index: number, value: string) {
  return Array.from({ length: 3 }, (_, position) => position === index ? value : values[position] ?? '');
}

export function hasSlotGap(values: string[]) {
  return values.some((value, index) => Boolean(value) && values.slice(0, index).some((before) => !before));
}

export function slotPayload(values: string[]) {
  return values.filter(Boolean).map((entry) => {
    const [stat_type, value] = entry.split(':');
    return { stat_type, value };
  });
}
