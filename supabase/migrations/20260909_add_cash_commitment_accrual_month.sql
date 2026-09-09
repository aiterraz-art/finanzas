ALTER TABLE public.cash_commitments
ADD COLUMN IF NOT EXISTS accrual_month DATE;

CREATE INDEX IF NOT EXISTS idx_cash_commitments_empresa_accrual_month
ON public.cash_commitments(empresa_id, accrual_month)
WHERE accrual_month IS NOT NULL;

-- Los pagos históricos se asignan inicialmente al mes de su pago bancario.
-- Se pueden corregir posteriormente si el servicio correspondía a otro mes.
UPDATE public.cash_commitments AS cc
SET accrual_month = date_trunc(
  'month',
  COALESCE(
    (SELECT mb.fecha_movimiento FROM public.movimientos_banco AS mb WHERE mb.id = cc.movimiento_banco_id),
    cc.expected_date,
    cc.due_date
  )
)::date
FROM public.treasury_categories AS tc
WHERE tc.id = cc.category_id
  AND tc.code IN ('payroll', 'professional_fees')
  AND cc.status = 'paid'
  AND cc.accrual_month IS NULL
  AND COALESCE(
    (SELECT mb.fecha_movimiento FROM public.movimientos_banco AS mb WHERE mb.id = cc.movimiento_banco_id),
    cc.expected_date,
    cc.due_date
  ) IS NOT NULL;
