-- Ordered playback writes: the client stamps each run PATCH with a monotonically
-- increasing revision (seeded from the resumed row). The route drops any patch
-- whose revision is <= the stored one, and a newer revision replaces the item
-- flags verbatim — so Back/replay can un-complete an item without an
-- out-of-order or duplicate request resurrecting stale state.
alter table session_runs
  add column if not exists revision integer not null default 0;
