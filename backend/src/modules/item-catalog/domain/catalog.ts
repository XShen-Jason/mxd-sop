export interface CatalogItem {
  code: string;
  name: string;
  itemClass?: string;
  image?: string;
}

export class CatalogError extends Error {
  constructor(public readonly code: 'catalog-unavailable' | 'invalid-query' | 'invalid-cursor', message: string = code) {
    super(message);
    this.name = 'CatalogError';
  }
}

export interface CatalogSearchResult {
  items: CatalogItem[];
  nextCursor: string | null;
}

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset, version: 1 }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown; version?: unknown };
    if (parsed.version !== 1 || !Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) throw new Error();
    return parsed.offset as number;
  } catch {
    throw new CatalogError('invalid-cursor');
  }
}

function compareCode(a: string, b: string) {
  return a === b ? 0 : a < b ? -1 : 1;
}

export class ItemCatalog {
  private readonly byCode: Map<string, CatalogItem>;
  private readonly items: CatalogItem[];

  constructor(items: CatalogItem[]) {
    const deduped = new Map<string, CatalogItem>();
    for (const item of items) {
      if (!item || typeof item !== 'object') throw new CatalogError('catalog-unavailable', 'invalid catalog row');
      const code = typeof item.code === 'string' ? item.code.trim() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!code || !name || item.code !== code || /[\s@]/u.test(code) || deduped.has(code)) throw new CatalogError('catalog-unavailable', 'invalid catalog row');
      const itemClass = typeof item.itemClass === 'string' ? item.itemClass.trim() : undefined;
      const image = typeof item.image === 'string' ? item.image.trim() : undefined;
      deduped.set(code, { code, name, itemClass: itemClass || undefined, image: image || undefined });
    }
    this.byCode = deduped;
    this.items = [...deduped.values()].sort((a, b) => compareCode(a.code, b.code));
  }

  lookup(code: string) {
    const item = this.byCode.get(code);
    return item ? { ...item } : undefined;
  }

  get size() {
    return this.items.length;
  }

  search(query: string, limit = 20, cursor?: string): CatalogSearchResult {
    if (typeof query !== 'string' || query.trim().length < 1 || query.length > 64) throw new CatalogError('invalid-query');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new CatalogError('invalid-query');
    const normalized = query.trim().toLocaleLowerCase();
    const matches = this.items
      .filter((item) => item.code.toLocaleLowerCase().includes(normalized) || item.name.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => {
        const rank = (item: CatalogItem) => (item.code.toLocaleLowerCase().startsWith(normalized) || item.name.toLocaleLowerCase().startsWith(normalized) ? 0 : 1);
        return rank(a) - rank(b) || compareCode(a.code, b.code);
      });
    const offset = decodeCursor(cursor);
    const page = matches.slice(offset, offset + limit);
    return { items: page.map((item) => ({ ...item })), nextCursor: offset + page.length < matches.length ? encodeCursor(offset + page.length) : null };
  }

  searchItems(query: string, limit = 20, cursor?: string) {
    return this.search(query, limit, cursor);
  }
}
