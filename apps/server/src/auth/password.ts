import { hash, verify } from '@node-rs/argon2'

/**
 * argon2id at the OWASP-recommended floor: 19 MiB of memory, 2 iterations, one
 * lane. Memory cost is what actually frustrates GPU cracking, so it is the one
 * to raise first if these ever need hardening.
 */
const ARGON2_OPTIONS = {
  /** Argon2id — the hybrid. Also this library's default; set explicitly because it matters. */
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} satisfies Parameters<typeof hash>[1]

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS)
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS)
  } catch {
    // A malformed or truncated stored hash must read as "wrong password"
    // rather than crashing the login route.
    return false
  }
}
