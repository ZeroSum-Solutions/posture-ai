BEGIN;
SELECT no_plan();

CREATE TEMP TABLE conditioning_preference_profile(document jsonb);
INSERT INTO conditioning_preference_profile VALUES ('{
  "schemaVersion":"athlete-training-profile.v1",
  "origin":{"kind":"athlete_input"},
  "goal":"strength",
  "experience":"intermediate",
  "strengthProgrammingStyle":"repeatable",
  "recentConsistency":"consistent",
  "cycleLengthWeeks":8,
  "strengthDays":["monday","thursday"],
  "localTimezone":"UTC",
  "sessionTimeBudgetMinutes":45,
  "preferredLoadUnit":"kg",
  "equipmentInventory":[],
  "startingHistory":[]
}');

SELECT ok(
  private.is_valid_training_profile(document),
  'legacy profile without a conditioning preference remains valid'
) FROM conditioning_preference_profile;

SELECT ok(
  private.is_valid_training_profile(document || '{
    "conditioningPreference":{
      "schemaVersion":"conditioning-preference.v1",
      "catalogVersion":"authored-general.v1",
      "preferredModalityIds":["walking.v1","cycling.v1"]
    }
  }'),
  'ordered catalog-bound conditioning preference is valid'
) FROM conditioning_preference_profile;

SELECT ok(
  NOT private.is_valid_training_profile(document || '{
    "conditioningPreference":{
      "schemaVersion":"conditioning-preference.v1",
      "catalogVersion":"authored-general.v1",
      "preferredModalityIds":[]
    }
  }'),
  'conditioning preference requires at least one modality'
) FROM conditioning_preference_profile;

SELECT ok(
  NOT private.is_valid_training_profile(document || '{
    "conditioningPreference":{
      "schemaVersion":"conditioning-preference.v1",
      "catalogVersion":"authored-general.v1",
      "preferredModalityIds":["walking.v1","walking.v1"]
    }
  }'),
  'conditioning preference modality IDs are unique'
) FROM conditioning_preference_profile;

SELECT ok(
  NOT private.is_valid_training_profile(document || '{
    "conditioningPreference":{
      "schemaVersion":"conditioning-preference.v2",
      "catalogVersion":"authored-general.v1",
      "preferredModalityIds":["walking.v1"]
    }
  }'),
  'conditioning preference schema version is closed'
) FROM conditioning_preference_profile;

SELECT ok(
  NOT private.is_valid_training_profile(document || '{
    "conditioningPreference":{
      "schemaVersion":"conditioning-preference.v1",
      "catalogVersion":"invalid catalog id",
      "preferredModalityIds":["walking.v1"]
    }
  }'),
  'conditioning preference catalog version is a stable reference'
) FROM conditioning_preference_profile;

SELECT ok(
  NOT private.is_valid_training_profile(document || '{
    "conditioningPreference":{
      "schemaVersion":"conditioning-preference.v1",
      "catalogVersion":"authored-general.v1",
      "preferredModalityIds":["walking.v1"],
      "clientSelectedCatalog":true
    }
  }'),
  'conditioning preference rejects extra client-authored keys'
) FROM conditioning_preference_profile;

SELECT ok(
  NOT private.is_valid_training_profile(document || '{"conditioningPreference":null}'),
  'conditioning preference cannot be null'
) FROM conditioning_preference_profile;

SELECT * FROM finish();
ROLLBACK;
