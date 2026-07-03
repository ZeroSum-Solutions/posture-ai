import { describe, test, expect } from 'vitest'
import { voiceCue, caption } from './cues'
import type { SessionItem, SessionTiming } from './generateWorkoutSession'
import { assertScreeningText } from '@/content/muscles/types'

function makeItem(timing: SessionTiming, over: Partial<SessionItem> = {}): SessionItem {
  return {
    index: 0,
    slug: 'chin-tucks',
    baseSlug: 'chin-tucks',
    name: 'Chin Tucks',
    category: 'activation',
    stepLabel: 'Wake up',
    priorityKey: 'forward_head',
    priorityLabel: 'Forward-head posture',
    isIntegrative: false,
    instructions: 'Draw the chin straight back to lengthen the back of the neck, then release slowly.',
    timing,
    ...over,
  }
}
const holdItem = makeItem({ kind: 'hold', sets: 2, secondsPerSet: 30, restSeconds: 10 })
const repsItem = makeItem({ kind: 'reps', sets: 3, repsPerSet: 12, restSeconds: 20 })

describe('cues.voiceCue', () => {
  test('announces the exercise and hold duration entering a hold set', () => {
    const c = voiceCue('playing', holdItem, 1)!
    expect(c.speech).toContain('Chin Tucks')
    expect(c.speech.toLowerCase()).toContain('hold')
    expect(c.speech).toContain('30')
  })

  test('announces the exercise and rep target entering a reps set', () => {
    const c = voiceCue('playing', repsItem, 1)!
    expect(c.speech).toContain('Chin Tucks')
    expect(c.speech).toContain('12')
    expect(c.speech.toLowerCase()).toContain('rep')
  })

  test('names the next exercise at up-next', () => {
    expect(voiceCue('upNext', holdItem, 1)!.speech).toContain('Chin Tucks')
  })

  test('announces the set number for later sets', () => {
    expect(voiceCue('playing', holdItem, 2)!.speech.toLowerCase()).toContain('set 2')
  })

  test('rest and summary produce cues; idle produces none', () => {
    expect(voiceCue('resting', holdItem, 2)!.speech.toLowerCase()).toContain('rest')
    expect(voiceCue('summary', undefined, 1)).not.toBeNull()
    expect(voiceCue('idle', undefined, 1)).toBeNull()
  })

  test('every generated cue passes the screening-vocabulary gate', () => {
    for (const phase of ['upNext', 'preroll', 'playing', 'resting', 'summary'] as const) {
      for (const it of [holdItem, repsItem]) {
        const c = voiceCue(phase, it, 1)
        if (c) {
          expect(() => assertScreeningText(c.speech)).not.toThrow()
          expect(() => assertScreeningText(c.caption)).not.toThrow()
        }
      }
    }
  })
})

describe('cues.caption', () => {
  test('surfaces the detailed instructions while playing', () => {
    expect(caption('playing', holdItem)).toBe(holdItem.instructions)
  })

  test('names the up-next exercise', () => {
    expect(caption('upNext', holdItem)).toContain('Chin Tucks')
  })
})
