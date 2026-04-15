ALTER TABLE public.cash_commitments
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_cash_commitments_archived_at
ON public.cash_commitments (empresa_id, archived_at);

DROP VIEW IF EXISTS public.v_treasury_open_items;
CREATE VIEW public.v_treasury_open_items
WITH (security_invoker = true)
AS
WITH instrument_allocations AS (
  SELECT
    linked.factura_id,
    SUM(linked.monto_aplicado_factura)::numeric(14,2) AS allocated_amount
  FROM (
    SELECT
      factura_id,
      monto_aplicado_factura
    FROM public.cheques_cartera
    WHERE factura_id IS NOT NULL
      AND estado IN ('en_cartera', 'depositado', 'cobrado')

    UNION ALL

    SELECT
      factura_id,
      monto_aplicado_factura
    FROM public.webpay_liquidaciones
    WHERE factura_id IS NOT NULL
      AND estado IN ('pendiente', 'conciliado')
  ) AS linked
  GROUP BY linked.factura_id
)
SELECT
  'invoice_receivable'::text AS source_type,
  f.id AS source_id,
  f.empresa_id,
  COALESCE(f.preferred_bank_account_id, ba.id) AS bank_account_id,
  'inflow'::text AS direction,
  COALESCE(f.tercero_nombre, 'Sin cliente') AS counterparty,
  COALESCE(tc.code, 'sales') AS category_code,
  COALESCE(tc.nombre, 'Ventas') AS category_name,
  GREATEST(f.monto - COALESCE(ia.allocated_amount, 0), 0)::numeric(14,2) AS amount,
  COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) AS due_date,
  COALESCE(f.planned_cash_date, f.promised_payment_date, f.fecha_vencimiento, f.fecha_emision + 30) AS expected_date,
  CASE
    WHEN COALESCE(f.disputed, false) THEN 0
    WHEN f.promised_payment_date IS NOT NULL AND f.promised_payment_date < CURRENT_DATE THEN GREATEST(COALESCE(f.cash_confidence_pct, 60) - 20, 10)
    ELSE COALESCE(f.cash_confidence_pct, 60)
  END::smallint AS confidence_pct,
  COALESCE(f.treasury_priority, 'high') AS priority,
  f.estado AS status,
  GREATEST(CURRENT_DATE - COALESCE(f.fecha_vencimiento, f.fecha_emision + 30), 0)::integer AS aging_days,
  COALESCE(f.blocked_reason, CASE WHEN COALESCE(f.disputed, false) THEN 'Factura en disputa' END) AS notes
FROM public.facturas f
LEFT JOIN public.treasury_categories tc ON tc.id = f.treasury_category_id
LEFT JOIN public.bank_accounts ba ON ba.empresa_id = f.empresa_id AND ba.es_principal
LEFT JOIN instrument_allocations ia ON ia.factura_id = f.id
WHERE f.tipo = 'venta'
  AND f.estado IN ('pendiente', 'morosa')
  AND GREATEST(f.monto - COALESCE(ia.allocated_amount, 0), 0) > 0

UNION ALL

SELECT
  'invoice_payable'::text AS source_type,
  f.id AS source_id,
  f.empresa_id,
  COALESCE(f.preferred_bank_account_id, ba.id) AS bank_account_id,
  'outflow'::text AS direction,
  COALESCE(f.tercero_nombre, 'Sin proveedor') AS counterparty,
  COALESCE(tc.code, 'suppliers') AS category_code,
  COALESCE(tc.nombre, 'Proveedores') AS category_name,
  f.monto::numeric(14,2) AS amount,
  COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) AS due_date,
  COALESCE(f.planned_cash_date, f.fecha_vencimiento, f.fecha_emision + 30) AS expected_date,
  100::smallint AS confidence_pct,
  COALESCE(f.treasury_priority, 'normal') AS priority,
  f.estado AS status,
  GREATEST(CURRENT_DATE - COALESCE(f.fecha_vencimiento, f.fecha_emision + 30), 0)::integer AS aging_days,
  f.blocked_reason AS notes
FROM public.facturas f
LEFT JOIN public.treasury_categories tc ON tc.id = f.treasury_category_id
LEFT JOIN public.bank_accounts ba ON ba.empresa_id = f.empresa_id AND ba.es_principal
WHERE f.tipo = 'compra'
  AND f.estado IN ('pendiente', 'morosa')

UNION ALL

SELECT
  'rendicion'::text AS source_type,
  r.id AS source_id,
  r.empresa_id,
  COALESCE(r.preferred_bank_account_id, ba.id) AS bank_account_id,
  'outflow'::text AS direction,
  COALESCE(r.tercero_nombre, 'Sin responsable') AS counterparty,
  COALESCE(tc.code, 'other_outflow') AS category_code,
  COALESCE(tc.nombre, 'Otros Egresos') AS category_name,
  r.monto_total::numeric(14,2) AS amount,
  COALESCE(r.fecha, (r.created_at AT TIME ZONE 'UTC')::date + 7) AS due_date,
  COALESCE(r.planned_cash_date, r.fecha, (r.created_at AT TIME ZONE 'UTC')::date + 7) AS expected_date,
  100::smallint AS confidence_pct,
  COALESCE(r.treasury_priority, 'high') AS priority,
  r.estado AS status,
  GREATEST(CURRENT_DATE - COALESCE(r.fecha, (r.created_at AT TIME ZONE 'UTC')::date + 7), 0)::integer AS aging_days,
  NULL::text AS notes
FROM public.rendiciones r
LEFT JOIN public.treasury_categories tc ON tc.id = r.treasury_category_id
LEFT JOIN public.bank_accounts ba ON ba.empresa_id = r.empresa_id AND ba.es_principal
WHERE r.estado = 'pendiente'

UNION ALL

SELECT
  'commitment'::text AS source_type,
  cc.id AS source_id,
  cc.empresa_id,
  cc.bank_account_id,
  cc.direction,
  COALESCE(cc.counterparty, cc.description) AS counterparty,
  tc.code AS category_code,
  tc.nombre AS category_name,
  cc.amount::numeric(14,2) AS amount,
  cc.due_date,
  cc.expected_date,
  CASE WHEN cc.direction = 'inflow' THEN 70 ELSE 100 END::smallint AS confidence_pct,
  cc.priority,
  cc.status,
  GREATEST(CURRENT_DATE - cc.due_date, 0)::integer AS aging_days,
  cc.notes
FROM public.cash_commitments cc
JOIN public.treasury_categories tc ON tc.id = cc.category_id
WHERE cc.status IN ('planned', 'confirmed', 'deferred')
  AND cc.archived_at IS NULL

UNION ALL

SELECT
  'cheque_receivable'::text AS source_type,
  ch.id AS source_id,
  ch.empresa_id,
  COALESCE(ch.bank_account_id, ba.id) AS bank_account_id,
  'inflow'::text AS direction,
  COALESCE(ch.librador, 'Cheque recibido') AS counterparty,
  COALESCE(tc.code, 'checks_in_transit') AS category_code,
  COALESCE(tc.nombre, 'Cheques en cartera') AS category_name,
  ch.monto::numeric(14,2) AS amount,
  ch.fecha_vencimiento AS due_date,
  ch.fecha_cobro_esperada AS expected_date,
  100::smallint AS confidence_pct,
  CASE
    WHEN ch.fecha_vencimiento < CURRENT_DATE THEN 'critical'
    ELSE 'high'
  END::text AS priority,
  ch.estado AS status,
  GREATEST(CURRENT_DATE - ch.fecha_vencimiento, 0)::integer AS aging_days,
  ch.notas AS notes
FROM public.cheques_cartera ch
LEFT JOIN public.treasury_categories tc
  ON tc.empresa_id = ch.empresa_id
 AND tc.code = 'checks_in_transit'
LEFT JOIN public.bank_accounts ba ON ba.empresa_id = ch.empresa_id AND ba.es_principal
WHERE ch.estado IN ('en_cartera', 'depositado')

UNION ALL

SELECT
  'webpay_receivable'::text AS source_type,
  wp.id AS source_id,
  wp.empresa_id,
  COALESCE(wp.bank_account_id, ba.id) AS bank_account_id,
  'inflow'::text AS direction,
  COALESCE(t.razon_social, f.tercero_nombre, 'WebPay pendiente') AS counterparty,
  COALESCE(tc.code, 'webpay_settlements') AS category_code,
  COALESCE(tc.nombre, 'Abonos WebPay') AS category_name,
  wp.monto_neto::numeric(14,2) AS amount,
  wp.fecha_abono_esperada AS due_date,
  wp.fecha_abono_esperada AS expected_date,
  95::smallint AS confidence_pct,
  'high'::text AS priority,
  wp.estado AS status,
  GREATEST(CURRENT_DATE - wp.fecha_abono_esperada, 0)::integer AS aging_days,
  wp.notas AS notes
FROM public.webpay_liquidaciones wp
LEFT JOIN public.facturas f ON f.id = wp.factura_id
LEFT JOIN public.terceros t ON t.id = wp.tercero_id
LEFT JOIN public.treasury_categories tc
  ON tc.empresa_id = wp.empresa_id
 AND tc.code = 'webpay_settlements'
LEFT JOIN public.bank_accounts ba ON ba.empresa_id = wp.empresa_id AND ba.es_principal
WHERE wp.estado = 'pendiente';

GRANT SELECT ON public.v_treasury_open_items TO authenticated;
