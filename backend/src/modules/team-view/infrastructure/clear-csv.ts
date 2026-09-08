import { parse } from 'csv-parse/sync';
import { TeamViewError } from '../domain/errors.js';
import { clearKey, type TeamClear } from '../domain/clears.js';
import type { TeamBossType } from '../domain/types.js';

const reasons: Record<string, TeamBossType> = { '副本赞助点:黑龙': 'black-dragon', '副本赞助点:进阶扎昆': 'zakum' };

export function parseClearFile(file: unknown, serverId: string) {
  const input = file as { name?: unknown; content?: unknown } | null;
  if (!input || typeof input.name !== 'string' || typeof input.content !== 'string'
    || !/\.csv$/iu.test(input.name) || input.name.length > 128 || /[\u0000-\u001f/\\]/u.test(input.name)
    || input.content.length > 1_000_000) throw new TeamViewError('invalid-file', '请选择有效 CSV 文件（不超过 100 万字符）');
  let records: string[][];
  try { records = parse(input.content, { bom: true, skip_empty_lines: true, max_record_size: 8192 }); }
  catch { throw new TeamViewError('invalid-file', 'CSV 格式错误，请检查引号和列数'); }
  if (records.length > 20_001) throw new TeamViewError('invalid-file', 'CSV 不能超过 20000 行');
  const header = (records.shift() ?? []).map(value => value.trim().toLowerCase());
  const indexes = ['char_id', 'reason', 'created_at'].map(name => header.indexOf(name));
  if (indexes.some(index => index < 0) || new Set(header).size !== header.length) {
    throw new TeamViewError('invalid-file', 'CSV 必须包含且不重复 char_id、reason、created_at 列');
  }
  const rows = new Map<string, TeamClear>();
  let skippedRows = 0;
  for (const [index, record] of records.entries()) {
    const [characterId, reason, timestamp] = indexes.map(i => record[i].trim());
    const bossType = Object.hasOwn(reasons, reason) ? reasons[reason] : undefined;
    if (!bossType) { skippedRows += 1; continue; }
    const date = parseClearDate(timestamp);
    if (!/^[0-9]{1,32}$/u.test(characterId) || !date) {
      throw new TeamViewError('invalid-file', `CSV 第 ${index + 2} 行角色 ID 或日期无效，日期须为日/月/年或年-月-日`);
    }
    const row = { date, serverId, bossType, characterId };
    rows.set(clearKey(row), row);
  }
  if (!rows.size) throw new TeamViewError('invalid-file', 'CSV 中没有黑龙或进阶扎昆的有效通关记录');
  return { rows: [...rows.values()], skippedRows };
}

function parseClearDate(value: string): string | null {
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}):(\d{2}))?$/u.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/u.exec(value);
  const match = slash ?? iso;
  if (!match) return null;
  const [year, month, day] = slash ? [match[3], match[2], match[1]] : [match[1], match[2], match[3]];
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    || Number(match[4] ?? 0) > 23 || Number(match[5] ?? 0) > 59 || Number(match[6] ?? 0) > 59) return null;
  return date;
}
