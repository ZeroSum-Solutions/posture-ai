-- P4b: Muscle knowledge base — normalized tables behind the per-muscle pages.
-- Read-only reference data (like exercises/imbalance_definitions): public
-- SELECT via RLS, writes only through migrations/seed scripts (service role).
-- The tight_muscles/weak_muscles JSONB on imbalance_definitions stays in place
-- until all readers switch to muscle_imbalance_links (deprecated in a later
-- migration per the transition plan).

CREATE TABLE IF NOT EXISTS muscles (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('head_neck', 'shoulder_girdle', 'trunk', 'hip_pelvis', 'knee_leg')),
  anatomy_summary TEXT NOT NULL,
  function_text TEXT NOT NULL,
  screening_notes TEXT,
  image_path TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS muscle_imbalance_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muscle_slug TEXT NOT NULL REFERENCES muscles(slug) ON DELETE CASCADE,
  imbalance_key TEXT NOT NULL REFERENCES imbalance_definitions(key) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('tight', 'weak')),
  rationale_text TEXT NOT NULL,
  UNIQUE (muscle_slug, imbalance_key, role)
);

CREATE TABLE IF NOT EXISTS exercise_muscles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_slug TEXT NOT NULL REFERENCES muscles(slug) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('stretch', 'strengthen')),
  progression_level INT NOT NULL DEFAULT 2 CHECK (progression_level IN (1, 2, 3)),
  UNIQUE (exercise_id, muscle_slug, role)
);

CREATE INDEX IF NOT EXISTS idx_muscle_links_imbalance ON muscle_imbalance_links(imbalance_key);
CREATE INDEX IF NOT EXISTS idx_muscle_links_muscle ON muscle_imbalance_links(muscle_slug);
CREATE INDEX IF NOT EXISTS idx_exercise_muscles_muscle ON exercise_muscles(muscle_slug);
CREATE INDEX IF NOT EXISTS idx_exercise_muscles_exercise ON exercise_muscles(exercise_id);

ALTER TABLE muscles ENABLE ROW LEVEL SECURITY;
ALTER TABLE muscle_imbalance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_muscles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS muscles_read ON muscles;
CREATE POLICY muscles_read ON muscles FOR SELECT USING (true);

DROP POLICY IF EXISTS muscle_links_read ON muscle_imbalance_links;
CREATE POLICY muscle_links_read ON muscle_imbalance_links FOR SELECT USING (true);

DROP POLICY IF EXISTS exercise_muscles_read ON exercise_muscles;
CREATE POLICY exercise_muscles_read ON exercise_muscles FOR SELECT USING (true);
