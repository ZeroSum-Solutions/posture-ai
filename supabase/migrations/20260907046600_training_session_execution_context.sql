-- The session player needs authoritative provenance before a prescription starts.
-- This remains SECURITY INVOKER: every selected row is constrained by existing RLS.
CREATE OR REPLACE FUNCTION public.read_training_session_projection(p_session_id text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object(
  'session',pg_catalog.to_jsonb(session),
  'executionContext',COALESCE(
    (SELECT prescription_json->'executionContext'
      FROM public.training_session_prescriptions WHERE session_id=session.id),
    (SELECT revision.program_json->'executionContext'
      FROM public.training_program_assignments assignment
      JOIN public.training_program_revisions revision
        ON revision.assignment_id=assignment.id
        AND revision.revision_number=assignment.active_revision
        AND revision.subject_id=session.subject_id
      WHERE assignment.id=session.assignment_id AND assignment.subject_id=session.subject_id)
  ),
  'prescription',(SELECT prescription_json FROM public.training_session_prescriptions WHERE session_id=session.id),
  'currentActuals',COALESCE((SELECT pg_catalog.jsonb_agg(actual.event_json ORDER BY actual.set_id)
    FROM public.training_current_set_actuals actual WHERE actual.session_id=session.id),'[]'::jsonb),
  'currentConditioningActual',(SELECT event_json FROM public.training_conditioning_log_events
    WHERE session_id=session.id ORDER BY event_revision DESC LIMIT 1)
 ) FROM public.training_sessions session WHERE session.id=p_session_id;
$$;
