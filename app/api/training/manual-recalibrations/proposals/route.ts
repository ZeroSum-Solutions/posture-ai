import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { CreateManualRecalibrationProposalInputV1Schema } from '@/lib/training/contracts/manual-recalibration-persistence'
import {
  ManualRecalibrationError,
  createStoredManualRecalibrationProposal,
  createSupabaseManualRecalibrationDependencies,
} from '@/lib/training/persistence/manual-recalibrations'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, CreateManualRecalibrationProposalInputV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await createStoredManualRecalibrationProposal(
      body.data,
      context.actor,
      createSupabaseManualRecalibrationDependencies(context.supabase, createSupabaseServiceClient()),
    ))
  } catch (error) {
    if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
    if (error instanceof ManualRecalibrationError) {
      if (error.code === 'manual_recalibration_forbidden') return trainingJson({ error: error.code }, 403)
      if (error.code === 'manual_recalibration_source_stale') {
        return trainingJson({ error: error.code, action: 'refresh_manual_recalibration' }, 409)
      }
      if (error.code === 'manual_recalibration_request_id_conflict') {
        return trainingJson({ error: error.code, action: 'refresh_manual_recalibration' }, 409)
      }
    }
    return trainingJson({ error: 'manual_recalibration_unavailable' }, 503)
  }
}
