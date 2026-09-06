import type { DirectoryRow } from '../domain/types.js';
import { DirectoryError } from '../domain/errors.js';

const FILE_SERVERS: Record<string, string> = {
  'mg-char-user-qq.csv': 'mushroom',
  'xr-char-user-qq.csv': 'yeti',
  'hwn-char-user-qq.csv': 'red-snail',
  'uu-char-user-qq.csv': 'uu',
  'ppz-char-user-qq.csv': 'piaopiao-pig'
};
const MAX_FILE_CHARS = 1_000_000;
const MAX_ROWS = 200_000;

export interface UploadFile { name: string; content: string }

export function importCsvFile(file: UploadFile, serverId: string) {
  const name = normalizeFileName(file);
  const expectedServer = FILE_SERVERS[name];
  if (!expectedServer || expectedServer !== serverId) throw new DirectoryError('invalid-file', `csv file does not belong to server: ${serverId}`);
  const parsed = parseCsvFile(file, serverId, name);
  if (!parsed.rows.length) throw new DirectoryError('invalid-file', 'no valid csv rows found');
  const unique = new Map(parsed.rows.map((row) => [`${row.serverId}\u0000${row.charId}\u0000${row.userId}\u0000${row.username}\u0000${row.bindQQ}`, row]));
  return { rows: [...unique.values()], skippedRows: parsed.skippedRows, fileCount: 1 };
}

function normalizeFileName(file: UploadFile) {
  if (!file || typeof file.name !== 'string' || typeof file.content !== 'string') throw new DirectoryError('invalid-file', 'invalid csv file payload');
  const name = file.name.trim().toLowerCase();
  if (!name || name.length > 128 || /[\u0000-\u001f\u007f/\\]/u.test(name) || file.content.length > MAX_FILE_CHARS) throw new DirectoryError('invalid-file', `unsupported csv file: ${file.name}`);
  return name;
}

function parseCsvFile(file: UploadFile, serverId: string, name: string) {
  const parsed = parseCsv(file.content);
  if (!parsed.length) throw new DirectoryError('invalid-file', `${file.name} is empty`);
  const header = parsed.shift()!.map((value) => value.trim().toLowerCase());
  const indexes = { charId: header.indexOf('char_id'), userId: header.indexOf('user_id'), username: header.indexOf('username'), bindQQ: header.indexOf('bindqq') };
  if (Object.values(indexes).some((index) => index < 0)) throw new DirectoryError('invalid-file', `${file.name} is missing required columns`);
  const rows: DirectoryRow[] = [];
  let skippedRows = 0;
  for (const record of parsed) {
    if (rows.length >= MAX_ROWS) throw new DirectoryError('invalid-file', 'too many csv rows');
    const row = { serverId, sourceFile: name, charId: text(record[indexes.charId]), userId: text(record[indexes.userId]), username: text(record[indexes.username]), bindQQ: text(record[indexes.bindQQ]) };
    if (!row.charId && !row.userId && !row.username && !row.bindQQ) continue;
    if (!validRow(row)) { skippedRows += 1; continue; }
    rows.push(row);
  }
  return { rows, skippedRows };
}

function text(value: unknown) { return value == null ? '' : String(value).trim(); }

function validRow(row: DirectoryRow) {
  return /^[0-9]{1,32}$/u.test(row.charId)
    && /^[^\u0000-\u001f\u007f]{1,64}$/u.test(row.userId)
    && /^[^\u0000-\u001f\u007f]{1,80}$/u.test(row.username)
    && /^[0-9]{4,20}$/u.test(row.bindQQ);
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const content = source.replace(/^\uFEFF/u, '');
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n' || character === '\r') { if (character === '\r' && content[index + 1] === '\n') index += 1; row.push(field); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) throw new DirectoryError('invalid-file', 'csv quoting is invalid');
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
