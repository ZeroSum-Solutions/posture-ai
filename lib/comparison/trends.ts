export interface VersionedTrendInput {
  assessmentId: string
  scoringEngineVersion: string | null | undefined
}

export interface TrendSegment {
  id: string
  scoringEngineVersion: string | null
  pointIndexes: number[]
}

export interface SegmentedTrendPoint<T extends VersionedTrendInput> {
  value: T
  segmentId: string
}

function normalizedVersion(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Split chronological history into contiguous scoring-version runs.
 *
 * Unknown-version records each become an isolated segment: two legacy rows do
 * not prove that they used the same engine, so drawing a line between them
 * would imply comparability we do not have.
 */
export function segmentTrendHistory<T extends VersionedTrendInput>(
  history: readonly T[],
): { points: Array<SegmentedTrendPoint<T>>; segments: TrendSegment[] } {
  const points: Array<SegmentedTrendPoint<T>> = []
  const segments: TrendSegment[] = []
  let priorKnownVersion: string | null = null
  let currentSegment: TrendSegment | null = null

  history.forEach((value, index) => {
    const version = normalizedVersion(value.scoringEngineVersion)
    const startsNewSegment = version === null
      || currentSegment === null
      || priorKnownVersion !== version

    if (startsNewSegment) {
      currentSegment = {
        id: `trend-segment-${segments.length + 1}`,
        scoringEngineVersion: version,
        pointIndexes: [],
      }
      segments.push(currentSegment)
    }

    // startsNewSegment guarantees a segment; the guard keeps TypeScript's
    // closure analysis honest without weakening the return type.
    if (currentSegment === null) return
    currentSegment.pointIndexes.push(index)
    points.push({ value, segmentId: currentSegment.id })
    priorKnownVersion = version

    // Never allow the next legacy record to join this unknown segment.
    if (version === null) currentSegment = null
  })

  return { points, segments }
}

export function trendValueForSegment(
  point: Record<string, unknown>,
  segmentId: string,
  metricKey: string,
): number | null {
  if (point.segment_id !== segmentId) return null
  const value = point[metricKey]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
