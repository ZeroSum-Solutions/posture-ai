import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://posture-ai.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/dashboard/',
        '/clients/',
        '/assessments/',
        '/workouts/',
        '/settings/',
        '/onboarding/',
        '/consent/',
        '/dev/',
        '/s/', // shared report links — never index
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
