'use client'

import { useState, type CSSProperties } from 'react'

/**
 * Selection-thumb travel for SegmentedControl and Tabs. The thumb is placed
 * by CSS from `--seg-index` / `--seg-count` (no layout reads); this hook only
 * remembers where it came from so the thumb can stretch toward the direction
 * of travel. `data-travel` alternates a/b so the CSS stretch keyframe restarts
 * on every move; it is absent until the first move (no animation on mount).
 */
export function useThumbTravel(activeIndex: number, count: number) {
  const [travel, setTravel] = useState({ index: activeIndex, from: activeIndex, n: 0 })
  if (travel.index !== activeIndex) {
    setTravel({ index: activeIndex, from: travel.index, n: travel.n + 1 })
  }
  const distance = Math.abs(activeIndex - travel.from)
  return {
    style: {
      '--seg-count': count,
      '--seg-index': activeIndex,
      '--seg-distance': distance,
    } as CSSProperties,
    thumbProps: {
      'data-travel': travel.n === 0 ? undefined : travel.n % 2 === 0 ? 'a' : 'b',
      'data-dir': activeIndex >= travel.from ? 'right' : 'left',
    },
  }
}
