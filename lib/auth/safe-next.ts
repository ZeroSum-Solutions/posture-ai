const DEFAULT_NEXT = '/dashboard'

/**
 * Sanitizes a post-auth `next` redirect target. Only same-origin absolute
 * paths are allowed; anything that could escape the origin (protocol-relative
 * `//host`, backslash tricks, absolute URLs, or non-paths) falls back to the
 * dashboard. Prevents the auth callback from becoming an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (typeof next !== 'string' || next.length === 0) return DEFAULT_NEXT
  let decoded: string
  try {
    decoded = decodeURIComponent(next)
  } catch {
    return DEFAULT_NEXT
  }
  for (const path of [next, decoded]) {
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return DEFAULT_NEXT
    for (const character of path) {
      const code = character.charCodeAt(0)
      if (code <= 0x1f || code === 0x7f || character === '\\') return DEFAULT_NEXT
    }
  }
  return next
}

/** Hard navigation lets the next request read the refreshed auth cookies. */
export function hardNavigate(path: string): void {
  window.location.assign(safeNextPath(path))
}
