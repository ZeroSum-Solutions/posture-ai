import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Posture AI',
    short_name: 'Posture AI',
    description: 'AI-assisted posture and musculoskeletal screening',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0E1420',
    theme_color: '#0E1420',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
