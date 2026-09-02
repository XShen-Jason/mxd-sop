export const MAX_EQUIPMENT_LEVEL = 10;

export function isEquipment(itemClass?: string) {
  return itemClass === 'equip';
}

export function normalizeEquipmentLevel(value: unknown) {
  const level = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(level) && level >= 1 && level <= MAX_EQUIPMENT_LEVEL ? level : 1;
}

export function splitEquipmentCode(code: string) {
  const match = /^([^_]+)_([0-9]+)$/u.exec(code);
  if (!match) return { baseCode: code, level: undefined as number | undefined };
  const level = Number(match[2]);
  return Number.isSafeInteger(level) ? { baseCode: match[1], level } : { baseCode: code, level: undefined as number | undefined };
}

export function codeForLevel(baseCode: string, itemClass: string | undefined, level: unknown) {
  if (!isEquipment(itemClass)) return baseCode;
  const normalizedLevel = normalizeEquipmentLevel(level);
  return normalizedLevel === 1 ? baseCode : `${baseCode}_${normalizedLevel}`;
}
