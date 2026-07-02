import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

// Integrity guards for the copied muscle-viewer build (public/muscle-viewer/**) + the manifest
// the adapter/coverage test consume. These run in the normal `vitest run` (CI), so a broken or
// half-done `sync:muscle-viewer` fails the build instead of shipping a blank/stale 3D card.
const GENERATED = 'app/assessments/[id]/muscleIds.generated.json'
const COPIED_MANIFEST = 'public/muscle-viewer/muscle-ids.json'
const COPIED_INDEX = 'public/muscle-viewer/index.html'
const SIBLING_MANIFEST = '../muscle-viewer/dist/muscle-ids.json'

const read = (p: string) => readFileSync(p, 'utf8')

describe('muscle-viewer build integrity', () => {
  it('the adapter manifest matches the copied viewer build (no partial sync)', () => {
    // Both are copied from the same viewer build by `sync:muscle-viewer`; a mismatch means one
    // was updated without the other.
    expect(existsSync(GENERATED) && existsSync(COPIED_MANIFEST)).toBe(true)
    expect(JSON.parse(read(GENERATED))).toEqual(JSON.parse(read(COPIED_MANIFEST)))
  })

  it('the copied build was built with the /muscle-viewer/ base (assets resolve under the sub-path)', () => {
    const html = read(COPIED_INDEX)
    expect(html).toMatch(/\/muscle-viewer\/assets\//)
    // A wrong-base (root) rebuild would emit bare /assets/... which 404s under public/muscle-viewer/.
    expect(html).not.toMatch(/(?:src|href)="\/assets\//)
  })

  it('matches the sibling viewer build when present (source-drift guard, dev only)', () => {
    if (!existsSync(SIBLING_MANIFEST)) return // CI without the sibling repo checked out — skip
    expect(JSON.parse(read(GENERATED))).toEqual(JSON.parse(read(SIBLING_MANIFEST)))
  })
})
