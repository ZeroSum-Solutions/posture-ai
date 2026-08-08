import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', '@react-pdf/layout', '@react-pdf/pdfkit', '@react-pdf/font', '@react-pdf/fns'],
  transpilePackages: ['@posture-ai/engine'],
  // Playwright drives the dev server via 127.0.0.1; without this Next 16 blocks
  // dev chunks/HMR as cross-origin and pages never hydrate (dev-only setting).
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    // Self-contained CSP for the embedded muscle-viewer (public/muscle-viewer/**). It must
    // NOT inherit the application's nonce CSP from proxy.ts, whose
    // `frame-ancestors 'none'` would blank the same-origin iframe on the results page.
    // Vite emits external module scripts only (no inline, no eval).
    const viewerCsp = [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "connect-src 'self'",
      "frame-ancestors 'self'", // allow the same-origin results page to frame it
      "base-uri 'self'",
      "object-src 'none'",
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
      // Security headers for the viewer sub-app (CSP/HSTS/nosniff only — cache lives in the
      // three specific blocks below so no header key is ever written by two matching rules).
      {
        source: '/muscle-viewer/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: viewerCsp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      // Cache: hashed assets are safe to pin forever; the unversioned entry + model must revalidate.
      {
        source: '/muscle-viewer/assets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/muscle-viewer/index.html',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/muscle-viewer/model.glb',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
      {
        // Everything EXCEPT the viewer sub-app. The application's per-request CSP is added
        // by proxy.ts; these static headers remain safe to configure globally.
        // Segment-anchored ((?:/|$)) so a phantom path like /muscle-viewerX is NOT excluded and
        // still receives the global security headers.
        source: '/((?!muscle-viewer(?:/|$)).*)',
        headers: [
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
