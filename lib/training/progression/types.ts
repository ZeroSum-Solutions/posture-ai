import type { EquipmentInventory, EquipmentLoad } from '../equipment'
import type { EligibilitySnapshotV1 } from '../contracts/eligibility'
import type { ExecutionContextV1 } from '../contracts/program'

export type { EligibilitySnapshotV1, EligibilityStateV1 } from '../contracts/eligibility'

export interface ProgressionEligibilityAuthorizationV1 {
  decision: 'authorized' | 'blocked'
  subjectId: string
  exerciseVersionId: string
  programRevisionId: string
  policyVersion: string
  sourceRevisionId: string
  effectiveFrom: string
  effectiveUntil: string
}

export interface RepRangeV1 {
  min: number
  max: number
}

export interface RirRangeV1 {
  min: number
  max: number
}

export interface ProgressionComparatorV1 {
  subjectId: string
  exerciseVersionId: string
  equipmentId: string
  loadBasis: EquipmentLoad['basis']
  side: string
  rom: string
  tempo: string
  prescribedWorkingSets: number
  repRange: RepRangeV1
  targetRir: RirRangeV1
  exposureType: string
  loadEpoch: number
}

export interface StrengthPrescriptionV1 extends Omit<ProgressionComparatorV1, 'subjectId'> {
  prescriptionId: string
  prescribedLoad: EquipmentLoad
}

export type ActualRirV1 = number | '6_plus' | 'unknown'

export interface StrengthActualSetV1 {
  setId: string
  ordinal: number
  kind: 'working' | 'warmup' | 'extra'
  actualReps: number
  actualRir: ActualRirV1
  load: EquipmentLoad
  symptom: 'none' | 'adverse'
  validity: 'valid' | 'invalid'
}

export interface OutlierAcknowledgementV1 {
  sourceRevisionId: string
  priorExposureRevisionId: string
  actualExposureRevisionId: string
}

export interface StrengthExposureV1 {
  sourceRevisionId: string
  executionContext: ExecutionContextV1
  provenance:
    | { kind: 'in_app'; sourceVersion: 'training-log.v1' }
    | { kind: 'recalled'; sourceVersion: 'athlete-recall.v1' }
    | { kind: 'imported'; sourceVersion: 'external-history-import.v1' }
  acceptedPrescription: {
    sourceRevisionId: string
    load: EquipmentLoad
  }
  sessionState: 'completed' | 'completed_with_omissions' | 'in_progress' | 'aborted'
  exerciseState: 'completed' | 'incomplete' | 'omitted' | 'aborted'
  syncState: 'acknowledged' | 'pending' | 'conflicted'
  startedAt: string
  completedAt: string | null
  omittedExerciseInstanceIds: string[]
  outlierAcknowledgement?: OutlierAcknowledgementV1
  comparator: ProgressionComparatorV1
  sets: StrengthActualSetV1[]
}

export interface StrengthProgressionInputV1 {
  policyVersion: 'strength-progression-v1'
  now: string
  executionContext: ExecutionContextV1
  subjectId: string
  sourceProfileRevisionId: string
  programRevisionId: string
  eligibility: EligibilitySnapshotV1
  eligibilityAuthorization?: ProgressionEligibilityAuthorizationV1
  prescription: StrengthPrescriptionV1
  equipmentInventory: EquipmentInventory
  exposures: StrengthExposureV1[]
}

export type ProgressionReasonV1 =
  | 'acute_stop'
  | 'eligibility_unanswered'
  | 'eligibility_review_required'
  | 'eligibility_scope_unavailable'
  | 'eligibility_source_unavailable'
  | 'eligibility_constraints_unavailable'
  | 'eligibility_constraints_blocked'
  | 'stale_session_review'
  | 'session_in_progress_hold'
  | 'session_aborted_hold'
  | 'exercise_incomplete_hold'
  | 'exercise_aborted_hold'
  | 'sync_pending_hold'
  | 'sync_conflict_hold'
  | 'adverse_symptom_hold'
  | 'invalid_log_hold'
  | 'unconfirmed_outlier_hold'
  | 'effort_unknown_hold'
  | 'effort_too_easy_recalibration'
  | 'mixed_working_load_review'
  | 'return_after_gap_review'
  | 'comparator_changed_recalibration'
  | 'calibration_required'
  | 'difficult_exposure_hold'
  | 'repeated_difficult_exposure_review'
  | 'insufficient_same_load_evidence_hold'
  | 'no_achievable_increment_within_cap'
  | 'one_rep_progression'
  | 'two_ceiling_successes'
  | 'valid_state_hold'

interface DecisionAuditV1 {
  kind: 'stop' | 'hold' | 'review' | 'recalibrate' | 'rep_proposal' | 'load_proposal'
  status: 'not_proposed' | 'proposed'
  policyVersion: 'strength-progression-v1'
  executionContext: ExecutionContextV1
  decisionKey: string
  subjectId: string
  prescriptionId: string
  exerciseVersionId: string
  equipmentId: string
  loadBasis: EquipmentLoad['basis']
  programRevisionId: string
  sourceProfileRevisionId: string
  sourceEligibilityRevisionId: string
  loadEpoch: number
  reasonCodes: ProgressionReasonV1[]
  sourceExposureRevisionIds: string[]
  sourceAcknowledgementRevisionIds: string[]
}

export interface NoChangeDecisionV1 extends DecisionAuditV1 {
  kind: 'stop' | 'hold' | 'review' | 'recalibrate'
  status: 'not_proposed'
}

export interface ProgressionProposalV1 extends DecisionAuditV1 {
  kind: 'rep_proposal' | 'load_proposal'
  status: 'proposed'
  proposal: {
    load: EquipmentLoad
    targetReps: number[]
  }
}

export type StrengthProgressionDecisionV1 = NoChangeDecisionV1 | ProgressionProposalV1
