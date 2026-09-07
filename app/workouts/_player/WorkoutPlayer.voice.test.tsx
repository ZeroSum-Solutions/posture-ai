// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkoutPlayer } from './WorkoutPlayer'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
vi.mock('framer-motion', () => ({ AnimatePresence: ({ children }: { children?: ReactNode }) => children, motion: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> }, useReducedMotion: () => true }))
const snapshot: SessionSnapshot = { version: 1, week: 1, capability: 'standard', priorities: [], disclaimer: 'Prototype session.', estimatedDurationSec: 30, items: [{ index: 0, slug: 'wall-slide', baseSlug: 'wall-slide', name: 'Wall slide', category: 'mobility', stepLabel: 'Loosen', priorityKey: 'shoulders', priorityLabel: 'Shoulder mobility', isIntegrative: false, instructions: 'Move slowly.', timing: { kind: 'reps', sets: 1, repsPerSet: 5, restSeconds: 0 } }] }
const audio = vi.fn(function () { return document.createElement('audio') })
const speak = vi.fn()
beforeEach(() => {
  audio.mockClear(); speak.mockClear()
  vi.stubGlobal('Audio', audio)
  vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() })
  vi.stubGlobal('SpeechSynthesisUtterance', class { rate = 1; constructor(public text: string) {} })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('uses browser speech without fetching gated recordings in the demo', async () => {
  render(<WorkoutPlayer snapshot={snapshot} allowNotes={false} voiceMode="browser" submitRating={async () => ({ ok: true })} />)
  expect(speak).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('red-flag-no'))
  fireEvent.click(await screen.findByRole('button', { name: 'Begin session' }))
  expect(speak).toHaveBeenCalled()
  expect(audio).not.toHaveBeenCalled()
})
it('preserves recorded audio as the default for existing practitioner players', async () => {
  render(<WorkoutPlayer snapshot={snapshot} allowNotes={false} submitRating={async () => ({ ok: true })} />)
  fireEvent.click(screen.getByTestId('red-flag-no'))
  fireEvent.click(await screen.findByRole('button', { name: 'Begin session' }))
  expect(audio).toHaveBeenCalledWith(expect.stringMatching(/^\/audio\/workout-coach-river\/.*\.mp3$/))
  expect(speak).not.toHaveBeenCalled()
})
