import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/** Loads the nearest project .env without overriding explicitly exported vars. */
export function loadEnvironment(start = process.cwd()) {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}
