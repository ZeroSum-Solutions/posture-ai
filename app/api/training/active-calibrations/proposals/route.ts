import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { CreateActiveCalibrationProposalInputV1Schema } from '@/lib/training/contracts/active-calibration-persistence'
import {
  ActiveCalibrationError,
  createStoredActiveCalibrationProposal,
  createSupabaseActiveCalibrationDependencies,
} from '@/lib/training/persistence/active-calibrations'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, CreateActiveCalibrationProposalInputV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await createStoredActiveCalibrationProposal(
      body.data,
      context.actor,
      createSupabaseActiveCalibrationDependencies(context.supabase, createSupabaseServiceClient()),
    ))
  } catch (error) {
    if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
    if (error instanceof ActiveCalibrationError) {
      if (error.code === 'active_calibration_forbidden') return trainingJson({ error: error.code }, 403)
      if (error.code === 'active_calibration_source_stale') {
        return trainingJson({ error: error.code, action: 'refresh_active_calibration' }, 409)
      }
      if (error.code === 'active_calibration_request_id_conflict') {
        return trainingJson({ error: error.code, action: 'refresh_active_calibration' }, 409)
      }
    }
    return trainingJson({ error: 'active_calibration_unavailable' }, 503)
  }
}
