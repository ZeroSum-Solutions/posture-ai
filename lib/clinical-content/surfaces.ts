import type { ClinicalContentAccess } from './policy'

/**
 * The full clinical experience (assessment detail, overrides, projection) is
 * all-or-nothing: readers and writers must gate on the SAME predicate, or a
 * partial release lets one side act on state the other refuses to show.
 *
 * Lives outside policy.ts deliberately: this is presentation-layer gating over
 * an already-resolved access object, and policy.ts is a governed algorithm
 * source whose bytes are hash-pinned by the release inventory.
 */
export function hasCompleteClinicalSurfaces(access: ClinicalContentAccess): boolean {
  return (
    access.surfaces.recommendations &&
    access.surfaces.programs &&
    access.surfaces.workouts &&
    access.surfaces.knowledgeLinks
  )
}
