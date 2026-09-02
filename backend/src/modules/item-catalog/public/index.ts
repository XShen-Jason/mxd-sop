export { CatalogError, ItemCatalog, MAX_CLASS_PAGE_SIZE } from '../domain/catalog.js';
export type { CatalogItem, CatalogSearchResult } from '../domain/catalog.js';
export { loadCatalogFromExcel } from '../infrastructure/excel-catalog.js';
export { loadCatalogFromJson } from '../infrastructure/json-catalog.js';
