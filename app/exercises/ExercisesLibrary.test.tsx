// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ExercisesLibrary from './ExercisesLibrary'

const approved = {
  id: 'split-squat', name: 'Split Squat', category: 'strengthen',
  instructions: 'Use the reviewed Posture AI instruction.', sets: 3, hold_seconds: 2, poster_url: null,
}
const goblet = {
  id: 'wger:goblet', name: 'Dumbbell Goblet Squat', category: 'legs', equipment: ['Dumbbell'],
  primaryMuscles: ['Quads'], instructions: 'Hold one dumbbell at chest height and complete the source-described movement with control.',
  media: null,
  source: { recordUrl: 'https://wger.de/api/v2/exerciseinfo/203/', author: 'Source author', license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' } },
}
const walk = {
  id: 'wger:walk', name: 'Continuous Walking', category: 'cardio', equipment: ['none (bodyweight exercise)'],
  primaryMuscles: [], instructions: 'Walk continuously at the source-described pace for the chosen duration on a suitable route.',
  media: null,
  source: { recordUrl: 'https://wger.de/api/v2/exerciseinfo/1104/', author: 'Source author', license: { shortName: 'CC-BY-SA 3', url: 'https://creativecommons.org/licenses/by-sa/3.0/deed.en' } },
}

afterEach(cleanup)

describe('exercise library', () => {
  it('loads more entries and searches beyond the visible page', () => {
    const references = Array.from({ length: 55 }, (_, index) => ({
      ...goblet, id: `reference-${index}`, name: `Movement ${index}`,
    }))
    render(<ExercisesLibrary exercises={[]} referenceExercises={references} />)
    expect(screen.getByRole('status').textContent).toBe('Showing 24 of 55 matches')
    expect(screen.queryByText('Movement 54')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more exercises' }))
    expect(screen.getByText('Movement 47')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Movement 54' } })
    expect(screen.getByText('Movement 54')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Showing 1 of 1 matches')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    expect(screen.getByRole('status').textContent).toBe('Showing 24 of 55 matches')
  })

  it('preserves reviewed content while labeling attributable reference instructions', () => {
    render(<ExercisesLibrary exercises={[approved]} referenceExercises={[goblet, walk]} />)

    expect(screen.getByText('Split Squat')).toBeTruthy()
    expect(screen.getByText('Dumbbell Goblet Squat')).toBeTruthy()
    expect(screen.getAllByText(/Reference · unreviewed/i)).toHaveLength(2)
    expect(screen.getByRole('link', { name: /wger source for dumbbell goblet squat/i }).getAttribute('href'))
      .toBe('https://wger.de/api/v2/exerciseinfo/203/')
    expect(screen.getByRole('link', { name: /CC-BY-SA 4 license/i }).getAttribute('href'))
      .toBe('https://creativecommons.org/licenses/by-sa/4.0/deed.en')
  })

  it('shows the allowlisted RDL image with descriptive alt text and adjacent attribution', () => {
    const rdl = {
      ...goblet,
      id: 'wger:65d12ecf-54b8-466d-a412-e55c396cad69',
      name: 'Dumbbell Romanian Deadlift',
      media: {
        kind: 'image' as const,
        posterUrl: '/training/reference/wger-1652-dumbbell-romanian-deadlift.webp',
        alt: 'Two views of a person holding one dumbbell in each hand: standing upright and hinging forward at the hips.',
        width: 1200,
        height: 630,
        source: {
          assetUrl: 'https://wger.de/media/exercise-images/1652/0306c8c0-70cc-45d4-92de-6fa72ceaa834.webp',
          author: 'AlucardEvil40',
          license: { shortName: 'CC-BY-SA 4', url: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en' },
          modifications: 'none' as const,
        },
      },
    }
    render(<ExercisesLibrary exercises={[]} referenceExercises={[rdl]} />)

    const image = screen.getByRole('img', { name: /two views of a person holding one dumbbell in each hand/i })
    const renderedSource = image.getAttribute('src')
    expect(renderedSource).not.toBeNull()
    expect(new URL(renderedSource!, 'http://localhost').searchParams.get('url'))
      .toBe('/training/reference/wger-1652-dumbbell-romanian-deadlift.webp')
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('width')).toBe('1200')
    expect(image.getAttribute('height')).toBe('630')
    expect(screen.getByText(/Image by AlucardEvil40 via/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /wger image source for dumbbell romanian deadlift/i }).getAttribute('href'))
      .toBe('https://wger.de/media/exercise-images/1652/0306c8c0-70cc-45d4-92de-6fa72ceaa834.webp')
    expect(screen.getByRole('link', { name: /CC-BY-SA 4 image license/i }).getAttribute('href'))
      .toBe('https://creativecommons.org/licenses/by-sa/4.0/deed.en')
    expect(screen.getByText(/unmodified/i)).toBeTruthy()
    expect(screen.getByText('Reference · unreviewed')).toBeTruthy()
  })

  it('searches reference names and filters category and equipment', () => {
    render(<ExercisesLibrary exercises={[approved]} referenceExercises={[goblet, walk]} />)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reference exercises' }), {
      target: { value: 'goblet' },
    })
    expect(screen.getByText('Dumbbell Goblet Squat')).toBeTruthy()
    expect(screen.queryByText('Continuous Walking')).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reference exercises' }), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Equipment' }), {
      target: { value: 'Dumbbell' },
    })
    expect(screen.getByText('Dumbbell Goblet Squat')).toBeTruthy()
    expect(screen.queryByText('Continuous Walking')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Cardio 1/i }))
    expect(screen.queryByText('Dumbbell Goblet Squat')).toBeNull()
    expect(screen.queryByText('Continuous Walking')).toBeNull()
    expect(screen.getByText(/No reference exercises match/i)).toBeTruthy()
  })
})
