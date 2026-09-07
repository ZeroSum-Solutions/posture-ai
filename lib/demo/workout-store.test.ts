// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createSampleScan } from './scan'
import { DEFAULT_WORKOUT_PREFERENCES, workoutCandidates } from './workout'
import { DEMO_WORKOUT_STORAGE_KEY, loadDemoWorkouts, saveDemoWorkouts, type DemoWorkout } from './workout-store'

const scan = createSampleScan()
const workout: DemoWorkout = { id: 'demo-workout', name: 'My workout', scanId: scan.id, scanLabel: scan.label, source: 'scan', createdAt: new Date().toISOString(), summary: 'A movement plan', preferences: DEFAULT_WORKOUT_PREFERENCES, snapshot: workoutCandidates(scan.result.findings, DEFAULT_WORKOUT_PREFERENCES)! }
beforeEach(() => localStorage.clear())
describe('local workout library', () => {
  it('round-trips a frozen snapshot, playback progress and completion rating', () => {
    const saved = { ...workout, run: { status: 'paused' as const, current_item_index: 1, revision: 4, items: [{ slug: workout.snapshot.items[0].slug, completed: true, skipped: false }] }, rating: { clarity: 5, feedback_tags: [] } }
    saveDemoWorkouts([saved])
    expect(loadDemoWorkouts()).toEqual([JSON.parse(JSON.stringify(saved))])
    saveDemoWorkouts([{ ...saved, run: { ...saved.run, status: 'completed' } }])
    expect(loadDemoWorkouts()[0].run?.status).toBe('completed')
  })
  it('rejects corrupted storage and impossible timing instead of starting a broken player', () => {
    localStorage.setItem(DEMO_WORKOUT_STORAGE_KEY, JSON.stringify([{ id: 'broken' }]))
    expect(() => loadDemoWorkouts()).toThrow('Saved workouts could not be read')
    const bad = { ...workout, snapshot: { ...workout.snapshot, items: [{ ...workout.snapshot.items[0], timing: { kind: 'hold', sets: 999, secondsPerSet: 10, restSeconds: 5 } }] } }
    expect(() => saveDemoWorkouts([bad as DemoWorkout])).toThrow()
  })
})
