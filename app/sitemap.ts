import type { MetadataRoute } from 'next'

import { isProductionLegalDocumentPublished } from '@/lib/legal/publication'
import { siteOrigin } from '@/lib/site-origin'

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    { url: siteOrigin, changeFrequency: 'monthly', priority: 1 },
  ]
  if (isProductionLegalDocumentPublished('privacy')) {
    entries.push({ url: `${siteOrigin}/privacy`, changeFrequency: 'yearly', priority: 0.3 })
  }
  if (isProductionLegalDocumentPublished('terms')) {
    entries.push({ url: `${siteOrigin}/terms`, changeFrequency: 'yearly', priority: 0.3 })
  }
  return entries
}
