CREATE OR REPLACE VIEW public.v_bank_account_positions
WITH (security_invoker = true)
AS
WITH latest_balances AS (
  SELECT DISTINCT ON (mb.bank_account_id)
    mb.bank_account_id,
    mb.empresa_id,
    mb.fecha_movimiento,
    mb.saldo
  FROM public.movimientos_banco mb
  LEFT JOIN public.bank_statement_imports bsi
    ON bsi.id = mb.import_id
  WHERE mb.bank_account_id IS NOT NULL
    AND mb.saldo IS NOT NULL
  ORDER BY
    mb.bank_account_id,
    mb.fecha_movimiento DESC,
    bsi.imported_at DESC NULLS LAST,
    CASE WHEN mb.import_id IS NOT NULL THEN mb.id_secuencial END ASC NULLS LAST,
    mb.created_at DESC,
    mb.id_secuencial DESC NULLS LAST
),
unreconciled AS (
  SELECT
    bank_account_id,
    COUNT(*) FILTER (WHERE estado = 'no_conciliado') AS unreconciled_count,
    COALESCE(SUM(ABS(monto)) FILTER (WHERE estado = 'no_conciliado'), 0) AS unreconciled_amount,
    MAX(fecha_movimiento) AS latest_statement_date
  FROM public.movimientos_banco
  WHERE bank_account_id IS NOT NULL
  GROUP BY bank_account_id
)
SELECT
  ba.empresa_id,
  ba.id AS bank_account_id,
  ba.nombre AS account_name,
  ba.banco,
  ba.tipo,
  ba.moneda,
  COALESCE(u.latest_statement_date, lb.fecha_movimiento, ba.saldo_inicial_fecha) AS latest_statement_date,
  COALESCE(lb.saldo, ba.saldo_inicial, 0) AS current_balance,
  (
    CURRENT_DATE - COALESCE(u.latest_statement_date, lb.fecha_movimiento, ba.saldo_inicial_fecha)
  ) > COALESCE(tp.stale_bank_import_days, 3) AS stale_import,
  COALESCE(u.unreconciled_count, 0)::integer AS unreconciled_count,
  COALESCE(u.unreconciled_amount, 0)::numeric(14,2) AS unreconciled_amount
FROM public.bank_accounts ba
LEFT JOIN latest_balances lb ON lb.bank_account_id = ba.id
LEFT JOIN unreconciled u ON u.bank_account_id = ba.id
LEFT JOIN public.treasury_policies tp ON tp.empresa_id = ba.empresa_id
WHERE ba.activa;
