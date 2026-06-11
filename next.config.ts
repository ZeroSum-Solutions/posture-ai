import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', '@react-pdf/layout', '@react-pdf/pdfkit', '@react-pdf/font', '@react-pdf/fns'],
  transpilePackages: ['@posture-ai/engine'],
  // Playwright drives the dev server via 127.0.0.1; without this Next 16 blocks
  // dev chunks/HMR as cross-origin and pages never hydrate (dev-only setting).
  allowedDevOrigins: ['127.0.0.1'],
}
export default nextConfig
