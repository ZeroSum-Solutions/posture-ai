import { z } from 'zod'
import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

const summarySchema = z.object({
  id: TrainingStableIdV1Schema,
  subject_id: z.string().uuid(),
  program_mode: z.enum(['self_directed', 'coach_assigned']),
  simulation_run_id: z.string().uuid().nullable(),
  status: z.enum(['active', 'ended']),
  created_at: z.string(),
  training_sessions: z.array(z.object({
    id: TrainingStableIdV1Schema,
    session_kind: z.enum(['strength', 'conditioning']),
    state: z.enum(['scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted']),
    scheduled_local_date: z.string(),
    athlete_timezone: z.string(),
    revision: z.number().int().positive(),
  }).strict()).max(100),
}).strict()

export async function GET(request: Request) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const query = new URL(request.url).searchParams
  if (query.size !== 1 || query.getAll('subjectId').length !== 1) return trainingJson({ error: 'invalid_training_query' }, 400)
  const subject = z.string().uuid().safeParse(query.get('subjectId'))
  if (!subject.success) return trainingJson({ error: 'invalid_subject_id' }, 400)
  // One authenticated PostgREST statement. RLS applies independently to assignments
  // and nested sessions; no service role or client-supplied ownership assertion.
  const { data, error } = await context.supabase.from('training_program_assignments')
    .select('id,subject_id,program_mode,simulation_run_id,status,created_at,training_sessions(id,session_kind,state,scheduled_local_date,athlete_timezone,revision)')
    .eq('subject_id', subject.data).order('created_at', { ascending: false }).limit(20)
  if (error) return trainingJson({ error: 'training_programs_unavailable' }, 503)
  const parsed = z.array(summarySchema).max(20).safeParse(data)
  if (!parsed.success || parsed.data.some(item => item.subject_id !== subject.data)) return trainingJson({ error: 'training_programs_unavailable' }, 503)
  return trainingJson({
    schemaVersion: 'training-program-list.v1', subjectId: subject.data,
    programs: parsed.data.map(({ training_sessions, ...assignment }) => ({
      ...assignment,
      sessions: [...training_sessions].sort((a, b) => a.scheduled_local_date.localeCompare(b.scheduled_local_date) || a.id.localeCompare(b.id)),
    })),
  })
}
