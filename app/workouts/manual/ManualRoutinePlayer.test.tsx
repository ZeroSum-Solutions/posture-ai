// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ManualRoutinePlayer from './ManualRoutinePlayer'

const display = {
  first: {
    name: 'Dumbbell Romanian Deadlift', instructions: 'Hinge at the hips with one dumbbell in each hand.', equipment: ['Dumbbell'], media: null,
    source: { recordUrl: 'https://wger.de/api/v2/exerciseinfo/1652/', author: 'AlucardEvil40', license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } },
  },
  second: {
    name: 'Continuous Walking', instructions: 'Walk continuously for the chosen duration.', equipment: [], media: null,
    source: { recordUrl: 'https://wger.de/api/v2/exerciseinfo/1104/', author: 'Source author', license: { shortName: 'CC-BY-SA 3', url: 'https://creativecommons.org/licenses/by-sa/3.0/deed.en' } },
  },
}
const routine = {
  routineId: '54000000-0000-4000-8000-000000000004', subjectId: '54000000-0000-4000-8000-000000000003', title: 'My own routine', revision: 1, status: 'active' as const,
  source: { kind: 'manual_reference' as const, snapshotIds: ['wger-english-2026-09-08'], reviewStatus: 'reference_unreviewed' as const, screeningInfluence: 'none' as const },
  items: [
    { itemId: '54000000-0000-4000-8000-000000000001', referenceExerciseId: 'wger:d561c00c-436d-47d9-b647-222e7b637abd', kind: 'strength' as const, sets: 3, reps: 8, load: { value: '12.50', unit: 'kg' as const }, restSeconds: 90, exerciseDisplay: display.first },
    { itemId: '54000000-0000-4000-8000-000000000002', referenceExerciseId: 'wger:49650b14-9b3e-4d48-a43e-f8084970632a', kind: 'conditioning' as const, durationSeconds: 900, exerciseDisplay: display.second },
  ],
  updatedAt: '2026-09-08T00:00:00Z', archivedAt: null,
}

afterEach(cleanup)

describe('ManualRoutinePlayer', () => {
  it('shows exact user-entered targets and advances through attributed reference instructions', () => {
    render(<ManualRoutinePlayer routine={routine} />)

    expect(screen.getByText('3 sets × 8 reps · 12.50 kg')).toBeTruthy()
    expect(screen.getByText('Rest 90 seconds')).toBeTruthy()
    expect(screen.getByText(display.first.instructions)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next exercise' }))
    expect(screen.getByText('15 minutes')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Source for Continuous Walking' }).getAttribute('href')).toBe(display.second.source.recordUrl)
    fireEvent.click(screen.getByRole('button', { name: 'Finish viewing routine' }))
    expect(screen.getByRole('status').textContent).toContain('No workout completion was recorded')
  })

  it('keeps instructions usable after an image failure and shows the next exercise image', () => {
    const media = {
      kind: 'image' as const, posterUrl: '/training/reference/first.webp', alt: 'First exercise demonstration', width: 640, height: 480,
      source: { assetUrl: 'https://wger.de/media/first.webp', author: 'Source author', license: display.first.source.license, modifications: 'none' as const },
    }
    const withImages = {
      title: routine.title,
      items: routine.items.map((item, index) => ({ ...item, exerciseDisplay: {
        ...item.exerciseDisplay, media: { ...media, posterUrl: `/training/reference/${index}.webp`, alt: `Exercise ${index} demonstration` },
      } })),
    }
    render(<ManualRoutinePlayer routine={withImages} />)
    fireEvent.error(screen.getByRole('img', { name: 'Exercise 0 demonstration' }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Image unavailable')
    expect(screen.getByText(display.first.instructions)).toBeTruthy()
    expect(screen.getByRole('link', { name: `Source for ${display.first.name}` })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next exercise' }))
    expect(screen.getByRole('img', { name: 'Exercise 1 demonstration' })).toBeTruthy()
    expect(screen.queryByText(/Image unavailable/)).toBeNull()
  })

  it('states that the routine is manual and does not imply scan or progression authority', () => {
    render(<ManualRoutinePlayer routine={routine} />)
    expect(screen.getByText(/targets were entered manually/i)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/recommended|prescribed|progressed|scan-based/i)
  })
})
