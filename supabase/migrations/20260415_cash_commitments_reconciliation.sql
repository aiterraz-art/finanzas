ALTER TABLE public.cash_commitments
ADD COLUMN IF NOT EXISTS movimiento_banco_id uuid NULL REFERENCES public.movimientos_banco(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS estado_previo_conciliacion text NULL
CHECK (estado_previo_conciliacion IN ('planned', 'confirmed', 'paid', 'cancelled', 'deferred'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_commitments_movimiento_banco_id
ON public.cash_commitments (movimiento_banco_id)
WHERE movimiento_banco_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_commitments_empresa_bank_status
ON public.cash_commitments (empresa_id, bank_account_id, status, expected_date);
