-- Regulatory hardening: subject consent records (append-only), remote-consent
-- tokens, a minimal org/BAA gate, age/guardian + deletion support, and a
-- professional-review flag for exports. Additive + idempotent. No auto-mutating
-- triggers: consent writes and client deletion are explicit, testable API paths.
-- Consent hashes are computed in the app layer (Node crypto), so no pgcrypto here.

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE consent_method_enum AS ENUM ('e_signature', 'verbal', 'paper', 'remote_link');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE signer_relationship_enum AS ENUM ('self', 'parent', 'legal_guardian', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE consent_kind_enum AS ENUM ('enrollment', 'assessment_capture', 'data_sharing', 'revocation');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE baa_status_enum AS ENUM ('not_required', 'pending', 'signed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- 2. ORGANIZATIONS (minimal — HIPAA BAA gate; no multi-tenant roles)
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_covered_entity BOOLEAN NOT NULL DEFAULT false,
  baa_status baa_status_enum NOT NULL DEFAULT 'not_required',
  baa_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- ============================================================================
-- 3. CLIENTS: deletion (tombstone) support
-- ============================================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients(deleted_at);

-- ============================================================================
-- 4. ASSESSMENTS: professional-review gate
-- ============================================================================
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS practitioner_approved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS practitioner_approved_at TIMESTAMPTZ;

-- ============================================================================
-- 5. CONSENT RECORDS (append-only / immutable: SELECT + INSERT policies only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  assessment_id UUID REFERENCES assessments(id) ON DELETE SET NULL,
  kind consent_kind_enum NOT NULL DEFAULT 'enrollment',
  consent_version TEXT NOT NULL,
  consent_hash TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  signer_relationship signer_relationship_enum NOT NULL DEFAULT 'self',
  method consent_method_enum NOT NULL DEFAULT 'e_signature',
  jurisdiction TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_consent_records_client ON consent_records(client_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_practitioner ON consent_records(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_assessment ON consent_records(assessment_id);

-- ============================================================================
-- 6. CONSENT TOKENS (remote consent links; consumed once)
-- ============================================================================
CREATE TABLE IF NOT EXISTS consent_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  consent_version TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_tokens_token ON consent_tokens(token);
CREATE INDEX IF NOT EXISTS idx_consent_tokens_client ON consent_tokens(client_id);

-- ============================================================================
-- 7. CLIENT DELETION LOG (redacted legal tombstone — no PII)
-- ============================================================================
CREATE TABLE IF NOT EXISTS client_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_client_id UUID NOT NULL,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  assessments_purged INT NOT NULL DEFAULT 0,
  captures_purged INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_client_deletion_log_practitioner ON client_deletion_log(practitioner_id);

-- ============================================================================
-- 8. RLS + POLICIES
-- ============================================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_deletion_log ENABLE ROW LEVEL SECURITY;

-- Organizations: low-sensitivity config, readable by any authenticated user;
-- writes happen via service role only (no write policy).
DROP POLICY IF EXISTS organizations_read ON organizations;
CREATE POLICY organizations_read ON organizations FOR SELECT USING (true);

-- Consent records: practitioner can read + append their own; NO update/delete
-- policy → immutable for clients (service_role bypasses RLS for remote inserts
-- and deletion-time signer redaction).
DROP POLICY IF EXISTS consent_records_read_own ON consent_records;
CREATE POLICY consent_records_read_own ON consent_records FOR SELECT USING (practitioner_id = auth.uid());
DROP POLICY IF EXISTS consent_records_insert_own ON consent_records;
CREATE POLICY consent_records_insert_own ON consent_records FOR INSERT WITH CHECK (practitioner_id = auth.uid());

-- Consent tokens: practitioner manages their own; public verify uses service role.
DROP POLICY IF EXISTS consent_tokens_own ON consent_tokens;
CREATE POLICY consent_tokens_own ON consent_tokens FOR ALL USING (practitioner_id = auth.uid());

-- Deletion log: practitioner reads own (rows written via service role).
DROP POLICY IF EXISTS client_deletion_log_read_own ON client_deletion_log;
CREATE POLICY client_deletion_log_read_own ON client_deletion_log FOR SELECT USING (practitioner_id = auth.uid());

-- ============================================================================
-- 9. CAPTURES: enforce no raw image bytes are ever persisted at rest
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE captures ADD CONSTRAINT captures_no_image_bytes CHECK (storage_path IS NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- 10. SAFETY GRANTS (cloud gets these via default privileges; local CLI is
--     secure-by-default — mirror 20260612000000_role_grants.sql for new tables)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
