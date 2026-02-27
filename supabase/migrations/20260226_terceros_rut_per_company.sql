DO $$
DECLARE idx RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.terceros'::regclass
      AND contype = 'u'
      AND conname = 'terceros_rut_key'
  ) THEN
    ALTER TABLE public.terceros DROP CONSTRAINT terceros_rut_key;
  END IF;

  FOR idx IN
    SELECT i.indexname
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'terceros'
      AND i.indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND i.indexdef ILIKE '%(rut)%'
      AND i.indexdef NOT ILIKE '%empresa_id%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx.indexname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_terceros_empresa_rut
ON public.terceros (empresa_id, rut);
