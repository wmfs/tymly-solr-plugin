-- tymly_fullReindex_1_0 used to be allowed for every logged-in user ($authenticated).
-- It's now only for tymly_solrAdmin, but Tymly never deletes permission rows when restrictions change,
-- so remove the old row here. Safe to run on every boot: it does nothing once the row is gone.
DO $$
BEGIN
  IF to_regclass('tymly.permission') IS NOT NULL THEN
    DELETE FROM tymly.permission
    WHERE state_machine_name = 'tymly_fullReindex_1_0'
      AND role_id = '$authenticated';
  END IF;
END
$$;
