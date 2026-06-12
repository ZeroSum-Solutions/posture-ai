// Renders the typed content files into an idempotent SQL seed for the muscle
// knowledge base. Output goes to stdout; redirect into a migration file:
//   npx vite-node scripts/generate-muscle-seed.ts > supabase/migrations/<ts>_muscle_kb_seed.sql
import { ALL_MUSCLES, ALL_EXERCISES } from '../content/index'

const q = (s: string | null) => (s === null ? 'NULL' : `'${s.replace(/'/g, "''")}'`)

const lines: string[] = []
lines.push('-- AUTO-GENERATED from content/ by scripts/generate-muscle-seed.ts — regenerate, do not hand-edit.')
lines.push('')

// muscles
for (const m of ALL_MUSCLES) {
  lines.push(
    `INSERT INTO muscles (slug, name, region, anatomy_summary, function_text, screening_notes, reviewed_by, reviewed_at) VALUES (` +
      [q(m.slug), q(m.name), q(m.region), q(m.anatomySummary), q(m.functionText), q(m.screeningNotes), q(m.reviewedBy), m.reviewedAt ? q(m.reviewedAt) : 'NULL'].join(', ') +
      `)\nON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, region = EXCLUDED.region, anatomy_summary = EXCLUDED.anatomy_summary, function_text = EXCLUDED.function_text, screening_notes = EXCLUDED.screening_notes, updated_at = now();`
  )
}
lines.push('')

// links: full refresh (content is the source of truth)
lines.push('DELETE FROM muscle_imbalance_links;')
for (const m of ALL_MUSCLES) {
  for (const l of m.links) {
    lines.push(
      `INSERT INTO muscle_imbalance_links (muscle_slug, imbalance_key, role, rationale_text) VALUES (` +
        [q(m.slug), q(l.imbalanceKey), q(l.role), q(l.rationale)].join(', ') +
        `);`
    )
  }
}
lines.push('')

// exercises (upsert by slug, keep ids stable for exercise_recommendations FKs)
for (const e of ALL_EXERCISES) {
  lines.push(
    `INSERT INTO exercises (slug, name, category, primary_deviation_keys, min_zone, instructions, sets, hold_seconds) VALUES (` +
      [
        q(e.slug), q(e.name), q(e.category),
        `ARRAY[${e.primaryDeviationKeys.map(k => q(k)).join(', ')}]`,
        q(e.minZone), q(e.instructions), String(e.sets), String(e.holdSeconds),
      ].join(', ') +
      `)\nON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, primary_deviation_keys = EXCLUDED.primary_deviation_keys, min_zone = EXCLUDED.min_zone, instructions = EXCLUDED.instructions, sets = EXCLUDED.sets, hold_seconds = EXCLUDED.hold_seconds;`
  )
}
lines.push('')

// exercise_muscles: full refresh keyed through slugs
lines.push('DELETE FROM exercise_muscles;')
for (const e of ALL_EXERCISES) {
  for (const m of e.muscles) {
    lines.push(
      `INSERT INTO exercise_muscles (exercise_id, muscle_slug, role, progression_level) SELECT id, ${q(m.muscleSlug)}, ${q(m.role)}, ${m.progressionLevel} FROM exercises WHERE slug = ${q(e.slug)};`
    )
  }
}

console.log(lines.join('\n'))
