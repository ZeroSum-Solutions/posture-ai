type ApplicationCspInput = {
  nonce: string
  nodeEnv?: string
  supabaseUrl?: string
}

function configuredOrigin(url: string | undefined): string {
  try {
    return new URL(url ?? '').origin
  } catch {
    return ''
  }
}

function sources(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

/**
 * Per-request CSP for the Next application. The root layout is force-dynamic,
 * so Next can copy this nonce onto its framework and hydration scripts.
 */
export function buildApplicationCsp({ nonce, nodeEnv, supabaseUrl }: ApplicationCspInput): string {
  const supabaseOrigin = configuredOrigin(supabaseUrl)
  const supabaseWs = supabaseOrigin.replace(/^http/, 'ws')
  const scriptSources = sources(
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "'wasm-unsafe-eval'",
    nodeEnv === 'development' ? "'unsafe-eval'" : undefined,
  )

  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    // Server-rendered Next style elements receive the request nonce. React
    // style attributes remain allowed separately without weakening scripts.
    `style-src 'self' 'nonce-${nonce}'`,
    // Next/React can also insert framework-managed style elements during a
    // client transition without propagating the request nonce. Scope the
    // compatibility allowance to style elements; script-src remains nonce-only.
    "style-src-elem 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    `img-src ${sources("'self'", 'data:', 'blob:', supabaseOrigin)}`,
    `media-src ${sources("'self'", 'blob:', supabaseOrigin)}`,
    "worker-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src ${sources("'self'", supabaseOrigin, supabaseWs)}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}
