import fs from 'node:fs';
import path from 'node:path';
import { CatalogError, ItemCatalog, type CatalogItem } from '../domain/catalog.js';

type JsonRow = {
  item_id?: unknown;
  name?: unknown;
  class?: unknown;
  image?: unknown;
};

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function imageUrl(value: unknown) {
  const filename = path.basename(text(value));
  return /^[A-Za-z0-9._-]+\.png$/iu.test(filename) ? `/item-images/${filename}` : undefined;
}

export function loadCatalogFromJson(filePath: string, options: { skipInvalidRows?: boolean } = {}): ItemCatalog {
  if (!fs.existsSync(filePath)) throw new CatalogError('catalog-unavailable', `catalog file not found: ${filePath}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new CatalogError('catalog-unavailable', 'catalog file could not be parsed');
  }
  const rows = parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
    ? (parsed as { items: JsonRow[] }).items
    : null;
  if (!rows) throw new CatalogError('catalog-unavailable', 'catalog items missing');

  const items: CatalogItem[] = [];
  const seenCodes = new Set<string>();
  let skippedInvalidRows = 0;
  let skippedDuplicateRows = 0;
  for (const row of rows) {
    const code = text(row?.item_id);
    const name = text(row?.name);
    if (!code && !name) continue;
    if (!code || !name || /[\s@]/u.test(code)) {
      if (options.skipInvalidRows) { skippedInvalidRows += 1; continue; }
      throw new CatalogError('catalog-unavailable', 'catalog contains empty code/name');
    }
    if (seenCodes.has(code)) {
      if (options.skipInvalidRows) { skippedDuplicateRows += 1; continue; }
      throw new CatalogError('catalog-unavailable', `catalog contains duplicate code: ${code}`);
    }
    seenCodes.add(code);
    items.push({ code, name, itemClass: text(row?.class) || undefined, image: imageUrl(row?.image) });
  }
  if (skippedInvalidRows > 0 || skippedDuplicateRows > 0) {
    console.warn(`catalog import skipped ${skippedInvalidRows} invalid rows and ${skippedDuplicateRows} duplicate rows`);
  }
  return new ItemCatalog(items);
}
