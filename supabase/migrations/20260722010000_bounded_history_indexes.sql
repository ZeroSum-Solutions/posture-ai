-- PR-09: support the exact stable keyset ordering used by the active client
-- directory and completed assessment history endpoints. Both indexes are
-- additive, so the immediately prior deployed app remains compatible.

CREATE INDEX IF NOT EXISTS clients_active_practitioner_created_id_idx
  ON public.clients (practitioner_id, created_at DESC, id DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS assessments_complete_client_practitioner_assessed_id_idx
  ON public.assessments (client_id, practitioner_id, assessed_at DESC, id DESC)
  WHERE status = 'complete';
