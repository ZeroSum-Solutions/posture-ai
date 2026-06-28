const DEFAULT_NEXT = '/dashboard'

/**
 * Sanitizes a post-auth `next` redirect target. Only same-origin absolute
 * paths are allowed; anything that could escape the origin (protocol-relative
 * `//host`, backslash tricks, absolute URLs, or non-paths) falls back to the
 * dashboard. Prevents the auth callback from becoming an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== 'string' || next.length === 0) return DEFAULT_NEXT
  if (!next.startsWith('/')) return DEFAULT_NEXT
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_NEXT
  return next
}
