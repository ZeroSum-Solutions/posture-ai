import { randomBytes, createHash } from 'node:crypto'

/**
 * Share-token minting for the workout player's client link. The link is a
 * PHI-access surface, so (unlike the consent link's raw randomUUID) the raw
 * token is 256-bit CSPRNG and is NEVER persisted — only its SHA-256 hash goes
 * into workout_sessions.session_token_hash. Lookups hash the presented token and
 * compare, so a DB read alone can't forge a working link.
 */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashShareToken(token) }
}
