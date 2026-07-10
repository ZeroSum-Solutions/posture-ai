-- Cross-finding contraindications for the DB-fed exercise bank.
--
-- Exercise selection ORs over a priority's finding keys, so an exercise coherent for
-- finding A can still reach a client who also presents finding B. `primary_deviation_keys`
-- alone cannot express that. This column mirrors ExerciseContent.contraindicatedDeviationKeys
-- (content/ is the source of truth; scripts/generate-muscle-seed.ts emits it from now on)
-- so DB-fed surfaces read the same safety data the TS program builder enforces.
--
-- Forward-only: this runs after every existing seed (latest is 20260708090000), so a
-- future re-seed inserts the column value directly and `supabase db reset` stays correct.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS contraindicated_deviation_keys TEXT[];

COMMENT ON COLUMN exercises.contraindicated_deviation_keys IS
  'Imbalance keys that make this exercise unsafe even when primary_deviation_keys also matches. Applied as an exclusion pass over the client''s whole screened finding set.';

-- Backfill: seated-hamstring-stretch was re-homed to trunk_lean only (20260708000000
-- removed its knee pairing; 20260708080000 re-inserted it for trunk_lean). In a
-- hyperextended knee the hamstrings are already abnormally long (Zwick 2010, PMID 20308923),
-- so a client presenting BOTH trunk_lean and knee_extension_back_knee must not receive it.
UPDATE exercises
   SET contraindicated_deviation_keys = ARRAY['knee_extension_back_knee']
 WHERE slug = 'seated-hamstring-stretch';
