-- Plan 2 T6 follow-up: sync thoracic-erector-spinae DB prose to the content file after the tight→weak role flip (migration 20260707010000 flipped the role but not the prose).

UPDATE muscle_imbalance_links
  SET rationale_text = 'When the upper trunk settles out of a stacked position, the thoracic erector spinae tend to lengthen and under-recruit rather than hold the mid-back extended, so the chest drifts into flexion and the ribcage sits forward of the pelvis. Building endurance and control in these mid-back extensors helps re-stack the upper trunk over the spine. Because the merged trunk-lean pattern can also present as a backward-arched trunk where these muscles read short instead, screening should confirm which way the mid-back sits before loading.'
  WHERE muscle_slug = 'thoracic-erector-spinae'
    AND imbalance_key = 'trunk_lean'
    AND role = 'weak';

UPDATE muscles
  SET screening_notes = 'Their tone varies with posture: in clients who sit with the chest pressed up and the upper back arched, they can be short and overactive, feeling like firm bands beside the spine. In a slouched or forward-settled trunk, the same muscles more often lengthen and under-recruit. Screening should read which way the mid-back sits, since easing length and tone suits the arched presentation while endurance work suits the lengthened one.'
  WHERE slug = 'thoracic-erector-spinae';
