import { describe, it, expect } from 'vitest'
import { IMBALANCE_COPY, BILATERAL_KNEE_COPY } from './imbalance-copy'
import { BANNED_TERM_PATTERNS } from '../muscles/types'

// Elevates the dev-only guard in imbalance-copy.ts to a CI-enforced test: the
// client-facing report copy must stay within screening vocabulary (no diagnostic
// / treatment terms). This is the "vocabulary lint at build time" for the copy
// layer that drives what the report says about a person's body.
describe('imbalance report copy vocabulary lint', () => {
  const entries: [string, typeof BILATERAL_KNEE_COPY][] = [
    ...Object.entries(IMBALANCE_COPY),
    ['bilateral_knee', BILATERAL_KNEE_COPY],
  ]
  for (const [key, c] of entries) {
    it(`"${key}" uses screening-safe vocabulary`, () => {
      const text = `${c.plainLabel} ${c.whatItMeans} ${c.whatItCanFeel} ${c.whatBetterLooksLike} ${c.reassurance}`
      for (const pattern of BANNED_TERM_PATTERNS) {
        expect(text, `banned term ${pattern} in "${c.plainLabel}"`).not.toMatch(pattern)
      }
    })
  }
})
