import fs from 'node:fs';
import XLSX from '@e965/xlsx';
import { CatalogError, ItemCatalog } from '../domain/catalog.js';
import { catalogFromRows, type TabularImportOptions } from './tabular-catalog.js';

// The ESM build keeps Node's filesystem adapter opt-in for browser compatibility.
XLSX.set_fs(fs);

export function loadCatalogFromExcel(filePath: string, options: TabularImportOptions = {}): ItemCatalog {
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
  return catalogFromRows(rows, options);
}
