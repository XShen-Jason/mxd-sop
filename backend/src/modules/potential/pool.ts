import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { AutoIntegrationError } from '../auto-integration/public/index.js';

export interface PotentialOption {
  statType: string;
  statName: string;
  value: string;
  showValue: string;
  grade: string;
  pool: string;
}

export function loadPool(filePath: string): PotentialOption[] {
  if (!fs.existsSync(filePath)) return [];
  const rows = parse(fs.readFileSync(filePath, 'utf8'), {
    columns: true, bom: true, skip_empty_lines: true, trim: true,
  }) as Array<Record<string, string>>;
  return rows.filter((row) => row.enabled === '1').map((row) => {
    if (!/^[a-z]+$/u.test(row.stat_type) || !/^\d+(?:\.\d+)?$/u.test(row.value)
      || !row.stat_name || !row.show_value || !row.grade) {
      throw new Error('Invalid potential pool row');
    }
    return {
      statType: row.stat_type, statName: row.stat_name, value: row.value,
      showValue: row.show_value, grade: row.grade, pool: row.pool,
    };
  });
}

export function buildPotentialCommand(instanceId: string, input: unknown, pool: PotentialOption[]) {
  if (!/^\d+$/u.test(instanceId)) throw new AutoIntegrationError('invalid-input', '装备实例 ID 必须是数字');
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) {
    throw new AutoIntegrationError('invalid-input', '请按顺序选择 1 至 3 个潜能');
  }
  const entries = input.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AutoIntegrationError('invalid-input');
    const { stat_type: type, value: amount } = value as Record<string, unknown>;
    const option = pool.find((item) => item.statType === type && item.value === amount);
    if (!option) throw new AutoIntegrationError('invalid-input', '所选潜能不在已启用的潜能池中');
    return `${option.statType}:${option.value}`;
  });
  return `potentialset@${instanceId}@${entries.join(',')}`;
}
