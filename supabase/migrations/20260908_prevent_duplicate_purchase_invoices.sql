-- A supplier invoice folio can be registered once per company. Existing records
-- are preserved; the trigger only prevents future duplicate inserts or key edits.
CREATE OR REPLACE FUNCTION public.prevent_duplicate_purchase_invoice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tipo <> 'compra'
    OR NEW.tercero_id IS NULL
    OR NULLIF(trim(COALESCE(NEW.numero_documento, '')), '') IS NULL
    OR NEW.estado = 'archivada' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.facturas existing
    WHERE existing.empresa_id = NEW.empresa_id
      AND existing.tipo = 'compra'
      AND existing.tercero_id = NEW.tercero_id
      AND existing.estado IS DISTINCT FROM 'archivada'
      AND upper(regexp_replace(COALESCE(existing.numero_documento, ''), '[^A-Za-z0-9]', '', 'g')) =
          upper(regexp_replace(COALESCE(NEW.numero_documento, ''), '[^A-Za-z0-9]', '', 'g'))
      AND existing.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Ya existe una factura de compra con este folio para el proveedor'
      USING ERRCODE = '23505', CONSTRAINT = 'ux_facturas_compra_proveedor_folio';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_purchase_invoice ON public.facturas;

CREATE TRIGGER trg_prevent_duplicate_purchase_invoice
BEFORE INSERT OR UPDATE OF empresa_id, tipo, tercero_id, numero_documento, estado
ON public.facturas
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_purchase_invoice();
