ALTER TABLE public.movimientos_banco
ADD COLUMN IF NOT EXISTS entrada_banco NUMERIC(12,2);

ALTER TABLE public.movimientos_banco
ADD COLUMN IF NOT EXISTS salida_banco NUMERIC(12,2);

ALTER TABLE public.movimientos_banco
ADD COLUMN IF NOT EXISTS comentario_tesoreria TEXT;

ALTER TABLE public.movimientos_banco
ADD COLUMN IF NOT EXISTS tipo_conciliacion TEXT;

-- Backfill desde monto para datos antiguos
UPDATE public.movimientos_banco
SET entrada_banco = CASE WHEN monto > 0 THEN monto ELSE 0 END,
    salida_banco = CASE WHEN monto < 0 THEN ABS(monto) ELSE 0 END
WHERE entrada_banco IS NULL OR salida_banco IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'movimientos_banco_tipo_conciliacion_check'
      AND conrelid = 'public.movimientos_banco'::regclass
  ) THEN
    ALTER TABLE public.movimientos_banco
    ADD CONSTRAINT movimientos_banco_tipo_conciliacion_check
    CHECK (tipo_conciliacion IS NULL OR tipo_conciliacion IN ('factura','rendicion','remuneraciones','otros_egresos'));
  END IF;
END $$;
