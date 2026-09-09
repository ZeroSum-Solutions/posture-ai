# Training reference library

`wger-english-2026-09-08.json` is a pinned metadata snapshot from the official
wger `exerciseinfo` API. Each retained record has an English name and instruction,
an attributable CC BY-SA 3.0 or 4.0 license, and exact source IDs and links.

The snapshot strips HTML, remote links inside instructions, control characters,
and application-prohibited clinical vocabulary. It keeps only records with at
least 80 characters of usable instruction, deduplicates normalized names, and
balances the source categories so the checked-in file remains practical to load.
Per-record author and license attribution remain visible in the application.

These records are an unreviewed reference library. They are not members of
`TrainingCatalogV1`, are never compiler eligible, and carry no exercise-technique,
clinical, or suitability approval. The base snapshot has no external media. The
separate `wger-1652-media-pilot-2026-09-08.json` supplement adds one original,
attributed CC BY-SA 4.0 image to the exact Wger 1652 reference record while keeping
that record unreviewed and compiler-ineligible. An exercise enters a live program
only through the separately reviewed authored training catalog required by the
strength-and-conditioning PRD.
