// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ExerciseDetailSheet from './ExerciseDetailSheet'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ExerciseDetailSheet', () => {
  test('loads clinical detail through the gated same-origin API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      detail: {
        name: 'Wall Angel', category: 'mobility', instructions: 'Move slowly.',
        sets: 2, hold_seconds: null, video_url: null, poster_url: null,
      },
      muscles: [{ muscle_slug: 'lower-trapezius', role: 'strengthen' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    render(<ExerciseDetailSheet slug="wall-angel" name="Wall Angel" onClose={() => {}} />)

    expect(await screen.findByText('Move slowly.')).toBeTruthy()
    expect(screen.getByText(/lower trapezius/i)).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith(
      '/api/clinical-content/exercises/wall-angel',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })
})
