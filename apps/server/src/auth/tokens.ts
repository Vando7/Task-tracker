import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * 32 bytes from the CSPRNG, base64url encoded.
 *
 * Used for both session ids and the tokens in verification/reset emails. 256
 * bits of entropy means guessing is not an attack surface worth thinking about.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Email tokens are stored as a SHA-256 digest, never in plaintext, so a leaked
 * database does not hand out working password-reset links. A single round is
 * correct here: the input is already high-entropy random, so there is nothing
 * for a slow KDF to protect against.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison, for anything derived from user input. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}
