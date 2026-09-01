import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { CatalogError, ItemCatalog, loadCatalogFromExcel, loadCatalogFromJson } from '../src/modules/item-catalog/public/index.js';

describe('item-catalog.search', () => {
  const catalog = new ItemCatalog([
    { code: '02000000', name: '红色药水', itemClass: 'consume' },
    { code: '00000001', name: '金币' },
    { code: 'A-2', name: '蓝色药水' }
  ]);

  it('matches code or name case-insensitively with stable relevance order', () => {
    expect(catalog.search('药水', 10).items.map((item) => item.code)).toEqual(['02000000', 'A-2']);
    expect(catalog.search('0000', 10).items[0].code).toBe('00000001');
  });

  it('bounds query and cursor inputs', () => {
    expect(() => catalog.search('')).toThrowError(CatalogError);
    expect(() => catalog.search('x', 51)).toThrowError(CatalogError);
    expect(() => catalog.search('x', 20, 'bad-cursor')).toThrowError(CatalogError);
  });

  it('loads the supplied workbook while retaining text codes', () => {
    const fromWorkspace = path.resolve(process.cwd(), 'data/item-catalog/source/道具表.xlsx');
    const fromBackend = path.resolve(process.cwd(), '..', 'data/item-catalog/source/道具表.xlsx');
    const loaded = loadCatalogFromExcel(fs.existsSync(fromWorkspace) ? fromWorkspace : fromBackend, { skipInvalidRows: true });
    expect(loaded.lookup('02000000')).toMatchObject({ code: '02000000' });
    expect(typeof loaded.lookup('02000000')?.code).toBe('string');
  });

  it('loads the bundled JSON catalog with optional image URLs', () => {
    const workspacePath = path.resolve(process.cwd(), 'data/item-catalog/source/items.json');
    const filePath = fs.existsSync(workspacePath) ? workspacePath : path.resolve(process.cwd(), '..', 'data/item-catalog/source/items.json');
    const loaded = loadCatalogFromJson(filePath, { skipInvalidRows: true });
    expect(loaded.size).toBe(5830);
    expect(loaded.lookup('02000000')).toMatchObject({ image: '/item-images/02000000.png' });
    expect(loaded.lookup('0')?.image).toBeUndefined();
  });
});
