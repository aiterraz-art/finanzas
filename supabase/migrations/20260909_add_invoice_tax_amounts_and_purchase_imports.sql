ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS monto_exento NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS monto_neto NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS monto_iva NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS origen_importacion TEXT;

ALTER TABLE public.invoice_import_runs
  DROP CONSTRAINT IF EXISTS invoice_import_runs_source_kind_check;

ALTER TABLE public.invoice_import_runs
  ADD CONSTRAINT invoice_import_runs_source_kind_check
  CHECK (source_kind IN ('issued', 'receivables', 'purchases'));

CREATE INDEX IF NOT EXISTS idx_facturas_empresa_fecha_emision_tipo
ON public.facturas (empresa_id, fecha_emision, tipo)
WHERE archived_at IS NULL;
