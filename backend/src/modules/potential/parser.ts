import type { ItemCatalog } from '../item-catalog/public/index.js';
import { AutoIntegrationError } from '../auto-integration/public/index.js';
import type { PotentialOption } from './pool.js';

export interface PotentialEntry { slot: number; statType: string; statName: string; value: string; grade: string }
export interface PotentialEquipment {
  instanceId: string;
  templateId: string;
  name?: string;
  image?: string;
  potentials: PotentialEntry[];
}

// The auto API returns extracted System text. Raw event arrays are accepted for
// imported protocol fixtures too; heartbeat evt=18 carries no equipment text.
function systemText(response: string): string {
  try {
    const events = JSON.parse(response) as unknown;
    if (!Array.isArray(events)) return response;
    return events.filter((event) => event?.t === 'evt' && event.ev === 20)
      .flatMap((event) => Array.isArray(event.p) ? event.p : [])
      .filter((param) => Array.isArray(param) && param[0] === 36 && typeof param[1] === 'string')
      .map((param) => param[1]).join('\n');
  } catch { return response; }
}

function slotEntry(match: RegExpMatchArray, pool: PotentialOption[]): PotentialEntry {
  const [, slot, name, shown, grade] = match;
  const statName = name.trim();
  const value = shown.endsWith('%') ? String(Number(shown.slice(0, -1)) / 100) : shown;
  const option = pool.find((entry) => entry.statName === statName && entry.grade === grade
    && (entry.showValue === shown || Number(entry.value) === Number(value)));
  return {
    slot: Number(slot), statName, grade,
    // Never infer a different stat from its magnitude (e.g. move:0.15).
    statType: option?.statType ?? '', value: option?.value ?? value,
  };
}

export function parseResponse(response: string | undefined, catalog: ItemCatalog, pool: PotentialOption[]): PotentialEquipment[] {
  const text = systemText(response ?? '').replace(/\r\n?/gu, '\n');
  if (!text.includes('可洗练装备')) {
    throw new AutoIntegrationError('potential-list-unconfirmed', '尚未收到可识别的潜能列表，请重新获取');
  }
  const result: PotentialEquipment[] = [];
  for (const block of text.split(/(?=^\s*\d+\s*\/\s*\d+)/mu)) {
    const header = block.match(/^\s*(\d+)\s*\/\s*(\d+)/u);
    if (!header) continue;
    const potentials = [...block.matchAll(/^\s*([1-3])槽\s+(.+?)\s+\+(\d+(?:\.\d+)?%?)\s+\(([A-Za-z]+)\)/gmu)]
      .map((match) => slotEntry(match, pool)).sort((a, b) => a.slot - b.slot);
    const item = catalog.lookup(header[2]);
    result.push({ instanceId: header[1], templateId: header[2], name: item?.name, image: item?.image, potentials });
  }
  return result;
}
