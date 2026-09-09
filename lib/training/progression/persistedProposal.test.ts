import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { TrainingProgramRevisionV1Schema } from '../contracts/program'
import {
  SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
  SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE,
} from '../catalog/syntheticBodyweightAssistance'
import {
  applyAcceptedProgressionProposal,
  buildPersistedProgressionProjection,
  proposalPersistenceKey,
} from './persistedProposal'

const userId = '11111111-1111-4111-8111-111111111111'
const profile = {
  schemaVersion: 'athlete-training-profile.v1', origin: { kind: 'athlete_input' },
  goal: 'strength', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 8,
  strengthDays: ['monday', 'thursday'], localTimezone: 'UTC', sessionTimeBudgetMinutes: 30,
  preferredLoadUnit: 'kg',
  equipmentInventory: [{ kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['50', '52'] }],
  startingHistory: [],
} as const
const eligibility = {
  state: 'eligible_general', scope: 'supported', policyVersion: 'eligibility-v1', sourceRevisionId: 'eligibility-1',
  source: { kind: 'policy_service', sourceVersion: 'eligibility-policy-service.v1', evaluatedAt: '2026-09-01T00:00:00.000Z' },
  effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveUntil: '2026-10-01T00:00:00.000Z', supersededAt: null,
} as const
const quantity = (value: string) => createLoadQuantity({ value, unit: 'kg' })

function acceptedLoad(exerciseInstanceId: string) {
  return {
    status: 'accepted' as const, acceptanceId: `accept-${exerciseInstanceId}`,
    acceptedAt: '2026-09-01T00:00:00.000Z', acceptedByUserId: userId,
    source: 'equipment_inventory' as const, executionContext: { kind: 'live' as const },
    exerciseInstanceId, exerciseVersionId: 'press.v1', equipmentId: 'machine-1',
    provenance: { profileRevisionId: '1', compiledProgramRevisionId: 'compiled-1', catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' as const } },
    loadBasis: 'machine_stack' as const, implementCount: 1 as const,
    holdingConfiguration: 'machine_defined' as const, quantity: quantity('50'),
  }
}

function exercise(session: number) {
  const exerciseInstanceId = `exercise-${session}`
  return {
    exerciseInstanceId, exerciseVersionId: 'press.v1', movementPattern: 'push' as const,
    setIds: [`set-${session}-1`, `set-${session}-2`], repRange: { minimum: 6, maximum: 8 },
    targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
    progression: { progressionSeriesId: 'strength-slot:push', side: 'bilateral' as const, rom: 'catalog_default', tempo: 'controlled', exposureType: 'standard', loadEpoch: 1 },
    acceptedInitialLoad: acceptedLoad(exerciseInstanceId),
  }
}

function program() {
  return TrainingProgramRevisionV1Schema.parse({
    schemaVersion: 'training-program-revision.v1', assignmentId: 'assignment-1', revisionNumber: 1,
    subjectId: 'subject-1', programMode: 'self_directed', owningPractitionerId: null,
    executionContext: { kind: 'live' }, cycleStartLocalDate: '2026-09-01', cycleLengthWeeks: 8,
    profileRevisionId: '1', eligibilitySourceRevisionId: 'eligibility-1', compilerPolicyVersion: 'eight-week-compiler.v2',
    catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' }, ruleVersion: 'progression-v1',
    compiledProgramRevisionId: 'compiled-1', publishedAt: '2026-09-01T00:00:00.000Z',
    author: { kind: 'athlete', userId },
    sessions: [1, 2, 3, 4].map(index => ({
      sessionId: `session-${index}`, sessionType: 'full_body', scheduledLocalDate: `2026-09-0${index}`,
      athleteTimezone: 'UTC', exercises: [exercise(index)],
    })),
    conditioningBouts: [{
      status: 'accepted', acceptanceId: 'bout-accept', acceptedAt: '2026-09-01T00:00:00.000Z',
      acceptedByUserId: userId, executionContext: { kind: 'live' }, boutId: 'bout-1', modalityId: 'walk-v1',
      scheduledLocalDate: '2026-09-02', athleteTimezone: 'UTC', acceptedDurationSeconds: 600,
      effortCue: 'Comfortable talk pace', source: { compiledProgramRevisionId: 'compiled-1', compilerPolicyVersion: 'eight-week-compiler.v2', catalogVersion: 'catalog-1', catalogOrigin: { kind: 'authored_catalog' } },
    }],
  })
}

function evidence(
  session: number,
  completedAt: string,
  actualReps: readonly [number, number] = [8, 8],
  sessionRevision = 4,
) {
  const prescribed = exercise(session)
  const prescription = {
    schemaVersion: 'training-session-prescription.v1', sessionId: `session-${session}`, assignmentId: 'assignment-1',
    programRevisionNumber: 1, subjectId: 'subject-1', executionContext: { kind: 'live' },
    scheduledLocalDate: `2026-09-0${session}`, athleteTimezone: 'UTC', profileRevisionId: '1',
    eligibilitySourceRevisionId: 'eligibility-1', compilerPolicyVersion: 'compiler-v2', catalogVersion: 'catalog-1',
    catalogOrigin: { kind: 'authored_catalog' }, compiledProgramRevisionId: 'compiled-1', ruleVersion: 'progression-v1',
    exercises: [prescribed],
  } as const
  return {
    session: { sessionId: `session-${session}`, revision: sessionRevision, state: 'completed', stoppedForSymptoms: false },
    executionContext: { kind: 'live' }, prescription, exerciseInstanceId: `exercise-${session}`,
    currentEvents: [1, 2].map(ordinal => ({
      schemaVersion: 'training-set-log-event.v1', eventId: `event-${session}-${ordinal}-${sessionRevision}`,
      eventType: sessionRevision === 4 ? 'set_actual_recorded' : 'set_actual_corrected',
      eventRevision: sessionRevision === 4 ? 1 : 2,
      replacesEventId: sessionRevision === 4 ? null : `event-${session}-${ordinal}-4`,
      subjectId: 'subject-1', sessionId: `session-${session}`,
      exerciseInstanceId: `exercise-${session}`, setId: `set-${session}-${ordinal}`, setKind: 'working',
      workingSetOrdinal: ordinal, executionContext: { kind: 'live' }, equipmentId: 'machine-1',
      loadBasis: 'machine_stack', quantity: quantity('50'), reps: actualReps[ordinal - 1], rir: 2, side: 'bilateral',
      symptomState: 'none', actor: { kind: 'athlete', userId }, occurredAt: completedAt, serverAt: completedAt,
    })),
    metadata: {
      schemaVersion: 'strength-session-progression-metadata.v1',
      prescriptionSourceRevisionId: `training-session-prescription.v1:sha256:${String(session).repeat(64)}`,
      progressionSeriesId: 'strength-slot:push', startedAt: completedAt.replace('30:00', '00:00'), completedAt,
      comparator: { side: 'bilateral', rom: 'catalog_default', tempo: 'controlled', exposureType: 'standard', loadEpoch: 1 },
    },
  }
}

function candidate() {
  return {
    assignment: { id: 'assignment-1', subjectId: 'subject-1', programMode: 'self_directed', owningPractitionerId: null, simulationRunId: null, activeRevision: 1, revision: 1 },
    program: program(), programHash: 'a'.repeat(64), currentProfileRevision: 1, profileRevision: 1,
    profile, eligibility, progressionSeriesId: 'strength-slot:push', executionContext: { kind: 'live' },
    evidence: [evidence(1, '2026-09-01T17:30:00.000Z'), evidence(2, '2026-09-04T17:30:00.000Z')],
    targets: [3, 4].map(index => ({ sessionId: `session-${index}`, sessionRevision: 1, exerciseInstanceId: `exercise-${index}`, scheduledLocalDate: `2026-09-0${index}` })),
  }
}

type DedicatedBasis = 'bodyweight_external' | 'machine_assistance'

function dedicatedContext(fixtureHash = SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH) {
  return {
    kind: 'synthetic_simulation' as const,
    simulationRunId: '44444444-4444-4444-8444-444444444444',
    fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
    fixtureHash,
    label: 'Practice data' as const,
  }
}

function dedicatedAcceptedLoad(exerciseInstanceId: string, basis: DedicatedBasis) {
  const isBodyweight = basis === 'bodyweight_external'
  return {
    status: 'accepted' as const,
    acceptanceId: `accept-${exerciseInstanceId}`,
    acceptedAt: '2026-09-01T00:00:00.000Z',
    acceptedByUserId: userId,
    source: 'equipment_inventory' as const,
    executionContext: dedicatedContext(),
    exerciseInstanceId,
    exerciseVersionId: isBodyweight
      ? 'synthetic-bodyweight-squat.v1'
      : 'synthetic-assisted-pullup.v1',
    equipmentId: isBodyweight
      ? 'synthetic-bodyweight-station'
      : 'synthetic-assisted-pullup-machine',
    provenance: {
      profileRevisionId: '1', compiledProgramRevisionId: 'compiled-dedicated-1',
      catalogVersion: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
      catalogOrigin: {
        kind: 'synthetic_fixture' as const, source: 'server_fixture' as const,
        fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
        fixtureHash: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
        label: 'Synthetic bodyweight and assistance catalog',
      },
    },
    bodyweightAssistancePolicy: isBodyweight
      ? SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE
      : SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
    loadBasis: basis,
    implementCount: isBodyweight ? 0 as const : 1 as const,
    holdingConfiguration: isBodyweight
      ? 'bodyweight_plus_external_load' as const
      : 'machine_assistance' as const,
    quantity: quantity(isBodyweight ? '0' : '20'),
  }
}

function dedicatedExercise(session: number, basis: DedicatedBasis) {
  const exerciseInstanceId = `dedicated-exercise-${session}`
  const isBodyweight = basis === 'bodyweight_external'
  return {
    exerciseInstanceId,
    exerciseVersionId: isBodyweight
      ? 'synthetic-bodyweight-squat.v1'
      : 'synthetic-assisted-pullup.v1',
    movementPattern: isBodyweight ? 'knee_dominant' as const : 'pull' as const,
    setIds: [`dedicated-set-${session}-1`, `dedicated-set-${session}-2`],
    repRange: { minimum: 6, maximum: 8 },
    targetRir: { minimum: 2, maximum: 3 },
    restSeconds: 120,
    progression: {
      progressionSeriesId: isBodyweight ? 'strength-slot:knee_dominant' : 'strength-slot:pull',
      side: 'bilateral' as const, rom: 'catalog_default', tempo: 'self_selected_controlled',
      exposureType: 'standard', loadEpoch: 0,
    },
    acceptedInitialLoad: dedicatedAcceptedLoad(exerciseInstanceId, basis),
  }
}

function dedicatedProgram(basis: DedicatedBasis) {
  const context = dedicatedContext()
  const catalogOrigin = {
    kind: 'synthetic_fixture' as const, source: 'server_fixture' as const,
    fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
    fixtureHash: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
    label: 'Synthetic bodyweight and assistance catalog',
  }
  return TrainingProgramRevisionV1Schema.parse({
    schemaVersion: 'training-program-revision.v1', assignmentId: 'assignment-dedicated', revisionNumber: 1,
    subjectId: 'subject-1', programMode: 'self_directed', owningPractitionerId: null,
    executionContext: context, cycleStartLocalDate: '2026-09-01', cycleLengthWeeks: 8,
    profileRevisionId: '1', eligibilitySourceRevisionId: 'eligibility-1',
    compilerPolicyVersion: 'strength-cycle-compiler.v3',
    catalogVersion: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID, catalogOrigin,
    ruleVersion: 'progression-v1', compiledProgramRevisionId: 'compiled-dedicated-1',
    publishedAt: '2026-09-01T00:00:00.000Z', author: { kind: 'athlete', userId },
    sessions: [1, 2, 3, 4].map(index => ({
      sessionId: `dedicated-session-${index}`, sessionType: 'full_body',
      scheduledLocalDate: `2026-09-0${index}`, athleteTimezone: 'UTC',
      exercises: [dedicatedExercise(index, basis)],
    })),
    conditioningBouts: [{
      status: 'accepted', acceptanceId: 'dedicated-bout-accept',
      acceptedAt: '2026-09-01T00:00:00.000Z', acceptedByUserId: userId,
      executionContext: context, boutId: 'dedicated-bout-1',
      modalityId: 'synthetic-continuous-walking.v1', scheduledLocalDate: '2026-09-02',
      athleteTimezone: 'UTC', acceptedDurationSeconds: 600,
      effortCue: 'Use a comfortable practice pace.',
      source: {
        compiledProgramRevisionId: 'compiled-dedicated-1',
        compilerPolicyVersion: 'strength-cycle-compiler.v3',
        catalogVersion: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID, catalogOrigin,
      },
    }],
  })
}

function dedicatedEvidence(basis: DedicatedBasis) {
  const session = 2
  const prescribed = dedicatedExercise(session, basis)
  const context = dedicatedContext()
  const completedAt = '2026-09-04T17:30:00.000Z'
  return {
    session: {
      sessionId: `dedicated-session-${session}`, revision: 4,
      state: 'completed', stoppedForSymptoms: false,
    },
    executionContext: context,
    prescription: {
      schemaVersion: 'training-session-prescription.v1',
      sessionId: `dedicated-session-${session}`, assignmentId: 'assignment-dedicated',
      programRevisionNumber: 1, subjectId: 'subject-1', executionContext: context,
      scheduledLocalDate: `2026-09-0${session}`, athleteTimezone: 'UTC', profileRevisionId: '1',
      eligibilitySourceRevisionId: 'eligibility-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
      catalogVersion: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
      catalogOrigin: prescribed.acceptedInitialLoad.provenance.catalogOrigin,
      compiledProgramRevisionId: 'compiled-dedicated-1', ruleVersion: 'progression-v1',
      exercises: [prescribed],
    },
    exerciseInstanceId: prescribed.exerciseInstanceId,
    currentEvents: [1, 2].map(ordinal => ({
      schemaVersion: 'training-set-log-event.v1', eventId: `dedicated-event-${ordinal}`,
      eventType: 'set_actual_recorded', eventRevision: 1, replacesEventId: null,
      subjectId: 'subject-1', sessionId: `dedicated-session-${session}`,
      exerciseInstanceId: prescribed.exerciseInstanceId,
      setId: prescribed.setIds[ordinal - 1], setKind: 'working', workingSetOrdinal: ordinal,
      executionContext: context,
      equipmentId: prescribed.acceptedInitialLoad.equipmentId,
      loadBasis: basis, quantity: prescribed.acceptedInitialLoad.quantity,
      reps: 7, rir: 2, side: 'bilateral', symptomState: 'none',
      actor: { kind: 'athlete', userId }, occurredAt: completedAt, serverAt: completedAt,
    })),
    metadata: {
      schemaVersion: 'strength-session-progression-metadata.v1',
      prescriptionSourceRevisionId: `training-session-prescription.v1:sha256:${'d'.repeat(64)}`,
      progressionSeriesId: prescribed.progression.progressionSeriesId,
      startedAt: '2026-09-04T17:00:00.000Z', completedAt,
      comparator: {
        side: 'bilateral', rom: 'catalog_default', tempo: 'self_selected_controlled',
        exposureType: 'standard', loadEpoch: 0,
      },
    },
  }
}

function dedicatedCandidate(basis: DedicatedBasis) {
  const program = dedicatedProgram(basis)
  const isBodyweight = basis === 'bodyweight_external'
  return {
    assignment: {
      id: 'assignment-dedicated', subjectId: 'subject-1', programMode: 'self_directed',
      owningPractitionerId: null,
      simulationRunId: '44444444-4444-4444-8444-444444444444', activeRevision: 1, revision: 1,
    },
    program, programHash: 'c'.repeat(64), currentProfileRevision: 1, profileRevision: 1,
    profile: {
      ...profile,
      origin: {
        kind: 'synthetic_fixture', fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
        label: 'Synthetic bodyweight and assistance practice profile',
      },
      equipmentInventory: [isBodyweight ? {
        kind: 'bodyweight_external', equipmentId: 'synthetic-bodyweight-station',
        unit: 'kg', externalLoads: ['0', '5', '10'],
      } : {
        kind: 'assistance_machine', equipmentId: 'synthetic-assisted-pullup-machine',
        unit: 'kg', assistanceLoads: ['10', '20', '30'],
      }],
    },
    eligibility: {
      ...eligibility,
      source: {
        kind: 'synthetic_fixture' as const,
        sourceVersion: 'synthetic-eligibility-fixture.v1' as const,
        fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
        label: 'Synthetic bodyweight and assistance eligibility',
      },
    },
    progressionSeriesId: isBodyweight ? 'strength-slot:knee_dominant' : 'strength-slot:pull',
    executionContext: dedicatedContext(),
    evidence: [dedicatedEvidence(basis)],
    targets: [3, 4].map(index => ({
      sessionId: `dedicated-session-${index}`, sessionRevision: 1,
      exerciseInstanceId: `dedicated-exercise-${index}`, scheduledLocalDate: `2026-09-0${index}`,
    })),
  }
}

describe('persisted progression proposal', () => {
  it('builds the same load proposal from the same saved evidence and pending target', () => {
    const first = buildPersistedProgressionProjection(candidate(), new Date('2026-09-05T12:00:00.000Z'))
    const second = buildPersistedProgressionProjection(candidate(), new Date('2026-09-05T13:00:00.000Z'))
    expect(first).toMatchObject({ kind: 'proposal', target: { sessionId: 'session-3' }, decision: { kind: 'load_proposal', proposal: { load: { quantity: { canonicalKg: '52' } }, targetReps: [6, 6] } } })
    expect(second).toMatchObject({ kind: 'proposal' })
    if (first.kind === 'proposal' && second.kind === 'proposal') expect(second.proposalKey).toBe(first.proposalKey)
  })

  it('propagates accepted load and epoch through later matching unstarted targets', () => {
    const result = buildPersistedProgressionProjection(candidate(), new Date('2026-09-05T12:00:00.000Z'))
    if (result.kind !== 'proposal') throw new Error('expected proposal')
    const next = applyAcceptedProgressionProposal({
      activeProgram: program(), proposalId: '22222222-2222-4222-8222-222222222222',
      decision: result.decision, target: result.target, mutableTargets: candidate().targets,
      actorUserId: userId, acceptedAt: '2026-09-05T12:01:00.000Z',
    })
    expect(next.revisionNumber).toBe(2)
    expect(next.sessions.slice(2).map(session => session.exercises[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetReps: [6, 6], progression: expect.objectContaining({ loadEpoch: 2 }), acceptedInitialLoad: expect.objectContaining({ quantity: expect.objectContaining({ canonicalKg: '52' }) }) }),
      expect.objectContaining({ targetReps: [6, 6], progression: expect.objectContaining({ loadEpoch: 2 }), acceptedInitialLoad: expect.objectContaining({ quantity: expect.objectContaining({ canonicalKg: '52' }) }) }),
    ]))
    expect(next.sessions[0].exercises[0].progression?.loadEpoch).toBe(1)
  })

  it('does not repropose already-applied rep targets but responds to corrected actuals', () => {
    const initialCandidate = {
      ...candidate(),
      evidence: [evidence(2, '2026-09-04T17:30:00.000Z', [7, 7])],
    }
    const initial = buildPersistedProgressionProjection(
      initialCandidate,
      new Date('2026-09-05T12:00:00.000Z'),
    )
    expect(initial).toMatchObject({
      kind: 'proposal',
      decision: { kind: 'rep_proposal', proposal: { targetReps: [8, 7] } },
    })
    if (initial.kind !== 'proposal') throw new Error('expected rep proposal')

    const acceptedProgram = applyAcceptedProgressionProposal({
      activeProgram: initialCandidate.program,
      proposalId: '22222222-2222-4222-8222-222222222222',
      decision: initial.decision,
      target: initial.target,
      mutableTargets: initialCandidate.targets,
      actorUserId: userId,
      acceptedAt: '2026-09-05T12:01:00.000Z',
    })
    const afterAcceptance = {
      ...initialCandidate,
      assignment: { ...initialCandidate.assignment, activeRevision: 2, revision: 2 },
      program: acceptedProgram,
      programHash: 'b'.repeat(64),
    }

    expect(buildPersistedProgressionProjection(
      afterAcceptance,
      new Date('2026-09-05T12:02:00.000Z'),
    )).toEqual({ kind: 'no_pending_target', reason: 'no_pending_strength_target' })

    expect(buildPersistedProgressionProjection({
      ...afterAcceptance,
      evidence: [evidence(2, '2026-09-04T17:30:00.000Z', [6, 7], 5)],
    }, new Date('2026-09-05T12:03:00.000Z'))).toMatchObject({
      kind: 'proposal',
      decision: { kind: 'rep_proposal', proposal: { targetReps: [7, 7] } },
    })
  })

  it('fails closed on stale profile and changes persistence identity with target revision', () => {
    expect(buildPersistedProgressionProjection({ ...candidate(), currentProfileRevision: 2 }, new Date('2026-09-05T12:00:00.000Z')))
      .toEqual({ kind: 'profile_stale' })
    const identity = {
      decisionKey: 'decision-1', assignmentId: 'assignment-1', baseProgramRevisionNumber: 1,
      targetSessionId: 'session-3', targetExerciseInstanceId: 'exercise-3', targetSessionRevision: 1,
      assignmentRevision: 1, programHash: 'a'.repeat(64),
      sourceSessions: [{ sessionId: 'session-1', revision: 4 }], executionContext: { kind: 'live' as const },
    }
    const base = proposalPersistenceKey(identity)
    const changed = proposalPersistenceKey({ ...identity, baseProgramRevisionNumber: 2 })
    expect(changed).not.toBe(base)
  })

  it.each(['bodyweight_external', 'machine_assistance'] as const)(
    'routes %s through the dedicated rep-only policy and preserves exact load on acceptance',
    (basis) => {
      const source = dedicatedCandidate(basis)
      const result = buildPersistedProgressionProjection(
        source,
        new Date('2026-09-05T12:00:00.000Z'),
      )
      expect(result).toMatchObject({
        kind: 'proposal',
        decision: {
          schemaVersion: 'bodyweight-assistance-progression-decision.v1',
          kind: 'rep_proposal', status: 'proposed', loadChange: 'none',
          targetReps: [8, 7], preservedLoad: { loadBasis: basis },
        },
      })
      if (result.kind !== 'proposal') throw new Error('expected dedicated proposal')
      const next = applyAcceptedProgressionProposal({
        activeProgram: source.program,
        proposalId: '22222222-2222-4222-8222-222222222222',
        decision: result.decision,
        target: result.target,
        mutableTargets: source.targets,
        actorUserId: userId,
        acceptedAt: '2026-09-05T12:01:00.000Z',
      })
      expect(next.sessions.slice(2).map(session => session.exercises[0])).toEqual([
        expect.objectContaining({
          targetReps: [8, 7], progression: expect.objectContaining({ loadEpoch: 0 }),
          acceptedInitialLoad: source.program.sessions[2].exercises[0].acceptedInitialLoad,
        }),
        expect.objectContaining({
          targetReps: [8, 7], progression: expect.objectContaining({ loadEpoch: 0 }),
          acceptedInitialLoad: source.program.sessions[3].exercises[0].acceptedInitialLoad,
        }),
      ])
    },
  )

  it('returns an explicit policy hold when the synthetic policy tuple is not trusted', () => {
    const source = dedicatedCandidate('bodyweight_external')
    const untrustedContext = dedicatedContext('f'.repeat(64))
    const untrusted = {
      ...source,
      executionContext: untrustedContext,
      assignment: { ...source.assignment },
      program: {
        ...source.program,
        executionContext: untrustedContext,
        catalogOrigin: {
          ...source.program.catalogOrigin,
          fixtureHash: 'f'.repeat(64),
        },
        sessions: source.program.sessions.map(session => ({
          ...session,
          exercises: session.exercises.map(exercise => ({
            ...exercise,
            acceptedInitialLoad: {
              ...exercise.acceptedInitialLoad,
              executionContext: untrustedContext,
              provenance: {
                ...exercise.acceptedInitialLoad.provenance,
                catalogOrigin: {
                  ...exercise.acceptedInitialLoad.provenance.catalogOrigin,
                  fixtureHash: 'f'.repeat(64),
                },
              },
            },
          })),
        })),
        conditioningBouts: source.program.conditioningBouts.map(bout => ({
          ...bout,
          executionContext: untrustedContext,
          source: {
            ...bout.source,
            catalogOrigin: {
              ...bout.source.catalogOrigin,
              fixtureHash: 'f'.repeat(64),
            },
          },
        })),
      },
      evidence: [{
        ...source.evidence[0],
        executionContext: untrustedContext,
        prescription: {
          ...source.evidence[0].prescription,
          executionContext: untrustedContext,
          catalogOrigin: {
            ...source.evidence[0].prescription.catalogOrigin,
            fixtureHash: 'f'.repeat(64),
          },
          exercises: source.evidence[0].prescription.exercises.map(exercise => ({
            ...exercise,
            acceptedInitialLoad: {
              ...exercise.acceptedInitialLoad,
              executionContext: untrustedContext,
              provenance: {
                ...exercise.acceptedInitialLoad.provenance,
                catalogOrigin: {
                  ...exercise.acceptedInitialLoad.provenance.catalogOrigin,
                  fixtureHash: 'f'.repeat(64),
                },
              },
            },
          })),
        },
        currentEvents: source.evidence[0].currentEvents.map(event => ({
          ...event, executionContext: untrustedContext,
        })),
      }],
    }
    expect(buildPersistedProgressionProjection(
      untrusted,
      new Date('2026-09-05T12:00:00.000Z'),
    )).toMatchObject({
      kind: 'not_proposed',
      decision: {
        schemaVersion: 'bodyweight-assistance-progression-decision.v1',
        reason: 'policy_unavailable_hold',
      },
    })
  })

  it('does not propagate a dedicated rep target across a different policy identity', () => {
    const source = dedicatedCandidate('bodyweight_external')
    const result = buildPersistedProgressionProjection(
      source,
      new Date('2026-09-05T12:00:00.000Z'),
    )
    if (result.kind !== 'proposal') throw new Error('expected dedicated proposal')
    const changedProgram = TrainingProgramRevisionV1Schema.parse({
      ...source.program,
      sessions: source.program.sessions.map((session, index) => index !== 3 ? session : ({
        ...session,
        exercises: session.exercises.map(exercise => ({
          ...exercise,
          acceptedInitialLoad: {
            ...exercise.acceptedInitialLoad,
            bodyweightAssistancePolicy: SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
          },
        })),
      })),
    })
    const next = applyAcceptedProgressionProposal({
      activeProgram: changedProgram,
      proposalId: '22222222-2222-4222-8222-222222222222',
      decision: result.decision,
      target: result.target,
      mutableTargets: source.targets,
      actorUserId: userId,
      acceptedAt: '2026-09-05T12:01:00.000Z',
    })
    expect(next.sessions[2].exercises[0].targetReps).toEqual([8, 7])
    expect(next.sessions[3].exercises[0].targetReps).toBeUndefined()
  })

  it('rejects a dedicated acceptance whose preserved load differs from the target', () => {
    const source = dedicatedCandidate('machine_assistance')
    const result = buildPersistedProgressionProjection(
      source,
      new Date('2026-09-05T12:00:00.000Z'),
    )
    if (result.kind !== 'proposal'
      || !('schemaVersion' in result.decision)) throw new Error('expected dedicated proposal')
    expect(() => applyAcceptedProgressionProposal({
      activeProgram: source.program,
      proposalId: '22222222-2222-4222-8222-222222222222',
      decision: {
        ...result.decision,
        preservedLoad: {
          loadBasis: 'machine_assistance',
          equipmentId: 'synthetic-assisted-pullup-machine',
          assistance: quantity('30'),
        },
      },
      target: result.target,
      mutableTargets: source.targets,
      actorUserId: userId,
      acceptedAt: '2026-09-05T12:01:00.000Z',
    })).toThrow('Invalid bodyweight or assistance progression target')
  })
})
