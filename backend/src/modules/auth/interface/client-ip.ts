import { isIP } from 'node:net';

/** Canonicalize Fastify's trusted client IP, including IPv4-mapped IPv6 peers. */
export function loginIp(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  // URL canonicalization compresses equivalent IPv6 spellings. Zone identifiers
  // identify a local interface, not a distinct remote client address.
  const canonical = new URL(`http://[${ip.split('%')[0]}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/u.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
