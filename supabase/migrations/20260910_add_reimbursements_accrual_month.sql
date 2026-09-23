-- Las rendiciones conciliadas son gasto en P/L cuando no están cubiertas por una factura de compra vinculada.
-- Para el histórico, se usa inicialmente el mes del pago bancario como mes de devengo.
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
  AND tc.code = 'reimbursements'
  AND cc.status = 'paid'
  AND cc.accrual_month IS NULL
  AND COALESCE(
    (SELECT mb.fecha_movimiento FROM public.movimientos_banco AS mb WHERE mb.id = cc.movimiento_banco_id),
    cc.expected_date,
    cc.due_date
  ) IS NOT NULL;
