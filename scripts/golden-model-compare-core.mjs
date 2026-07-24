export const TIER_B_RELIABILITY_ONLY_PROTOCOL =
  'tier-b-four-view-repositioned-v2'

/**
 * Tier B v2 measures repeatability and has no anatomical ground truth. Its
 * repeated captures may describe model disagreement, but they cannot decide
 * which model is more accurate or authorize a scoring-default switch.
 */
export function assertModelComparisonEvidence(lite, full, source = 'Tier B pair') {
  const protocols = [lite?.protocolVersion, full?.protocolVersion]
  if (protocols.includes(TIER_B_RELIABILITY_ONLY_PROTOCOL)) {
    throw new Error(
      `${source} uses the reliability-only Tier B v2 protocol and cannot adjudicate a model default`,
    )
  }
  if (
    lite?.studyPurpose === 'repeatability'
    || full?.studyPurpose === 'repeatability'
  ) {
    throw new Error(
      `${source} is repeatability evidence and cannot adjudicate a model default`,
    )
  }
  if (lite?.studyPurpose !== 'accuracy' || full?.studyPurpose !== 'accuracy') {
    throw new Error(
      `${source} lacks the explicit accuracy-study marker required to adjudicate a model default`,
    )
  }
}
