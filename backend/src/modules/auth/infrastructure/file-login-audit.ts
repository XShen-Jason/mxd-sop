import fs from 'node:fs';
import path from 'node:path';
import type { LoginAttemptRecord, LoginAuditSink } from '../domain/login-audit.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ARCHIVES = 4;

/** One process owns the append/rotation sequence, with no await or shared queue.
 * Current file plus four archives occupy at most 25 MiB. Files are private to
 * the service account; rotation never traverses directories or follows links.
 * OS-buffered appends are best-effort evidence, not an authentication transaction.
 */
export class FileLoginAudit implements LoginAuditSink {
  constructor(private readonly file: string, private readonly maxBytes = MAX_BYTES, private readonly archives = ARCHIVES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1024 || !Number.isInteger(archives) || archives < 1 || archives > 20) {
      throw new Error('invalid login audit retention');
    }
  }

  append(record: LoginAttemptRecord) {
    // Escape Unicode line separators too: one submitted value cannot forge
    // another physical log line when inspected with ordinary text tools.
    const line = JSON.stringify(record).replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029') + '\n';
    const bytes = Buffer.byteLength(line);
    if (bytes > this.maxBytes) throw new Error('login audit record exceeds file capacity');
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const current = this.regularFileSize(this.file);
    if (current + bytes > this.maxBytes) this.rotate();
    fs.appendFileSync(this.file, line, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(this.file, 0o600);
  }

  private regularFileSize(file: string): number {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('login audit target is not a regular file');
      return stat.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }

  private rotate() {
    // Validate the exact archive targets before modifying any of them.
    for (let index = 1; index <= this.archives; index++) this.regularFileSize(`${this.file}.${index}`);
    const oldest = `${this.file}.${this.archives}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    for (let index = this.archives - 1; index >= 1; index--) {
      const archive = `${this.file}.${index}`;
      if (fs.existsSync(archive)) fs.renameSync(archive, `${this.file}.${index + 1}`);
    }
    if (fs.existsSync(this.file)) fs.renameSync(this.file, `${this.file}.1`);
  }
}
