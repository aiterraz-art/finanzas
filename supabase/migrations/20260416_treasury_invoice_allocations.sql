DROP VIEW IF EXISTS public.v_treasury_open_items;
CREATE VIEW public.v_treasury_open_items
WITH (security_invoker = true)
AS
WITH linked_allocations AS (
  SELECT
    linked.factura_id,
    SUM(linked.monto_aplicado)::numeric(14,2) AS allocated_amount
  FROM (
    SELECT
      fp.factura_id,
      fp.monto_aplicado AS monto_aplicado
    FROM public.facturas_pagos fp
    WHERE fp.factura_id IS NOT NULL
      AND fp.estado = 'aplicado'

    UNION ALL

    SELECT
      ch.factura_id,
      ch.monto_aplicado_factura AS monto_aplicado
    FROM public.cheques_cartera ch
    WHERE ch.factura_id IS NOT NULL
      AND ch.estado IN ('en_cartera', 'depositado', 'cobrado')

    UNION ALL

    SELECT
      wp.factura_id,
      wp.monto_aplicado_factura AS monto_aplicado
    FROM public.webpay_liquidaciones wp
    WHERE wp.factura_id IS NOT NULL
      AND wp.estado IN ('pendiente', 'conciliado')
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
  GREATEST(f.monto - COALESCE(la.allocated_amount, 0), 0)::numeric(14,2) AS amount,
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
LEFT JOIN linked_allocations la ON la.factura_id = f.id
WHERE f.tipo = 'venta'
  AND f.estado IN ('pendiente', 'morosa', 'abonada')
  AND GREATEST(f.monto - COALESCE(la.allocated_amount, 0), 0) > 0

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
  GREATEST(f.monto - COALESCE(la.allocated_amount, 0), 0)::numeric(14,2) AS amount,
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
LEFT JOIN linked_allocations la ON la.factura_id = f.id
WHERE f.tipo = 'compra'
  AND f.estado IN ('pendiente', 'morosa', 'abonada')
  AND GREATEST(f.monto - COALESCE(la.allocated_amount, 0), 0) > 0

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

CREATE OR REPLACE FUNCTION public.get_collection_pipeline(p_empresa_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  factura_id uuid,
  tercero_id uuid,
  tercero_nombre text,
  numero_documento text,
  amount numeric,
  due_date date,
  expected_date date,
  confidence_pct smallint,
  days_overdue integer,
  last_contact_at timestamptz,
  promised_payment_date date,
  last_event_type text,
  responsible_email text,
  disputed boolean,
  suggested_next_action text
)
LANGUAGE sql
AS $$
  WITH last_events AS (
    SELECT DISTINCT ON (ce.factura_id)
      ce.factura_id,
      ce.event_type,
      ce.happened_at,
      ce.promised_date,
      p.email AS responsible_email
    FROM public.collection_events ce
    LEFT JOIN public.profiles p ON p.id = ce.created_by
    WHERE ce.empresa_id = p_empresa_id
    ORDER BY ce.factura_id, ce.happened_at DESC
  ),
  linked_allocations AS (
    SELECT
      linked.factura_id,
      SUM(linked.monto_aplicado)::numeric(14,2) AS allocated_amount
    FROM (
      SELECT fp.factura_id, fp.monto_aplicado AS monto_aplicado
      FROM public.facturas_pagos fp
      WHERE fp.factura_id IS NOT NULL
        AND fp.estado = 'aplicado'

      UNION ALL

      SELECT ch.factura_id, ch.monto_aplicado_factura AS monto_aplicado
      FROM public.cheques_cartera ch
      WHERE ch.factura_id IS NOT NULL
        AND ch.estado IN ('en_cartera', 'depositado', 'cobrado')

      UNION ALL

      SELECT wp.factura_id, wp.monto_aplicado_factura AS monto_aplicado
      FROM public.webpay_liquidaciones wp
      WHERE wp.factura_id IS NOT NULL
        AND wp.estado IN ('pendiente', 'conciliado')
    ) AS linked
    GROUP BY linked.factura_id
  )
  SELECT
    f.id AS factura_id,
    f.tercero_id,
    COALESCE(f.tercero_nombre, 'Sin cliente') AS tercero_nombre,
    COALESCE(f.numero_documento, '') AS numero_documento,
    GREATEST(f.monto - COALESCE(la.allocated_amount, 0), 0)::numeric(14,2) AS amount,
    COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) AS due_date,
    COALESCE(f.planned_cash_date, f.promised_payment_date, f.fecha_vencimiento, f.fecha_emision + 30) AS expected_date,
    CASE
      WHEN COALESCE(f.disputed, false) THEN 0
      WHEN f.promised_payment_date IS NOT NULL AND f.promised_payment_date < COALESCE(p_as_of, CURRENT_DATE) THEN GREATEST(COALESCE(f.cash_confidence_pct, 60) - 20, 10)
      ELSE COALESCE(f.cash_confidence_pct, 60)
    END::smallint AS confidence_pct,
    GREATEST(COALESCE(p_as_of, CURRENT_DATE) - COALESCE(f.fecha_vencimiento, f.fecha_emision + 30), 0)::integer AS days_overdue,
    COALESCE(f.last_collection_contact_at, le.happened_at) AS last_contact_at,
    COALESCE(f.promised_payment_date, le.promised_date) AS promised_payment_date,
    le.event_type AS last_event_type,
    le.responsible_email,
    COALESCE(f.disputed, false) AS disputed,
    CASE
      WHEN COALESCE(f.disputed, false) THEN 'Resolver disputa'
      WHEN COALESCE(f.promised_payment_date, le.promised_date) IS NOT NULL
        AND COALESCE(f.promised_payment_date, le.promised_date) < COALESCE(p_as_of, CURRENT_DATE) THEN 'Reactivar promesa vencida'
      WHEN COALESCE(f.last_collection_contact_at, le.happened_at) IS NULL THEN 'Gestionar hoy'
      WHEN COALESCE(f.last_collection_contact_at, le.happened_at) < (COALESCE(p_as_of, CURRENT_DATE)::timestamp - INTERVAL '7 days') THEN 'Seguimiento urgente'
      WHEN COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) < COALESCE(p_as_of, CURRENT_DATE) THEN 'Contactar cliente'
      ELSE 'Monitorear'
    END AS suggested_next_action
  FROM public.facturas f
  LEFT JOIN last_events le ON le.factura_id = f.id
  LEFT JOIN linked_allocations la ON la.factura_id = f.id
  WHERE f.empresa_id = p_empresa_id
    AND f.tipo = 'venta'
    AND f.estado IN ('pendiente', 'morosa', 'abonada')
    AND GREATEST(f.monto - COALESCE(la.allocated_amount, 0), 0) > 0;
$$;

CREATE OR REPLACE FUNCTION public.get_treasury_kpis(p_empresa_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  current_cash numeric,
  free_cash_next_7d numeric,
  min_projected_cash numeric,
  min_projected_week date,
  due_outflows_next_7d numeric,
  expected_inflows_next_7d numeric,
  overdue_receivables numeric,
  taxes_due_next_14d numeric,
  payroll_due_next_14d numeric,
  stale_bank_accounts_count integer,
  missing_forecast_data_count integer
)
LANGUAGE sql
AS $$
  WITH forecast AS (
    SELECT * FROM public.get_treasury_forecast(p_empresa_id, COALESCE(p_as_of, CURRENT_DATE), 13)
  ),
  positions AS (
    SELECT
      COALESCE(SUM(current_balance), 0)::numeric(14,2) AS current_cash,
      COUNT(*) FILTER (WHERE stale_import)::integer AS stale_count
    FROM public.v_bank_account_positions
    WHERE empresa_id = p_empresa_id
  ),
  next_7d AS (
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END), 0)::numeric(14,2) AS outflows,
      COALESCE(SUM(CASE WHEN direction = 'inflow' THEN ROUND(amount * confidence_pct / 100.0, 2) ELSE 0 END), 0)::numeric(14,2) AS inflows,
      COALESCE(SUM(CASE WHEN direction = 'outflow' AND priority IN ('critical', 'high') THEN amount ELSE 0 END), 0)::numeric(14,2) AS protected_outflows
    FROM public.v_treasury_open_items
    WHERE empresa_id = p_empresa_id
      AND expected_date BETWEEN COALESCE(p_as_of, CURRENT_DATE) AND COALESCE(p_as_of, CURRENT_DATE) + 6
  ),
  overdue AS (
    SELECT COALESCE(SUM(amount), 0)::numeric(14,2) AS overdue_receivables
    FROM public.v_treasury_open_items
    WHERE empresa_id = p_empresa_id
      AND source_type = 'invoice_receivable'
      AND due_date < COALESCE(p_as_of, CURRENT_DATE)
  ),
  future_obligations AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE category_code = 'taxes'), 0)::numeric(14,2) AS taxes_due,
      COALESCE(SUM(amount) FILTER (WHERE category_code = 'payroll'), 0)::numeric(14,2) AS payroll_due
    FROM public.v_treasury_open_items
    WHERE empresa_id = p_empresa_id
      AND direction = 'outflow'
      AND expected_date BETWEEN COALESCE(p_as_of, CURRENT_DATE) AND COALESCE(p_as_of, CURRENT_DATE) + 13
  ),
  forecast_min AS (
    SELECT
      MIN(closing_cash)::numeric(14,2) AS min_cash
    FROM forecast
  ),
  forecast_min_week AS (
    SELECT week_start
    FROM forecast
    ORDER BY closing_cash ASC, week_start ASC
    LIMIT 1
  ),
  missing AS (
    SELECT (
      COALESCE((SELECT COUNT(*) FROM public.facturas WHERE empresa_id = p_empresa_id AND estado IN ('pendiente', 'morosa', 'abonada') AND (planned_cash_date IS NULL OR treasury_category_id IS NULL)), 0)
      + COALESCE((SELECT COUNT(*) FROM public.rendiciones WHERE empresa_id = p_empresa_id AND estado = 'pendiente' AND (planned_cash_date IS NULL OR treasury_category_id IS NULL)), 0)
      + COALESCE((SELECT COUNT(*) FROM public.cash_commitments WHERE empresa_id = p_empresa_id AND status IN ('planned', 'confirmed', 'deferred') AND expected_date IS NULL), 0)
    )::integer AS missing_count
  )
  SELECT
    positions.current_cash,
    (positions.current_cash - next_7d.protected_outflows)::numeric(14,2) AS free_cash_next_7d,
    COALESCE(forecast_min.min_cash, positions.current_cash) AS min_projected_cash,
    forecast_min_week.week_start AS min_projected_week,
    next_7d.outflows AS due_outflows_next_7d,
    next_7d.inflows AS expected_inflows_next_7d,
    overdue.overdue_receivables,
    future_obligations.taxes_due AS taxes_due_next_14d,
    future_obligations.payroll_due AS payroll_due_next_14d,
    positions.stale_count AS stale_bank_accounts_count,
    missing.missing_count AS missing_forecast_data_count
  FROM positions
  CROSS JOIN next_7d
  CROSS JOIN overdue
  CROSS JOIN future_obligations
  CROSS JOIN forecast_min
  CROSS JOIN forecast_min_week
  CROSS JOIN missing;
$$;

GRANT SELECT ON public.v_treasury_open_items TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_collection_pipeline(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_treasury_kpis(uuid, date) TO authenticated;
