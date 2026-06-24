/**
 * Database migration runner - applies schema and seed data on startup
 * Uses pg direct connection (bypasses PostgREST limitations for DDL)
 */

const INITIAL_SCHEMA_SQL = `
DO $$ BEGIN CREATE TYPE sex_at_birth_enum AS ENUM ('male', 'female', 'other', 'prefer_not_to_say'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE assessment_status_enum AS ENUM ('processing', 'complete', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE zone_enum AS ENUM ('maintain', 'warning', 'danger', 'unreliable'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE view_enum AS ENUM ('front', 'side', 'back', 'front_back', 'transverse'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE exercise_category_enum AS ENUM ('stretch', 'strengthen', 'mobility', 'activation', 'informational'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE overall_grade_enum AS ENUM ('S', 'A', 'B', 'C', 'D', 'E'); EXCEPTION WHEN duplicate_object THEN null; END $$;

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
CREATE INDEX IF NOT EXISTS idx_clients_practitioner ON clients(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_assessments_practitioner ON assessments(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_assessments_client ON assessments(client_id);
CREATE INDEX IF NOT EXISTS idx_findings_practitioner ON assessment_findings(practitioner_id, imbalance_key);
CREATE INDEX IF NOT EXISTS idx_captures_assessment ON captures(assessment_id);
CREATE INDEX IF NOT EXISTS idx_reports_practitioner ON reports(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_exercise_recs_assessment ON exercise_recommendations(assessment_id);
ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE imbalance_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_recommendations ENABLE ROW LEVEL SECURITY;
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
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN INSERT INTO practitioners (id, display_name, created_at, updated_at) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), now(), now()) ON CONFLICT (id) DO NOTHING; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE handle_new_user();
`

const SEED_DATA_SQL = `
INSERT INTO imbalance_definitions (key, region, label, default_view, standard_value, unit, threshold_config, causes_text, tight_muscles, weak_muscles) VALUES
('forward_head_posture','head_shoulders','Forward Head Posture','side',0,'deg','{"warning_start":5,"danger_start":15,"max_severity_dev":30}','Prolonged neck flexion (phone/desk), monitor positioned too low, loss of the normal cervical curve.','["suboccipitals","upper trapezius","levator scapulae","sternocleidomastoid"]','["deep cervical flexors","lower trapezius"]'),
('anterior_imbalanced_shoulders','head_shoulders','Anterior Imbalanced Shoulders','front',0,'deg','{"warning_start":3,"danger_start":8,"max_severity_dev":20}','Leaning the upper body to one side, carrying a bag on one side, desk work, press-dominant training.','["pectoralis major","pectoralis minor","anterior deltoid","upper trapezius"]','["rhomboids","middle trapezius","lower trapezius","serratus anterior"]'),
('posterior_imbalanced_shoulders','head_shoulders','Posterior Imbalanced Shoulders','front',0,'deg','{"warning_start":3,"danger_start":8,"max_severity_dev":20}','Shoulder hiking, one-sided load carrying, chronic upper-trap tension.','["upper trapezius","levator scapulae"]','["lower trapezius"]'),
('t1_tilt_backward','spine','T1 Tilt Backward','side',0,'deg','{"warning_start":5,"danger_start":15,"max_severity_dev":30}','Repeatedly bending the spine backward, inability to stay upright when seated, poor seated support.','["thoracic erector spinae","latissimus dorsi"]','["deep thoracic flexors","abdominals"]'),
('pelvic_obliquity','pelvis','Pelvic Obliquity','front',0,'deg','{"warning_start":3,"danger_start":8,"max_severity_dev":20}','Crossing the legs, prolonged sedentary posture, asymmetric weight-bearing, leg-length difference.','["quadratus lumborum","adductors (elevated side)","opposite gluteus medius"]','["gluteus medius (elevated side)"]'),
('anterior_pelvic_shift','pelvis','Anterior Pelvic Shift','side',0,'deg','{"warning_start":5,"danger_start":12,"max_severity_dev":25}','Wearing high heels for long periods, excess abdominal weight, prolonged standing sway.','["hip flexors","lumbar erector spinae","gastrocnemius"]','["gluteals","hamstrings","abdominals"]'),
('pelvic_axial_rotation','pelvis','Pelvic Axial Rotation','transverse',0,'deg','{"warning_start":5,"danger_start":12,"max_severity_dev":25}','Crossing the legs, one-sided sports/loading, sedentary asymmetry.','["one-side hip rotators","obliques"]','["opposite obliques","gluteals"]'),
('genu_varum_valgum_left','leg','Knee Alignment (Left)','front',0,'deg','{"warning_start":5,"danger_start":12,"max_severity_dev":25}','Bow-legged or knock-kneed gait habits, cross-legged sitting, footwear.','["tensor fasciae latae","IT band","lateral structures (varum) or adductors (valgum)"]','["gluteus medius","vastus medialis (VMO)"]'),
('genu_varum_valgum_right','leg','Knee Alignment (Right)','front',0,'deg','{"warning_start":5,"danger_start":12,"max_severity_dev":25}','Bow-legged or knock-kneed gait habits, cross-legged sitting, footwear.','["tensor fasciae latae","IT band","lateral structures (varum) or adductors (valgum)"]','["gluteus medius","vastus medialis (VMO)"]'),
('knee_extension_back_knee','leg','Knee Extension / Back Knee','side',0,'deg','{"warning_start":5,"danger_start":12,"max_severity_dev":25}','Wearing high heels, joint hyperlaxity, abdominal weight shifting the center of mass backward.','["quadriceps","gastrocnemius"]','["hamstrings","popliteus"]')
ON CONFLICT (key) DO NOTHING;

INSERT INTO exercises (slug, name, category, primary_deviation_keys, min_zone, instructions, sets, hold_seconds) VALUES
('chin-tucks','Chin Tucks','strengthen',ARRAY['forward_head_posture'],'warning','Stand or sit tall. Gently retract your chin straight back, making a double chin. Hold 5 seconds, then release. Repeat.',3,5),
('neck-lateral-stretch','Neck Lateral Stretch','stretch',ARRAY['forward_head_posture'],'maintain','Tilt your head to one side, ear toward shoulder. Gently apply light pressure with your hand. Hold 20-30 seconds. Repeat on the other side.',3,20),
('thoracic-extension','Thoracic Extension on Foam Roller','mobility',ARRAY['t1_tilt_backward','forward_head_posture'],'warning','Place a foam roller perpendicular to your spine at mid-back. Support your head with your hands. Extend back over the roller gently. Move slowly up and down the thoracic spine.',2,30),
('wall-angels','Wall Angels','strengthen',ARRAY['anterior_imbalanced_shoulders','posterior_imbalanced_shoulders'],'maintain','Stand with your back flat against a wall, arms bent at 90 degrees in contact with the wall. Slowly slide your arms up and down like making a snow angel, keeping full contact with the wall.',3,10),
('doorway-pec-stretch','Doorway Pec Stretch','stretch',ARRAY['anterior_imbalanced_shoulders'],'maintain','Stand in a doorway. Place your forearm on the door frame with elbow at 90 degrees. Step forward gently until you feel a stretch across your chest. Hold 20-30 seconds. Repeat both sides.',3,20),
('kneeling-hip-flexor-stretch','Kneeling Hip Flexor Stretch','stretch',ARRAY['anterior_pelvic_shift','pelvic_obliquity'],'warning','Kneel with one knee on the ground and the other foot forward (lunge position). Shift your hips forward until you feel a stretch in the front of the hip. Keep your back straight. Hold 20-30 seconds. Repeat both sides.',3,20),
('glute-bridge','Glute Bridge','strengthen',ARRAY['anterior_pelvic_shift','knee_extension_back_knee'],'maintain','Lie on your back with knees bent and feet flat on the floor. Squeeze your glutes and drive your hips up until your body forms a straight line from knees to shoulders. Hold 2 seconds at the top. Lower slowly.',3,2),
('clamshell','Clamshell Exercise','strengthen',ARRAY['pelvic_obliquity','genu_varum_valgum_left','genu_varum_valgum_right'],'warning','Lie on your side with knees stacked and bent at 45 degrees. Keeping your feet together, open your top knee upward like a clamshell. Pause, then lower slowly. Repeat on both sides.',3,5),
('single-leg-balance','Single Leg Balance','activation',ARRAY['pelvic_obliquity','genu_varum_valgum_left','genu_varum_valgum_right'],'warning','Stand on one foot with a slight bend in the knee. Maintain your balance for 30 seconds. Keep your hips level. Progress to eyes closed for added challenge. Repeat on both sides.',3,30),
('standing-hamstring-curl','Standing Hamstring Curl','strengthen',ARRAY['knee_extension_back_knee'],'warning','Stand holding a wall or chair for balance. Slowly curl one heel up toward your glutes against gravity. Hold briefly at the top, then lower with control. Keep your thighs parallel.',3,5)
ON CONFLICT (slug) DO NOTHING;
`

// 20260623000000 — report/program dosage fields + priority/capability persistence.
const REPORT_FIELDS_SQL = `
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS reps_min INT,
  ADD COLUMN IF NOT EXISTS reps_max INT,
  ADD COLUMN IF NOT EXISTS dosage_type TEXT,
  ADD COLUMN IF NOT EXISTS is_integrative BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS priority_keys TEXT[],
  ADD COLUMN IF NOT EXISTS capability TEXT NOT NULL DEFAULT 'standard';
UPDATE exercises e SET
  dosage_type = v.dosage_type, reps_min = v.reps_min, reps_max = v.reps_max, is_integrative = v.is_integrative
FROM (VALUES
  ('chin-tucks','dynamic',10,15,false),
  ('neck-lateral-stretch','hold',NULL,NULL,false),
  ('thoracic-extension','dynamic',8,10,false),
  ('wall-angels','dynamic',10,15,true),
  ('doorway-pec-stretch','hold',NULL,NULL,false),
  ('kneeling-hip-flexor-stretch','hold',NULL,NULL,false),
  ('glute-bridge','dynamic',10,15,false),
  ('clamshell','dynamic',10,15,false),
  ('single-leg-balance','dynamic',10,15,false),
  ('standing-hamstring-curl','dynamic',10,15,false)
) AS v(slug, dosage_type, reps_min, reps_max, is_integrative)
WHERE e.slug = v.slug;
`

export async function applyMigrations(): Promise<void> {
  const dbUrl = process.env.SUPABASE_DB_URL
  if (!dbUrl) {
    console.error('[migrations] No SUPABASE_DB_URL set, skipping')
    return
  }

  let client: InstanceType<typeof import('pg').Client> | undefined
  try {
    // Dynamic import to avoid bundler issues
    const pg = await import('pg')
    const Client = pg.default?.Client || pg.Client
    client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    await client.connect()
    console.log('[migrations] Connected to Postgres')

    await client.query(INITIAL_SCHEMA_SQL)
    console.log('[migrations] ✅ Schema applied (20260101000000)')

    await client.query(SEED_DATA_SQL)
    console.log('[migrations] ✅ Seed data applied (20260101000001)')

    await client.query(REPORT_FIELDS_SQL)
    console.log('[migrations] ✅ Report dosage fields applied (20260623000000)')

  } catch (err) {
    console.error('[migrations] Failed:', err instanceof Error ? err.message : err)
  } finally {
    if (client) {
      try { await client.end() } catch {}
    }
  }
}
