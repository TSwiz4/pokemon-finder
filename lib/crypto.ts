// Password hashing + token generation using Node's built-in crypto (no deps).
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

// Returns "salt:hash" (both hex). scrypt is deliberately slow → resists brute force.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = scryptSync(password, salt, 64);
  return hashBuf.length === testBuf.length && timingSafeEqual(hashBuf, testBuf);
}

// 256-bit random session token, hex-encoded.
export function randomToken(): string {
  return randomBytes(32).toString('hex');
}
