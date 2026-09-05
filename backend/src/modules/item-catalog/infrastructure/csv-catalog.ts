import fs from 'node:fs';
import { CatalogError, ItemCatalog } from '../domain/catalog.js';
import { catalogFromRows, type TabularImportOptions } from './tabular-catalog.js';

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const content = source.replace(/^\uFEFF/u, '');

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (inQuotes) throw new CatalogError('catalog-unavailable', 'catalog file could not be parsed');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function loadCatalogFromCsv(filePath: string, options: TabularImportOptions = {}): ItemCatalog {
  if (!fs.existsSync(filePath)) throw new CatalogError('catalog-unavailable', `catalog file not found: ${filePath}`);
  let rows: string[][];
  try {
    rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError('catalog-unavailable', 'catalog file could not be parsed');
  }
  return catalogFromRows(rows, options);
}
