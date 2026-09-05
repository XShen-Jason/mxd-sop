import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { CatalogError, ItemCatalog, loadCatalogFromCsv, loadCatalogFromJson, loadCatalogImageMap } from '../src/modules/item-catalog/public/index.js';

const requestedMedals = [
  ['01142392', '人级勋章'], ['01142977', '地级勋章'], ['01142504', '天级勋章'],
  ['01143012', '王级勋章'], ['01142867', '皇级勋章'], ['01142744', '仙级勋章'],
  ['01142803', '霸级勋章'], ['01142802', '超越级勋章'], ['01142580', '星耀级勋章'],
  ['01142935', '星辰级勋章'], ['01142577', '行星级勋章'], ['01142578', '银河级勋章'],
  ['01142579', '星云级勋章'], ['01142440', '星河级勋章'], ['01143343', '黑洞级勋章'],
  ['01142908', '混沌级勋章'], ['01143024', '宇宙级勋章'], ['01142949', '终极勋章']
] as const;

describe('item-catalog.search', () => {
  const catalog = new ItemCatalog([
    { code: '02000000', name: '红色药水', itemClass: 'consume' },
    { code: '02000001', name: '红色药水 II', itemClass: 'consume' },
    { code: '00000001', name: '金币' },
    { code: 'A-2', name: '蓝色药水' }
  ]);

  it('matches code or name case-insensitively with stable relevance order', () => {
    expect(catalog.search('药水', 10).items.map((item) => item.code)).toEqual(['02000000', '02000001', 'A-2']);
    expect(catalog.search('0000', 10).items[0].code).toBe('00000001');
  });

  it('bounds query and cursor inputs', () => {
    expect(() => catalog.search('')).toThrowError(CatalogError);
    expect(() => catalog.search('x', 51)).toThrowError(CatalogError);
    expect(() => catalog.search('x', 20, 'bad-cursor')).toThrowError(CatalogError);
  });

  it('lists a complete category with stable cursor pagination', () => {
    const firstPage = catalog.listByClass('consume', 1);
    expect(firstPage).toMatchObject({ items: [{ code: '02000000' }] });
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(catalog.listByClass('consume', 1, firstPage.nextCursor ?? undefined)).toEqual({ items: [{ code: '02000001', name: '红色药水 II', itemClass: 'consume' }], nextCursor: null, totalCount: 2 });
    expect(catalog.listByClass('missing', 10)).toEqual({ items: [], nextCursor: null, totalCount: 0 });
    expect(() => catalog.listByClass('')).toThrowError(CatalogError);
    expect(() => catalog.listByClass('consume', 0)).toThrowError(CatalogError);
  });

  it('loads the supplied UTF-8 CSV while retaining text codes', () => {
    const fromWorkspace = path.resolve(process.cwd(), 'data/item-catalog/source/道具表-9-5.csv');
    const fromBackend = path.resolve(process.cwd(), '..', 'data/item-catalog/source/道具表-9-5.csv');
    const mapFromWorkspace = path.resolve(process.cwd(), 'data/item-catalog/source/item-image-map.json');
    const mapFromBackend = path.resolve(process.cwd(), '..', 'data/item-catalog/source/item-image-map.json');
    const images = loadCatalogImageMap(fs.existsSync(mapFromWorkspace) ? mapFromWorkspace : mapFromBackend);
    const loaded = loadCatalogFromCsv(fs.existsSync(fromWorkspace) ? fromWorkspace : fromBackend, { skipInvalidRows: true, images });
    expect(loaded.lookup('02000000')).toMatchObject({ code: '02000000', name: '红色药水', itemClass: 'consume', image: '/item-images/02000000.png' });
    expect(loaded.lookup('02000000_1')).toMatchObject({ image: '/item-images/02000000.png' });
    expect(typeof loaded.lookup('02000000')?.code).toBe('string');
  });

  it('loads the requested medal titles without duplicate item codes', () => {
    const csvPath = fs.existsSync(path.resolve(process.cwd(), 'data/item-catalog/source/道具表-9-5.csv'))
      ? path.resolve(process.cwd(), 'data/item-catalog/source/道具表-9-5.csv')
      : path.resolve(process.cwd(), '..', 'data/item-catalog/source/道具表-9-5.csv');
    const mapPath = fs.existsSync(path.resolve(process.cwd(), 'data/item-catalog/source/item-image-map.json'))
      ? path.resolve(process.cwd(), 'data/item-catalog/source/item-image-map.json')
      : path.resolve(process.cwd(), '..', 'data/item-catalog/source/item-image-map.json');
    const loaded = loadCatalogFromCsv(csvPath, { skipInvalidRows: true, images: loadCatalogImageMap(mapPath) });
    const csv = fs.readFileSync(csvPath, 'utf8');
    for (const [code, name] of requestedMedals) {
      expect(loaded.lookup(code)).toMatchObject({ code, name, itemClass: 'title' });
      expect(csv.match(new RegExp(`"${code}"`, 'gu'))).toHaveLength(1);
      if (code !== '01142580') expect(loaded.lookup(code)?.image).toBe(`/item-images/${code}.png`);
    }
    expect(loaded.lookup('01142580')?.image).toBeUndefined();
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
