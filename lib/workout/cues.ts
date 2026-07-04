/**
 * Boundary voice cues + on-screen captions for the player. Assembled from
 * schema-validated exercise content (name / instructions) plus a fixed
 * screening-safe vocabulary — no client-specific or clinical text — so both the
 * spoken line and its mirrored caption stay inside the screening boundary (see
 * cues.test.ts, which asserts every generated cue passes assertScreeningText).
 *
 * `voiceCue` is the transient line spoken when ENTERING a phase (boundary only);
 * `caption` is the persistent on-screen text for the current phase.
 */
import type { PlayerPhase } from './playerMachine'
import type { SessionItem } from './generateWorkoutSession'

export interface Cue {
  speech: string
  caption: string
}

export function voiceCue(phase: PlayerPhase, item: SessionItem | undefined, set: number): Cue | null {
  const setPrefix = set > 1 ? `Set ${set}. ` : ''
  switch (phase) {
    case 'upNext':
      return item ? { speech: `Up next, ${item.name}.`, caption: `Up next: ${item.name}` } : null
    case 'preroll':
      return { speech: 'Get ready.', caption: 'Get ready…' }
    case 'playing': {
      if (!item) return null
      // Set 1 coaches alignment; later sets warn against the common fault.
      // Cues are authored as complete sentences, so plain concatenation is safe.
      const coach =
        set > 1 && item.form?.avoidCue
          ? ` ${item.form.avoidCue}`
          : item.form?.alignmentCue
            ? ` ${item.form.alignmentCue}`
            : ''
      const capText = item.form?.alignmentCue ?? item.instructions
      if (item.timing.kind === 'hold') {
        return {
          speech: `${setPrefix}${item.name}. Hold for ${item.timing.secondsPerSet} seconds.${coach}`,
          caption: capText,
        }
      }
      return {
        speech: `${setPrefix}${item.name}. ${item.timing.repsPerSet} reps.${coach}`,
        caption: capText,
      }
    }
    case 'resting':
      return { speech: 'Rest. Breathe.', caption: 'Rest — next set coming up.' }
    case 'summary':
      return { speech: 'Session complete. Nice work.', caption: 'Session complete.' }
    default:
      return null
  }
}

export function caption(phase: PlayerPhase, item: SessionItem | undefined): string {
  switch (phase) {
    case 'upNext':
      return item ? `Up next: ${item.name}` : ''
    case 'preroll':
      return 'Get ready…'
    case 'playing':
      return item?.form?.alignmentCue ?? item?.instructions ?? ''
    case 'resting':
      return 'Rest — next set coming up.'
    default:
      return ''
  }
}
