import { CatalogError, ItemCatalog, type CatalogItem } from '../domain/catalog.js';
import { imageUrl } from './image-map.js';

export type TabularImportOptions = {
  skipInvalidRows?: boolean;
  images?: ReadonlyMap<string, string>;
};

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

export function catalogFromRows(rows: unknown[][], options: TabularImportOptions = {}): ItemCatalog {
  const [headerRow = [], ...dataRows] = rows;
  const header = headerRow.map((value) => text(value).toLowerCase().replace(/^\uFEFF/u, ''));
  const indexes = {
    code: header.indexOf('item_id'),
    name: header.indexOf('name'),
    itemClass: header.indexOf('class'),
    image: header.indexOf('image')
  };
  if (indexes.code < 0 || indexes.name < 0) throw new CatalogError('catalog-unavailable', 'catalog columns missing');

  const items: CatalogItem[] = [];
  const seenCodes = new Set<string>();
  let skippedInvalidRows = 0;
  let skippedDuplicateRows = 0;
  for (const row of dataRows) {
    const code = text(row[indexes.code]);
    const name = text(row[indexes.name]);
    if (!code && !name) continue;
    if (!code || !name || /[\s@]/u.test(code)) {
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
    const image = options.images?.get(code) ?? imageUrl(row[indexes.image]);
    items.push({ code, name, itemClass: text(row[indexes.itemClass]) || undefined, image });
  }
  if (skippedInvalidRows > 0 || skippedDuplicateRows > 0) {
    console.warn(`catalog import skipped ${skippedInvalidRows} invalid rows and ${skippedDuplicateRows} duplicate rows`);
  }
  return new ItemCatalog(items);
}
