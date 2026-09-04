-- Credit notes remain as their own accounting documents. Their value is deducted
-- from the referenced invoice balance instead of changing the invoice's original amount.
ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS factura_referencia_id UUID REFERENCES public.facturas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_facturas_credit_note_reference
  ON public.facturas (empresa_id, factura_referencia_id)
  WHERE tipo = 'nota_credito' AND factura_referencia_id IS NOT NULL;

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
    SELECT linked.factura_id, SUM(linked.monto_aplicado)::numeric(14,2) AS allocated_amount
    FROM (
      SELECT fp.factura_id, fp.monto_aplicado
      FROM public.facturas_pagos fp
      WHERE fp.factura_id IS NOT NULL AND fp.estado = 'aplicado'
      UNION ALL
      SELECT ch.factura_id, ch.monto_aplicado_factura
      FROM public.cheques_cartera ch
      WHERE ch.factura_id IS NOT NULL AND ch.estado IN ('en_cartera', 'depositado', 'cobrado')
      UNION ALL
      SELECT wp.factura_id, wp.monto_aplicado_factura
      FROM public.webpay_liquidaciones wp
      WHERE wp.factura_id IS NOT NULL AND wp.estado IN ('pendiente', 'conciliado')
    ) AS linked
    GROUP BY linked.factura_id
  ),
  credit_note_allocations AS (
    SELECT nc.factura_referencia_id AS factura_id, SUM(nc.monto)::numeric(14,2) AS credit_note_amount
    FROM public.facturas nc
    WHERE nc.empresa_id = p_empresa_id
      AND nc.tipo = 'nota_credito'
      AND nc.factura_referencia_id IS NOT NULL
      AND nc.estado IS DISTINCT FROM 'archivada'
    GROUP BY nc.factura_referencia_id
  )
  SELECT
    f.id,
    f.tercero_id,
    COALESCE(f.tercero_nombre, 'Sin cliente'),
    COALESCE(f.numero_documento, ''),
    GREATEST(f.monto - COALESCE(la.allocated_amount, 0) - COALESCE(cna.credit_note_amount, 0), 0)::numeric(14,2),
    COALESCE(f.fecha_vencimiento, f.fecha_emision + 30),
    COALESCE(f.planned_cash_date, f.promised_payment_date, f.fecha_vencimiento, f.fecha_emision + 30),
    CASE
      WHEN COALESCE(f.disputed, false) THEN 0
      WHEN f.promised_payment_date IS NOT NULL AND f.promised_payment_date < COALESCE(p_as_of, CURRENT_DATE) THEN GREATEST(COALESCE(f.cash_confidence_pct, 60) - 20, 10)
      ELSE COALESCE(f.cash_confidence_pct, 60)
    END::smallint,
    GREATEST(COALESCE(p_as_of, CURRENT_DATE) - COALESCE(f.fecha_vencimiento, f.fecha_emision + 30), 0)::integer,
    COALESCE(f.last_collection_contact_at, le.happened_at),
    COALESCE(f.promised_payment_date, le.promised_date),
    le.event_type,
    le.responsible_email,
    COALESCE(f.disputed, false),
    CASE
      WHEN COALESCE(f.disputed, false) THEN 'Resolver disputa'
      WHEN COALESCE(f.promised_payment_date, le.promised_date) IS NOT NULL
        AND COALESCE(f.promised_payment_date, le.promised_date) < COALESCE(p_as_of, CURRENT_DATE) THEN 'Reactivar promesa vencida'
      WHEN COALESCE(f.last_collection_contact_at, le.happened_at) IS NULL THEN 'Gestionar hoy'
      WHEN COALESCE(f.last_collection_contact_at, le.happened_at) < (COALESCE(p_as_of, CURRENT_DATE)::timestamp - INTERVAL '7 days') THEN 'Seguimiento urgente'
      WHEN COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) < COALESCE(p_as_of, CURRENT_DATE) THEN 'Contactar cliente'
      ELSE 'Monitorear'
    END
  FROM public.facturas f
  LEFT JOIN last_events le ON le.factura_id = f.id
  LEFT JOIN linked_allocations la ON la.factura_id = f.id
  LEFT JOIN credit_note_allocations cna ON cna.factura_id = f.id
  WHERE f.empresa_id = p_empresa_id
    AND f.tipo = 'venta'
    AND f.estado IN ('pendiente', 'morosa', 'abonada')
    AND GREATEST(f.monto - COALESCE(la.allocated_amount, 0) - COALESCE(cna.credit_note_amount, 0), 0) > 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_collection_pipeline(uuid, date) TO authenticated;
