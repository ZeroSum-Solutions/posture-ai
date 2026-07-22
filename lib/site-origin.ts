const PRODUCTION_SITE_FALLBACK = 'https://posture-ai-ivory.vercel.app'

export function resolveSiteOrigin(raw = process.env.NEXT_PUBLIC_SITE_URL): string {
  const candidate = raw?.trim() || PRODUCTION_SITE_FALLBACK
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('NEXT_PUBLIC_SITE_URL must be an absolute URL')
  }
  const localHttp = parsed.protocol === 'http:'
    && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('NEXT_PUBLIC_SITE_URL must use HTTPS outside local development')
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('NEXT_PUBLIC_SITE_URL must contain only an origin')
  }
  return parsed.origin
}

export const siteOrigin = resolveSiteOrigin()
