import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', '@react-pdf/layout', '@react-pdf/pdfkit', '@react-pdf/font', '@react-pdf/fns'],
}
export default nextConfig
