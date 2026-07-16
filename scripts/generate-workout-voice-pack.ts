import { spawnSync } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ALL_EXERCISES } from '../content'
import type { ExerciseContent } from '../content/muscles/types'
import { computeDose, type Dose, type Week } from '../lib/program/dosage'
import { voiceCue } from '../lib/workout/cues'
import type { SessionItem, SessionTiming } from '../lib/workout/generateWorkoutSession'
import { workoutCueKey } from '../lib/workout/voicePack'

const VOICEBOX_URL = process.env.VOICEBOX_URL ?? 'http://127.0.0.1:17493'
const PROFILE_NAME = process.env.VOICEBOX_PROFILE_NAME ?? 'Posture AI Coach - River'
const OUTPUT_DIR = path.resolve('public/audio/workout-coach-river')
const shouldGenerate = process.argv.includes('--generate')
const shouldVerify = process.argv.includes('--verify')

type VoiceboxProfile = { id: string; name: string; preset_voice_id?: string | null }

function toTiming(dose: Dose): SessionTiming {
  return dose.type === 'hold' && dose.seconds != null
    ? { kind: 'hold', sets: dose.sets, secondsPerSet: dose.seconds, restSeconds: 0 }
    : { kind: 'reps', sets: dose.sets, repsPerSet: dose.reps ?? 1, restSeconds: 0 }
}

function toSessionItem(exercise: ExerciseContent, dose: Dose, isIntegrative: boolean): SessionItem {
  return {
    index: 0,
    slug: exercise.slug,
    baseSlug: exercise.slug,
    name: exercise.name,
    category: exercise.category,
    stepLabel: isIntegrative ? 'Connect' : 'Move',
    priorityKey: 'voice-pack',
    priorityLabel: 'Voice pack',
    isIntegrative,
    instructions: exercise.instructions,
    media: exercise.media,
    form: exercise.form,
    steps: exercise.steps,
    timing: toTiming(dose),
  }
}

export function workoutVoicePackCues(): Map<string, string> {
  const speechByKey = new Map<string, string>()
  const add = (speech: string) => {
    const key = workoutCueKey(speech)
    const collision = speechByKey.get(key)
    if (collision && collision !== speech) throw new Error(`Voice cue hash collision: ${collision} / ${speech}`)
    speechByKey.set(key, speech)
  }

  for (const exercise of ALL_EXERCISES) {
    if (exercise.category === 'informational') continue
    const isIntegrative = exercise.isIntegrative === true
    for (const week of [1, 2, 3] as Week[]) {
      const dose = computeDose(exercise, week, isIntegrative)
      if (!dose) continue
      const item = toSessionItem(exercise, dose, isIntegrative)
      const upNext = voiceCue('upNext', item, 1)
      if (upNext) add(upNext.speech)
      for (let set = 1; set <= dose.sets; set += 1) {
        const playing = voiceCue('playing', item, set)
        if (playing) add(playing.speech)
      }
    }
  }

  for (const [phase, item] of [
    ['preroll', undefined],
    ['resting', undefined],
    ['summary', undefined],
  ] as const) {
    const cue = voiceCue(phase, item, 1)
    if (cue) add(cue.speech)
  }

  return speechByKey
}

async function resolveProfile(): Promise<VoiceboxProfile> {
  const response = await fetch(`${VOICEBOX_URL}/profiles`)
  if (!response.ok) throw new Error(`Voicebox profiles failed: ${response.status} ${await response.text()}`)
  const profiles = (await response.json()) as VoiceboxProfile[]
  const profile = profiles.find((candidate) => candidate.name === PROFILE_NAME)
  if (!profile) throw new Error(`Voicebox profile not found: ${PROFILE_NAME}`)
  if (profile.preset_voice_id !== 'af_river') {
    throw new Error(`${PROFILE_NAME} must use the af_river preset, found ${profile.preset_voice_id ?? 'none'}`)
  }
  return profile
}

async function synthesize(profileId: string, text: string): Promise<Buffer> {
  const response = await fetch(`${VOICEBOX_URL}/generate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile_id: profileId,
      text,
      language: 'en',
      engine: 'kokoro',
      normalize: true,
    }),
  })
  if (!response.ok) throw new Error(`Voicebox generation failed: ${response.status} ${await response.text()}`)
  return Buffer.from(await response.arrayBuffer())
}

function encodeMp3(wav: Buffer): Buffer {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1'],
    { input: wav, maxBuffer: 32 * 1024 * 1024 },
  )
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.toString()}`)
  return result.stdout
}

async function main() {
  const cues = workoutVoicePackCues()
  const mode = shouldGenerate ? 'generate' : shouldVerify ? 'verify' : 'dry run'
  console.log(`${cues.size} unique workout cues (${mode})`)

  if (shouldVerify) {
    const existing = new Set(await readdir(OUTPUT_DIR))
    const expected = new Set([...cues.keys()].map((key) => `${key}.mp3`))
    const missing = [...expected].filter((filename) => !existing.has(filename))
    const extra = [...existing].filter((filename) => filename.endsWith('.mp3') && !expected.has(filename))
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(`Voice pack mismatch: ${missing.length} missing, ${extra.length} extra`)
    }
    console.log(`Voice pack verified: ${expected.size} files`)
    return
  }

  if (!shouldGenerate) return

  const profile = await resolveProfile()
  await mkdir(OUTPUT_DIR, { recursive: true })
  const existing = new Set(await readdir(OUTPUT_DIR))
  let generated = 0
  let skipped = 0

  for (const [key, speech] of cues) {
    const filename = `${key}.mp3`
    if (existing.has(filename)) {
      skipped += 1
      continue
    }
    const wav = await synthesize(profile.id, speech)
    await writeFile(path.join(OUTPUT_DIR, filename), encodeMp3(wav))
    generated += 1
    console.log(`[${generated + skipped}/${cues.size}] ${filename} ${speech}`)
  }

  console.log(`Voice pack ready: ${generated} generated, ${skipped} already present`)
}

await main()
