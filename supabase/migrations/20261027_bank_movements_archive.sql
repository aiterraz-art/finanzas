-- Los movimientos bancarios no se borran (trigger prevent_delete_permanent_record):
-- se archivan para sacarlos de la conciliación sin perder el historial.
ALTER TABLE public.movimientos_banco
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_movimientos_banco_archived_at
ON public.movimientos_banco (empresa_id, archived_at);
