import fs from 'node:fs';
import path from 'node:path';
import XLSX from '@e965/xlsx';
import { CatalogError, ItemCatalog, type CatalogItem } from '../domain/catalog.js';

// The ESM build keeps Node's filesystem adapter opt-in for browser compatibility.
XLSX.set_fs(fs);

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function normalizeCode(value: unknown) {
  // `raw: false` uses the workbook's display format, so formatted numeric
  // cells retain their leading zeroes while plain values keep their exact text.
  return text(value);
}

function imageUrl(value: unknown) {
  const filename = path.basename(text(value));
  return /^[A-Za-z0-9._-]+\.png$/iu.test(filename) ? `/item-images/${filename}` : undefined;
}

export function loadCatalogFromExcel(filePath: string, options: { skipInvalidRows?: boolean } = {}): ItemCatalog {
  if (!fs.existsSync(filePath)) throw new CatalogError('catalog-unavailable', `catalog file not found: ${filePath}`);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(filePath, { cellNF: true, cellText: true, raw: false });
  } catch {
    throw new CatalogError('catalog-unavailable', 'catalog file could not be parsed');
  }
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new CatalogError('catalog-unavailable', 'catalog sheet not found');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '', raw: false });
  const header = (rows.shift() ?? []).map((value) => text(value).toLowerCase().replace(/^\uFEFF/u, ''));
  const indexes = { code: header.indexOf('item_id'), name: header.indexOf('name'), itemClass: header.indexOf('class'), image: header.indexOf('image') };
  if (indexes.code < 0 || indexes.name < 0) throw new CatalogError('catalog-unavailable', 'catalog columns missing');
  const items: CatalogItem[] = [];
  let skippedInvalidRows = 0;
  let skippedDuplicateRows = 0;
  const seenCodes = new Set<string>();
  for (const row of rows) {
    const code = normalizeCode(row[indexes.code]);
    const name = text(row[indexes.name]);
    if (!code && !name) continue;
    if (!code || !name) {
      if (options.skipInvalidRows) {
        skippedInvalidRows += 1;
        continue;
      }
      throw new CatalogError('catalog-unavailable', 'catalog contains empty code/name');
    }
    if (seenCodes.has(code)) {
      if (options.skipInvalidRows) {
        skippedDuplicateRows += 1;
        continue;
      }
      throw new CatalogError('catalog-unavailable', `catalog contains duplicate code: ${code}`);
    }
    seenCodes.add(code);
    items.push({ code, name, itemClass: text(row[indexes.itemClass]) || undefined, image: imageUrl(row[indexes.image]) });
  }
  if (skippedInvalidRows > 0 || skippedDuplicateRows > 0) {
    console.warn(`catalog import skipped ${skippedInvalidRows} invalid rows and ${skippedDuplicateRows} duplicate rows`);
  }
  return new ItemCatalog(items);
}
