export const TIER_B_RELIABILITY_ONLY_PROTOCOL =
  'tier-b-four-view-repositioned-v2'

function plainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateGroundTruth(value, source) {
  if (!plainRecord(value)) {
    throw new Error(`${source} groundTruth must be a plain object`)
  }
  const keys = Object.keys(value).sort()
  if (keys.length === 0) {
    throw new Error(`${source} groundTruth must contain at least one measured metric`)
  }
  const normalized = Object.create(null)
  for (const key of keys) {
    if (key.trim().length === 0) {
      throw new Error(`${source} groundTruth metric keys must be non-empty`)
    }
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      throw new Error(`${source} groundTruth values must be finite numbers`)
    }
    normalized[key] = value[key]
  }
  return normalized
}

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
  if (
    protocols.some((protocol) =>
      typeof protocol !== 'string' || protocol.trim().length === 0)
    || protocols[0] !== protocols[1]
  ) {
    throw new Error(
      `${source} must use one matching, non-empty accuracy protocolVersion`,
    )
  }
  const liteGroundTruth = validateGroundTruth(
    lite?.groundTruth,
    `${source} lite`,
  )
  const fullGroundTruth = validateGroundTruth(
    full?.groundTruth,
    `${source} full`,
  )
  const liteKeys = Object.keys(liteGroundTruth)
  const fullKeys = Object.keys(fullGroundTruth)
  if (
    liteKeys.length !== fullKeys.length
    || liteKeys.some((key, index) => key !== fullKeys[index])
  ) {
    throw new Error(
      `${source} lite/full groundTruth must have the same exact metric key set`,
    )
  }
  for (const key of liteKeys) {
    if (liteGroundTruth[key] !== fullGroundTruth[key]) {
      throw new Error(
        `${source} lite/full groundTruth must have identical measured values for ${key}`,
      )
    }
  }
  return liteGroundTruth
}

/**
 * Build accuracy-grounded rows only. A finding without a measured reference,
 * or a measured reference without both model findings, is never silently
 * dropped or allowed to influence a model-default recommendation.
 */
export function buildAccuracyRows(
  name,
  liteFindings,
  fullFindings,
  groundTruth,
) {
  const measured = validateGroundTruth(groundTruth, `${name} paired`)
  if (!Array.isArray(liteFindings) || !Array.isArray(fullFindings)) {
    throw new Error(`${name} model findings must both be arrays`)
  }

  const findingsByKey = (findings, model) => {
    const byKey = new Map()
    for (const finding of findings) {
      const key = finding?.key
      if (typeof key !== 'string' || key.trim().length === 0) continue
      if (byKey.has(key)) {
        throw new Error(`${name} ${model} findings contain duplicate metric ${key}`)
      }
      byKey.set(key, finding)
    }
    return byKey
  }
  const liteByKey = findingsByKey(liteFindings, 'lite')
  const fullByKey = findingsByKey(fullFindings, 'full')

  return Object.entries(measured).map(([key, truth]) => {
    const liteFinding = liteByKey.get(key)
    const fullFinding = fullByKey.get(key)
    if (!liteFinding || !fullFinding) {
      throw new Error(
        `${name} measured metric ${key} is missing from one or both model outputs`,
      )
    }
    if (
      typeof liteFinding.deviation !== 'number'
      || !Number.isFinite(liteFinding.deviation)
      || typeof fullFinding.deviation !== 'number'
      || !Number.isFinite(fullFinding.deviation)
    ) {
      throw new Error(`${name} model deviations for ${key} must be finite numbers`)
    }
    return {
      name,
      key,
      liteDev: liteFinding.deviation,
      fullDev: fullFinding.deviation,
      delta: Math.abs(liteFinding.deviation - fullFinding.deviation),
      liteErr: Math.abs(liteFinding.deviation - truth),
      fullErr: Math.abs(fullFinding.deviation - truth),
    }
  })
}
