import { z } from 'zod'
import { TrainingProgramRevisionV1Schema, TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

const projectionSchema = z.object({
  assignment: z.object({
    id: TrainingStableIdV1Schema,
    subject_id: z.string().uuid(),
    program_mode: z.enum(['self_directed', 'coach_assigned']),
    owning_practitioner_id: z.string().uuid().nullable(),
    simulation_run_id: z.string().uuid().nullable(),
    source_draft_id: z.string().uuid(),
    status: z.enum(['active', 'ended']),
    active_revision: z.number().int().positive(),
    revision: z.number().int().positive(),
    created_at: z.string(),
  }).strict(),
  program: TrainingProgramRevisionV1Schema,
}).strict()

export async function GET(_request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const { assignmentId } = await params
  if (!TrainingStableIdV1Schema.safeParse(assignmentId).success) return trainingJson({ error: 'invalid_program_id' }, 400)
  const { data, error } = await context.supabase.rpc('read_training_program_projection', { p_assignment_id: assignmentId })
  if (error) return trainingJson({ error: 'training_program_unavailable' }, 503)
  if (data === null) return trainingJson({ error: 'training_program_not_found' }, 404)
  const parsed = projectionSchema.safeParse(data)
  if (!parsed.success) return trainingJson({ error: 'training_program_unavailable' }, 503)
  const { assignment, program } = parsed.data
  if (assignment.id !== assignmentId || program.assignmentId !== assignmentId
    || program.subjectId !== assignment.subject_id || program.revisionNumber !== assignment.active_revision
    || program.programMode !== assignment.program_mode || program.owningPractitionerId !== assignment.owning_practitioner_id
    || (program.executionContext.kind === 'live'
      ? assignment.simulation_run_id !== null
      : program.executionContext.simulationRunId !== assignment.simulation_run_id)) {
    return trainingJson({ error: 'training_program_unavailable' }, 503)
  }
  return trainingJson({ schemaVersion: 'training-program-projection.v1', ...parsed.data })
}
