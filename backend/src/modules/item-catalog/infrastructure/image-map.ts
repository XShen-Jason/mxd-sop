import fs from 'node:fs';
import path from 'node:path';
import { CatalogError } from '../domain/catalog.js';

interface ImageMapDocument {
  version?: unknown;
  images?: unknown;
}

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

export function imageUrl(value: unknown) {
  const filename = path.basename(text(value));
  return /^[A-Za-z0-9._-]+\.png$/iu.test(filename) ? `/item-images/${filename}` : undefined;
}

export function loadCatalogImageMap(filePath: string): ReadonlyMap<string, string> {
  if (!fs.existsSync(filePath)) throw new CatalogError('catalog-unavailable', `catalog image map not found: ${filePath}`);
  let parsed: ImageMapDocument;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ImageMapDocument;
  } catch {
    throw new CatalogError('catalog-unavailable', 'catalog image map could not be parsed');
  }
  if (parsed.version !== 1 || !parsed.images || typeof parsed.images !== 'object' || Array.isArray(parsed.images)) {
    throw new CatalogError('catalog-unavailable', 'catalog image map is invalid');
  }

  const images = new Map<string, string>();
  for (const [rawCode, rawFilename] of Object.entries(parsed.images as Record<string, unknown>)) {
    const code = rawCode.trim();
    const image = imageUrl(rawFilename);
    if (!code || code !== rawCode || /[\s@]/u.test(code) || !image) {
      throw new CatalogError('catalog-unavailable', 'catalog image map is invalid');
    }
    images.set(code, image);
  }
  return images;
}
