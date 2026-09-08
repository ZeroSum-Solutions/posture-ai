'use client'

import { useEffect, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { AthleteTrainingProfileV1Schema, type AthleteTrainingProfileV1 } from '@/lib/training/contracts/profile'
import { ACTIVE_PROGRAM_COMPILER_OPTIONS } from '@/lib/training/engine/options'
import { createInitialStrengthProfile } from './StrengthBuilder.model'
import { acceptTrainingBuild, publishTrainingDraft, requestTrainingBuild } from './StrengthBuilder.gateway'
import StrengthProgramBuilder, { type SaveProfileOutcome } from './StrengthProgramBuilder'
import TrainingProgramResumeList from './TrainingProgramResumeList'
import styles from './StrengthProgramBuilder.module.css'

const PROFILE_PROJECTION_VERSION = 'training-profile-projection.v1'

type Client = { id: string; name: string }
type CanonicalSubject = { id: string; name: string }
export type StrengthBuilderSource =
  | { kind: 'client'; client: Client }
  | { kind: 'live_subject'; subject: CanonicalSubject }
  | { kind: 'simulation_subject'; subject: CanonicalSubject }
  /** Compatibility alias for the existing practitioner sample launcher. */
  | { kind: 'subject'; subject: CanonicalSubject }
type ProfileProjection = { subjectId: string; revision: number; profile: AthleteTrainingProfileV1 }
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; projection: ProfileProjection }
  | { status: 'error'; message: string }
  | { status: 'setup_required' }

class AthleteSetupRequiredError extends Error {}

function profileUrl(selector: 'clientId' | 'subjectId', id: string): string {
  return `/api/training/profile?${selector}=${encodeURIComponent(id)}`
}

function isSimulationSource(source: StrengthBuilderSource): boolean {
  return source.kind === 'simulation_subject' || source.kind === 'subject'
}

function parseProjection(value: unknown, source: StrengthBuilderSource): ProfileProjection | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== PROFILE_PROJECTION_VERSION || typeof record.subjectId !== 'string' || !record.subjectId) return null
  if (source.kind === 'client' && record.clientId !== source.client.id) return null
  if (source.kind !== 'client' && record.subjectId !== source.subject.id) return null
  if (record.current === null) {
    const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC'
    return { subjectId: record.subjectId, revision: 0, profile: createInitialStrengthProfile(localTimezone) }
  }
  if (!record.current || typeof record.current !== 'object') return null
  const current = record.current as Record<string, unknown>
  if (!Number.isInteger(current.revision) || (current.revision as number) < 1) return null
  const profile = AthleteTrainingProfileV1Schema.safeParse(current.profile)
  return profile.success ? { subjectId: record.subjectId, revision: current.revision as number, profile: profile.data } : null
}

async function requestProjection(url: string, source: StrengthBuilderSource, signal?: AbortSignal): Promise<ProfileProjection> {
  const response = await fetch(url, { cache: 'no-store', signal })
  const body: unknown = await response.json().catch(() => null)
  if (response.status === 409 && body && typeof body === 'object' && (body as Record<string, unknown>).code === 'athlete_setup_required') {
    throw new AthleteSetupRequiredError()
  }
  if (!response.ok) throw new Error('Training profile could not be loaded.')
  const projection = parseProjection(body, source)
  if (!projection) throw new Error('Training profile response was invalid.')
  return projection
}

export default function StrengthBuilderEntry({ source }: { source: StrengthBuilderSource }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const identity = source.kind === 'client' ? source.client : source.subject
  const loadUrl = profileUrl(source.kind === 'client' ? 'clientId' : 'subjectId', identity.id)
  const simulationSource = isSimulationSource(source)

  async function retryLoad() {
    setLoadState({ status: 'loading' })
    try {
      const projection = await requestProjection(loadUrl, source)
      setLoadState({ status: 'ready', projection })
    } catch (cause) {
      if (cause instanceof AthleteSetupRequiredError) {
        setLoadState({ status: 'setup_required' })
        return
      }
      setLoadState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Training profile could not be loaded.',
      })
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void requestProjection(loadUrl, source, controller.signal)
      .then(projection => setLoadState({ status: 'ready', projection }))
      .catch(cause => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (cause instanceof AthleteSetupRequiredError) {
          setLoadState({ status: 'setup_required' })
          return
        }
        setLoadState({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'Training profile could not be loaded.',
        })
      })
    return () => controller.abort()
  }, [loadUrl, source])

  async function saveProfile(input: {
    expectedRevision: number
    profile: AthleteTrainingProfileV1
  }): Promise<SaveProfileOutcome> {
    if (loadState.status !== 'ready') return { status: 'not_saved', message: 'Training profile is not ready to save.' }
    const response = await fetch(profileUrl('subjectId', loadState.projection.subjectId), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body: unknown = await response.json().catch(() => null)

    if (response.status === 409 && body && typeof body === 'object') {
      const current = (body as Record<string, unknown>).current
      const projection = parseProjection(current, source)
      if (projection && projection.subjectId === loadState.projection.subjectId) {
        return { status: 'conflict', current: { revision: projection.revision, profile: projection.profile } }
      }
    }
    if (!response.ok) {
      return { status: 'not_saved', message: 'Profile was not saved. Review access and try again.' }
    }
    const saved = parseProjection(body, source)
    if (!saved || saved.subjectId !== loadState.projection.subjectId) {
      return { status: 'not_saved', message: 'Profile save response was invalid.' }
    }
    return { status: 'saved', revision: saved.revision }
  }

  if (loadState.status === 'loading') {
    return <Surface tier="tile" innerClassName={styles.entryState}><p role="status" className="t-body">Loading training profile…</p></Surface>
  }
  if (loadState.status === 'error') {
    return <Surface tier="tile" innerClassName={styles.entryState}>
      <p role="alert" className="t-body">{loadState.message}</p>
      <button type="button" className="a-secondary" onClick={() => void retryLoad()}>Retry profile</button>
    </Surface>
  }
  if (loadState.status === 'setup_required') {
    return <Surface tier="tile" innerClassName={styles.entryState}>
      <p className="t-kicker">Athlete setup required</p>
      <h2 className="t-headline-sm">Connect {identity.name} to a training account.</h2>
      <p className="t-body">Create an athlete invitation and active coaching relationship before reading or saving a training profile. No account or relationship was created automatically.</p>
    </Surface>
  }

  return <>
    <TrainingProgramResumeList
      subjectId={loadState.projection.subjectId}
      sessionHrefBase={source.kind === 'live_subject' ? '/train' : '/workouts'}
    />
    <StrengthProgramBuilder
      key={`${loadState.projection.subjectId}:${loadState.projection.revision}`}
      subject={{ id: loadState.projection.subjectId, name: identity.name }}
      initialProfile={loadState.projection.profile}
      initialRevision={loadState.projection.revision}
      supportedCycleLengths={ACTIVE_PROGRAM_COMPILER_OPTIONS.cycleLengthWeeks}
      catalogState={simulationSource
        ? { status: 'ready', reviewedExerciseCount: 4, conditioningModeCount: 1, kind: 'practice' }
        : { status: 'pending', message: source.kind === 'live_subject'
          ? 'Live program building is not available yet. You can save your profile and resume assigned sessions.'
          : 'Live strength programming is not ready for real athletes yet. You can save the profile now or use the private sample workspace.' }}
      onSaveProfile={saveProfile}
      onBuildPracticeDraft={simulationSource ? requestTrainingBuild : undefined}
      onAcceptPracticeTargets={simulationSource ? acceptTrainingBuild : undefined}
      onPublishPracticeDraft={simulationSource ? publishTrainingDraft : undefined}
    />
  </>
}
