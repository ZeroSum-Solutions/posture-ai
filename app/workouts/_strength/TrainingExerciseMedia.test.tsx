// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrainingExerciseMedia from './TrainingExerciseMedia'

const binding = { catalogVersion: 'catalog.v1', catalogOrigin: { kind: 'authored_catalog' as const }, exerciseVersionId: 'squat.v1' }
function media() {
  return {
    schemaVersion: 'training-launch-media-projection.v1', status: 'available', binding,
    review: { kind: 'qualified_exact_variant', reviewRecordId: 'review.v1', reviewedAt: '2026-09-01T00:00:00Z' },
    source: { rightsRecordId: 'rights.v1', provider: 'Test provider', assetId: 'squat.v1', sourcePageUrl: 'https://example.test/source', author: 'Test author', license: { identifier: 'CC-BY-4.0', name: 'CC BY 4.0', url: 'https://example.test/license' } },
    assets: { video: { path: '/media/squat.mp4', mimeType: 'video/mp4', width: 640, height: 480 }, poster: { path: '/media/squat.webp', alt: 'Squat setup', width: 640, height: 480 } },
    expiresAt: null as string | null,
  }
}
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('TrainingExerciseMedia', () => {
  it('keeps instructions and attribution beside manual video controls', () => {
    const { container } = render(<TrainingExerciseMedia binding={binding} media={media()} instruction="Keep the whole foot grounded." />)
    const video = container.querySelector('video')!
    expect(video.controls).toBe(true)
    expect(video.autoplay).toBe(false)
    expect(video.preload).toBe('none')
    expect(screen.getByText('Keep the whole foot grounded.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Test author' }).getAttribute('href')).toBe('https://example.test/source')
  })
  it('falls back from a failed video to its poster then written instructions', () => {
    const { container } = render(<TrainingExerciseMedia binding={binding} media={media()} instruction="Written instruction" />)
    fireEvent.error(container.querySelector('video')!)
    fireEvent.error(screen.getByRole('img', { name: 'Squat setup' }))
    expect(container.querySelector('video')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Written instruction')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/could not load/i)
  })
  it('rejects the wrong variant and malformed media before assigning any asset URL', () => {
    const view = render(<TrainingExerciseMedia binding={{ ...binding, exerciseVersionId: 'row.v1' }} media={media()} instruction="Row instruction" />)
    expect(view.container.querySelector('video,img')).toBeNull()
    const invalid = media(); invalid.assets.video.path = '//elsewhere.test/movie.mp4'
    view.rerender(<TrainingExerciseMedia binding={binding} media={invalid} instruction="Squat instruction" />)
    expect(view.container.querySelector('video,img')).toBeNull()
  })
  it('removes expired media while open and retains instructions', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    const projection = media(); projection.expiresAt = '2026-09-09T00:00:01Z'
    const { container } = render(<TrainingExerciseMedia binding={binding} media={projection} instruction="Still available" />)
    expect(container.querySelector('video')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(container.querySelector('video,img')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/expired/i)
    expect(screen.getByText('Still available')).toBeTruthy()
  })
  it('resets failures when the exact source changes', () => {
    const view = render(<TrainingExerciseMedia binding={binding} media={media()} instruction="Instruction" />)
    fireEvent.error(view.container.querySelector('video')!)
    const next = media(); next.assets.video.path = '/media/squat-new.mp4'
    view.rerender(<TrainingExerciseMedia binding={binding} media={next} instruction="Instruction" />)
    expect(view.container.querySelector('video')?.getAttribute('src')).toBe('/media/squat-new.mp4')
  })
  it('never exposes an already expired asset and provides a missing-media state', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    const projection = media(); projection.expiresAt = '2026-09-08T00:00:00Z'
    const view = render(<TrainingExerciseMedia binding={binding} media={projection} instruction="Instruction" />)
    expect(view.container.querySelector('video,img')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/expired/i)
    view.rerender(<TrainingExerciseMedia binding={binding} instruction="Instruction" />)
    expect(screen.getByRole('status').textContent).toMatch(/not available/i)
  })
  it('rechecks expiry when a suspended page resumes without a timer tick', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    const projection = media(); projection.expiresAt = '2026-09-09T00:01:00Z'
    const view = render(<TrainingExerciseMedia binding={binding} media={projection} instruction="Instruction" />)
    act(() => {
      vi.setSystemTime(new Date('2026-09-09T00:02:00Z'))
      window.dispatchEvent(new Event('pageshow'))
    })
    expect(view.container.querySelector('video,img')).toBeNull()
  })
})
