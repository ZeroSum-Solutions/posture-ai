/**
 * Revoke every blob object URL in `urls` that isn't being reused (present in
 * `keep`). Non-blob URLs (e.g. `data:`/`http:` uploads) and nullish entries are
 * left untouched. Used when a capture slot is replaced so the superseded burst's
 * object URLs don't leak, without ever revoking a URL the replacement still holds.
 */
export function revokeStaleUrls(urls: (string | null | undefined)[], keep: Set<string>): void {
  for (const u of urls) {
    if (u && !keep.has(u) && u.startsWith('blob:')) URL.revokeObjectURL(u)
  }
}
