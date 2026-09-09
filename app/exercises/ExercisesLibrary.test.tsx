// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ExercisesLibrary from './ExercisesLibrary'

const approvedInstructions = 'Use the reviewed Posture AI instruction. Keep the full movement description visible so someone can read every setup and movement cue without opening another panel or relying on truncated copy.'
const approved = {
  id: 'split-squat', name: 'Split Squat', category: 'strengthen',
  instructions: approvedInstructions, sets: 3, hold_seconds: 2, poster_url: null,
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
  it('paginates and searches one combined collection beyond the visible page', () => {
    const references = Array.from({ length: 55 }, (_, index) => ({
      ...goblet, id: `reference-${index}`, name: `Movement ${index}`,
    }))
    render(<ExercisesLibrary exercises={[approved]} referenceExercises={references} />)

    expect(screen.getByRole('status').textContent).toBe('Showing 24 of 56 matches')
    expect(screen.queryByText('Movement 54')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more exercises' }))
    expect(screen.getByText('Movement 47')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exercises' }), { target: { value: 'Movement 54' } })
    expect(screen.getByText('Movement 54')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Showing 1 of 1 matches')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exercises' }), { target: { value: 'reviewed posture' } })
    expect(screen.getByText('Split Squat')).toBeTruthy()
  })

  it('renders reviewed and reference records as one collection with visible full instructions', () => {
    render(<ExercisesLibrary exercises={[approved]} referenceExercises={[goblet, walk]} />)

    expect(screen.getByRole('heading', { name: 'Find a movement' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Reviewed Posture AI exercises/i })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Explore exercise instructions/i })).toBeNull()
    expect(screen.getByText(approvedInstructions)).toBeTruthy()
    expect(screen.getByText(goblet.instructions)).toBeTruthy()
    expect(screen.getAllByText('Instructions')).toHaveLength(3)
    expect(screen.getByText('Reviewed Posture AI content')).toBeTruthy()
    expect(screen.getAllByText('Licensed reference · not program reviewed')).toHaveLength(2)
  })

  it('keeps approved provenance distinct and does not forge a manual reference binding', () => {
    render(<ExercisesLibrary exercises={[approved]} referenceExercises={[goblet]} />)

    const approvedCard = screen.getByRole('heading', { name: 'Split Squat' }).closest('article, div')?.parentElement
    expect(approvedCard).not.toBeNull()
    const addButton = within(approvedCard as HTMLElement).getByRole('button', { name: 'Add to workout' })
    expect((addButton as HTMLButtonElement).disabled).toBe(true)
    expect(within(approvedCard as HTMLElement).getByText(/Not yet available in custom workouts/i)).toBeTruthy()
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
  })

  it('searches names and instructions and filters the combined category and equipment fields', () => {
    render(<ExercisesLibrary exercises={[approved]} referenceExercises={[goblet, walk]} />)
    const search = screen.getByRole('searchbox', { name: 'Search exercises' })

    fireEvent.change(search, { target: { value: 'setup and movement cue' } })
    expect(screen.getByText('Split Squat')).toBeTruthy()
    expect(screen.queryByText('Dumbbell Goblet Squat')).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Equipment' }), { target: { value: 'Dumbbell' } })
    expect(screen.getByText('Dumbbell Goblet Squat')).toBeTruthy()
    expect(screen.queryByText('Continuous Walking')).toBeNull()
    expect(screen.queryByText('Split Squat')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Cardio 1/i }))
    expect(screen.getByText(/No exercises match/i)).toBeTruthy()
  })

  it('keeps selected references in order and opens the manual workout editor', () => {
    render(<ExercisesLibrary exercises={[]} referenceExercises={[goblet, walk]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Dumbbell Goblet Squat to workout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Continuous Walking to workout' }))

    expect(screen.getByRole('status', { name: 'Workout selection' }).textContent).toContain('2 exercises selected')
    const link = screen.getByRole('link', { name: 'Continue to workout' })
    expect(link.getAttribute('href')).toBe('/workouts/manual/new?exercise=wger%3Agoblet&exercise=wger%3Awalk')

    fireEvent.click(screen.getByRole('button', { name: 'Remove Dumbbell Goblet Squat from workout' }))
    expect(screen.getByRole('status', { name: 'Workout selection' }).textContent).toContain('1 exercise selected')
    expect(link.getAttribute('href')).toBe('/workouts/manual/new?exercise=wger%3Awalk')
  })

  it('bounds the URL seed while keeping every reference available in the full library', () => {
    const references = Array.from({ length: 25 }, (_, index) => ({
      ...goblet, id: `wger:${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`, name: `Seed movement ${index + 1}`,
    }))
    render(<ExercisesLibrary exercises={[]} referenceExercises={references} />)
    screen.getAllByRole('button', { name: /^Add Seed movement \d+ to workout$/ }).forEach(button => {
      fireEvent.click(button)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show more exercises' }))

    expect((screen.getByRole('button', { name: /^Add Seed movement \d+ to workout$/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status', { name: 'Workout selection' }).textContent).toContain('24 exercises selected')
  })
})
