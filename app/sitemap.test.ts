import { describe, expect, it } from 'vitest'

import sitemap from './sitemap'
import { generateMetadata as privacyMetadata } from './privacy/page'
import { generateMetadata as termsMetadata } from './terms/page'

describe('sitemap legal publication boundary', () => {
  it('does not advertise legal fixtures while production documents are unavailable', () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      'https://posture-ai-ivory.vercel.app',
    ])
  })

  it('marks unavailable production legal pages noindex and nofollow', () => {
    expect(privacyMetadata().robots).toEqual({ index: false, follow: false })
    expect(termsMetadata().robots).toEqual({ index: false, follow: false })
  })
})
