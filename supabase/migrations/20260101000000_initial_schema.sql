
-- ENUMS
DO $$ BEGIN CREATE TYPE sex_at_birth_enum AS ENUM ('male', 'female', 'other', 'prefer_not_to_say'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE assessment_status_enum AS ENUM ('processing', 'complete', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE zone_enum AS ENUM ('maintain', 'warning', 'danger', 'unreliable'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE view_enum AS ENUM ('front', 'side', 'back', 'front_back', 'transverse'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE exercise_category_enum AS ENUM ('stretch', 'strengthen', 'mobility', 'activation', 'informational'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE overall_grade_enum AS ENUM ('S', 'A', 'B', 'C', 'D', 'E'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- TABLES
CREATE TABLE IF NOT EXISTS practitioners (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  practice_name TEXT,
  logo_storage_path TEXT,
  non_diagnostic_ack_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  sex_at_birth sex_at_birth_enum,
  height_cm NUMERIC,
  weight_kg NUMERIC,
  notes TEXT,
  consent_recorded_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  assessed_at TIMESTAMPTZ DEFAULT now(),
  status assessment_status_enum NOT NULL DEFAULT 'processing',
  scoring_engine_version TEXT,
  overall_score NUMERIC,
  overall_grade overall_grade_enum,
  overall_percentile NUMERIC,
  front_rank INT,
  side_rank INT,
  assessment_type TEXT DEFAULT 'static',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessment_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  imbalance_key TEXT NOT NULL,
  region TEXT,
  label TEXT,
  deviation NUMERIC,
  standard NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'deg',
  direction TEXT,
  severity_pct NUMERIC,
  zone zone_enum,
  view_used view_enum,
  confidence NUMERIC,
  UNIQUE(assessment_id, imbalance_key)
);

CREATE TABLE IF NOT EXISTS captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  view view_enum NOT NULL,
  storage_path TEXT,
  source TEXT DEFAULT 'upload',
  width_px INT,
  height_px INT,
  pose_frame JSONB,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  storage_path TEXT,
  generated_at TIMESTAMPTZ DEFAULT now(),
  compared_to_assessment_id UUID REFERENCES assessments(id)
);

CREATE TABLE IF NOT EXISTS imbalance_definitions (
  key TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  label TEXT NOT NULL,
  default_view view_enum NOT NULL,
  standard_value NUMERIC DEFAULT 0,
  unit TEXT DEFAULT 'deg',
  threshold_config JSONB,
  causes_text TEXT,
  tight_muscles JSONB,
  weak_muscles JSONB
);

CREATE TABLE IF NOT EXISTS exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category exercise_category_enum NOT NULL,
  primary_deviation_keys TEXT[],
  min_zone zone_enum DEFAULT 'warning',
  instructions TEXT,
  sets INT,
  hold_seconds INT,
  video_url TEXT
);

CREATE TABLE IF NOT EXISTS exercise_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  triggering_imbalance_key TEXT,
  sort_order INT DEFAULT 0,
  UNIQUE(assessment_id, exercise_id)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_clients_practitioner ON clients(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_assessments_practitioner ON assessments(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_assessments_client ON assessments(client_id);
CREATE INDEX IF NOT EXISTS idx_findings_practitioner ON assessment_findings(practitioner_id, imbalance_key);
CREATE INDEX IF NOT EXISTS idx_captures_assessment ON captures(assessment_id);
CREATE INDEX IF NOT EXISTS idx_reports_practitioner ON reports(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_exercise_recs_assessment ON exercise_recommendations(assessment_id);

-- RLS
ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE imbalance_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_recommendations ENABLE ROW LEVEL SECURITY;

-- POLICIES
DROP POLICY IF EXISTS practitioners_self ON practitioners;
CREATE POLICY practitioners_self ON practitioners FOR ALL USING (id = auth.uid());

DROP POLICY IF EXISTS clients_own ON clients;
CREATE POLICY clients_own ON clients FOR ALL USING (practitioner_id = auth.uid());

DROP POLICY IF EXISTS assessments_own ON assessments;
CREATE POLICY assessments_own ON assessments FOR ALL USING (practitioner_id = auth.uid());

DROP POLICY IF EXISTS findings_own ON assessment_findings;
CREATE POLICY findings_own ON assessment_findings FOR ALL USING (practitioner_id = auth.uid());

DROP POLICY IF EXISTS captures_own ON captures;
CREATE POLICY captures_own ON captures FOR ALL USING (practitioner_id = auth.uid());

DROP POLICY IF EXISTS reports_own ON reports;
CREATE POLICY reports_own ON reports FOR ALL USING (practitioner_id = auth.uid());

DROP POLICY IF EXISTS recommendations_own ON exercise_recommendations;
CREATE POLICY recommendations_own ON exercise_recommendations FOR ALL USING (practitioner_id = auth.uid());

DROP POLICY IF EXISTS imbalance_defs_read ON imbalance_definitions;
CREATE POLICY imbalance_defs_read ON imbalance_definitions FOR SELECT USING (true);

DROP POLICY IF EXISTS exercises_read ON exercises;
CREATE POLICY exercises_read ON exercises FOR SELECT USING (true);

-- TRIGGER
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO practitioners (id, display_name, created_at, updated_at)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), now(), now())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();
