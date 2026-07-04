-- Public-read bucket for exercise demo media ({slug}/loop.mp4, {slug}/poster.webp).
-- No storage RLS policies are added: public=true serves reads via the public URL,
-- and with no INSERT/UPDATE policies only the service role can write (upload
-- script in scripts/upload-exercise-media.mjs) — same sole-writer posture as the
-- regulated tables.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exercise-media',
  'exercise-media',
  true,
  26214400, -- 25 MB per object
  array['video/mp4', 'image/webp', 'image/png', 'image/jpeg', 'image/gif']
)
on conflict (id) do nothing;
