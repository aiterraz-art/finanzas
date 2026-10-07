-- Normaliza todos los RUT al formato 12345678-9 (sin puntos, con guion, K mayúscula),
-- fusiona los terceros que quedaron duplicados por diferencias de formato y deja un
-- trigger que normaliza en cada insert/update para que no vuelva a pasar.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_rut(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN k = '' THEN NULL
    WHEN length(k) < 2 THEN k
    ELSE left(k, length(k) - 1) || '-' || right(k, 1)
  END
  FROM (SELECT upper(regexp_replace(coalesce(value, ''), '[^0-9kK]', '', 'g')) AS k) normalized
$$;

-- 1. Terceros duplicados: el ganador es el activo, luego el con más facturas, luego el
--    que ya tenía el RUT bien formateado (viene del SII) y luego el más antiguo.
CREATE TEMP TABLE rut_merge ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    t.id,
    t.empresa_id,
    t.rut,
    t.created_at,
    t.archived_at,
    public.normalize_rut(t.rut) AS normalized_rut,
    (SELECT count(*) FROM public.facturas f WHERE f.tercero_id = t.id) AS invoice_count
  FROM public.terceros t
),
ranked AS (
  SELECT
    candidates.*,
    row_number() OVER (
      PARTITION BY empresa_id, normalized_rut
      ORDER BY (archived_at IS NULL) DESC, invoice_count DESC, (rut = normalized_rut) DESC, created_at
    ) AS position
  FROM candidates
)
SELECT loser.id AS loser_id, winner.id AS winner_id
FROM ranked loser
JOIN ranked winner
  ON winner.empresa_id = loser.empresa_id
 AND winner.normalized_rut = loser.normalized_rut
 AND winner.position = 1
WHERE loser.position > 1;

-- El ganador hereda el tipo (cliente + proveedor = ambos) y los datos de contacto que le falten.
UPDATE public.terceros winner
SET
  tipo = CASE
    WHEN winner.tipo = 'ambos' OR merged.tipos @> ARRAY['ambos'] THEN 'ambos'
    WHEN merged.tipos @> ARRAY['cliente'] AND merged.tipos @> ARRAY['proveedor'] THEN 'ambos'
    WHEN winner.tipo = 'cliente' AND merged.tipos @> ARRAY['proveedor'] THEN 'ambos'
    WHEN winner.tipo = 'proveedor' AND merged.tipos @> ARRAY['cliente'] THEN 'ambos'
    ELSE winner.tipo
  END,
  es_trabajador = coalesce(winner.es_trabajador, false) OR merged.es_trabajador,
  email = coalesce(nullif(trim(winner.email), ''), merged.email),
  telefono = coalesce(nullif(trim(winner.telefono), ''), merged.telefono),
  direccion = coalesce(nullif(trim(winner.direccion), ''), merged.direccion),
  updated_at = now()
FROM (
  SELECT
    m.winner_id,
    array_agg(DISTINCT l.tipo) AS tipos,
    bool_or(coalesce(l.es_trabajador, false)) AS es_trabajador,
    max(nullif(trim(l.email), '')) AS email,
    max(nullif(trim(l.telefono), '')) AS telefono,
    max(nullif(trim(l.direccion), '')) AS direccion
  FROM rut_merge m
  JOIN public.terceros l ON l.id = m.loser_id
  GROUP BY m.winner_id
) merged
WHERE winner.id = merged.winner_id;

UPDATE public.facturas t SET tercero_id = m.winner_id FROM rut_merge m WHERE t.tercero_id = m.loser_id;
UPDATE public.cheques_cartera t SET tercero_id = m.winner_id FROM rut_merge m WHERE t.tercero_id = m.loser_id;
UPDATE public.collection_events t SET tercero_id = m.winner_id FROM rut_merge m WHERE t.tercero_id = m.loser_id;
UPDATE public.collection_reminders t SET tercero_id = m.winner_id FROM rut_merge m WHERE t.tercero_id = m.loser_id;
UPDATE public.customer_advances t SET tercero_id = m.winner_id FROM rut_merge m WHERE t.tercero_id = m.loser_id;
UPDATE public.rendiciones t SET tercero_id = m.winner_id FROM rut_merge m WHERE t.tercero_id = m.loser_id;
UPDATE public.webpay_liquidaciones t SET tercero_id = m.winner_id FROM rut_merge m WHERE t.tercero_id = m.loser_id;

-- El duplicado ya no tiene nada colgando y no puede quedar archivado porque su RUT
-- normalizado chocaría con ux_terceros_empresa_rut, así que se elimina.
ALTER TABLE public.terceros DISABLE TRIGGER trg_prevent_delete_terceros;
DELETE FROM public.terceros t USING rut_merge m WHERE t.id = m.loser_id;
ALTER TABLE public.terceros ENABLE TRIGGER trg_prevent_delete_terceros;

-- 2. Normalizar el resto de las columnas de RUT.
UPDATE public.terceros SET rut = public.normalize_rut(rut) WHERE rut IS DISTINCT FROM public.normalize_rut(rut);
UPDATE public.facturas SET rut = public.normalize_rut(rut) WHERE rut IS NOT NULL AND rut IS DISTINCT FROM public.normalize_rut(rut);
UPDATE public.customer_advances SET rut = public.normalize_rut(rut) WHERE rut IS NOT NULL AND rut IS DISTINCT FROM public.normalize_rut(rut);
UPDATE public.rendition_advances SET rut = public.normalize_rut(rut) WHERE rut IS NOT NULL AND rut IS DISTINCT FROM public.normalize_rut(rut);
UPDATE public.cheques_cartera SET rut_librador = public.normalize_rut(rut_librador) WHERE rut_librador IS NOT NULL AND rut_librador IS DISTINCT FROM public.normalize_rut(rut_librador);
UPDATE public.empresas SET rut = public.normalize_rut(rut) WHERE rut IS NOT NULL AND rut IS DISTINCT FROM public.normalize_rut(rut);

-- 3. Normalizar siempre al guardar.
CREATE OR REPLACE FUNCTION public.normalize_rut_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'cheques_cartera' THEN
    NEW.rut_librador := public.normalize_rut(NEW.rut_librador);
  ELSIF TG_TABLE_NAME = 'terceros' THEN
    NEW.rut := coalesce(public.normalize_rut(NEW.rut), NEW.rut);
  ELSE
    NEW.rut := public.normalize_rut(NEW.rut);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_rut ON public.terceros;
CREATE TRIGGER trg_normalize_rut BEFORE INSERT OR UPDATE OF rut ON public.terceros
  FOR EACH ROW EXECUTE FUNCTION public.normalize_rut_column();

DROP TRIGGER IF EXISTS trg_normalize_rut ON public.facturas;
CREATE TRIGGER trg_normalize_rut BEFORE INSERT OR UPDATE OF rut ON public.facturas
  FOR EACH ROW EXECUTE FUNCTION public.normalize_rut_column();

DROP TRIGGER IF EXISTS trg_normalize_rut ON public.customer_advances;
CREATE TRIGGER trg_normalize_rut BEFORE INSERT OR UPDATE OF rut ON public.customer_advances
  FOR EACH ROW EXECUTE FUNCTION public.normalize_rut_column();

DROP TRIGGER IF EXISTS trg_normalize_rut ON public.rendition_advances;
CREATE TRIGGER trg_normalize_rut BEFORE INSERT OR UPDATE OF rut ON public.rendition_advances
  FOR EACH ROW EXECUTE FUNCTION public.normalize_rut_column();

DROP TRIGGER IF EXISTS trg_normalize_rut ON public.cheques_cartera;
CREATE TRIGGER trg_normalize_rut BEFORE INSERT OR UPDATE OF rut_librador ON public.cheques_cartera
  FOR EACH ROW EXECUTE FUNCTION public.normalize_rut_column();

DROP TRIGGER IF EXISTS trg_normalize_rut ON public.empresas;
CREATE TRIGGER trg_normalize_rut BEFORE INSERT OR UPDATE OF rut ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.normalize_rut_column();

COMMIT;
