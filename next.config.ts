import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', '@react-pdf/layout', '@react-pdf/pdfkit', '@react-pdf/font', '@react-pdf/fns'],
  transpilePackages: ['@posture-ai/engine'],
  // Playwright drives the dev server via 127.0.0.1; without this Next 16 blocks
  // dev chunks/HMR as cross-origin and pages never hydrate (dev-only setting).
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    const supabaseOrigin = (() => {
      try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin } catch { return '' }
    })()
    const supabaseWs = supabaseOrigin.replace(/^http/, 'ws')
    const csp = [
      "default-src 'self'",
      // unsafe-inline/unsafe-eval: Next.js hydration + dev runtime; wasm-unsafe-eval: MediaPipe
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "font-src 'self' data:",
      `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`.trim(),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
    return [
      {
        source: '/mediapipe/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}
export default nextConfig
