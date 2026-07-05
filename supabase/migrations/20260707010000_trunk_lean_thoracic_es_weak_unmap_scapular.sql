-- Plan 2 Task 6: coherence gate fixes
-- (1) Flip thoracic-erector-spinae trunk_lean role tight→weak (Park 2015 PMID 25463688
--     — reduced EMG in slouched sitting confirms inhibited/weak classification).
-- (2) Unmap high-band-pull-apart from trunk_lean (pure scapular-retractor work; stays
--     coherent on posterior_imbalanced_shoulders via lower-trapezius).

UPDATE muscle_imbalance_links SET role = 'weak'
WHERE muscle_slug = 'thoracic-erector-spinae' AND imbalance_key = 'trunk_lean' AND role = 'tight';

UPDATE exercises SET primary_deviation_keys = array_remove(primary_deviation_keys, 'trunk_lean')
WHERE slug = 'high-band-pull-apart';
