CREATE TABLE IF NOT EXISTS public.cheques_cartera (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  tercero_id UUID REFERENCES public.terceros(id) ON DELETE SET NULL,
  factura_id UUID REFERENCES public.facturas(id) ON DELETE SET NULL,
  movimiento_banco_id UUID REFERENCES public.movimientos_banco(id) ON DELETE SET NULL,
  numero_cheque TEXT NOT NULL,
  banco_emisor TEXT,
  librador TEXT NOT NULL,
  rut_librador TEXT,
  moneda TEXT NOT NULL DEFAULT 'CLP',
  monto NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  monto_aplicado_factura NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monto_aplicado_factura >= 0),
  fecha_emision DATE,
  fecha_vencimiento DATE NOT NULL,
  fecha_cobro_esperada DATE NOT NULL,
  fecha_cobro_real DATE,
  estado TEXT NOT NULL CHECK (estado IN ('en_cartera', 'depositado', 'cobrado', 'rechazado', 'anulado')),
  notas TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (monto_aplicado_factura <= monto)
);

CREATE INDEX IF NOT EXISTS idx_cheques_cartera_empresa_estado_fecha
ON public.cheques_cartera (empresa_id, estado, fecha_cobro_esperada);

CREATE INDEX IF NOT EXISTS idx_cheques_cartera_factura
ON public.cheques_cartera (factura_id)
WHERE factura_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cheques_cartera_movimiento
ON public.cheques_cartera (movimiento_banco_id)
WHERE movimiento_banco_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.webpay_liquidaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  tercero_id UUID REFERENCES public.terceros(id) ON DELETE SET NULL,
  factura_id UUID REFERENCES public.facturas(id) ON DELETE SET NULL,
  movimiento_banco_id UUID REFERENCES public.movimientos_banco(id) ON DELETE SET NULL,
  canal TEXT NOT NULL CHECK (canal IN ('webpay_plus', 'webpay_link', 'transbank', 'otro')),
  orden_compra TEXT NOT NULL,
  codigo_autorizacion TEXT,
  marca_tarjeta TEXT,
  cuotas INTEGER NOT NULL DEFAULT 1 CHECK (cuotas >= 1),
  moneda TEXT NOT NULL DEFAULT 'CLP',
  monto_bruto NUMERIC(14,2) NOT NULL CHECK (monto_bruto > 0),
  monto_comision NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monto_comision >= 0),
  monto_neto NUMERIC(14,2) NOT NULL CHECK (monto_neto > 0),
  monto_aplicado_factura NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monto_aplicado_factura >= 0),
  fecha_venta DATE NOT NULL,
  fecha_abono_esperada DATE NOT NULL,
  fecha_abono_real DATE,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'conciliado', 'rechazado', 'anulado')),
  notas TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (monto_comision <= monto_bruto),
  CHECK (monto_neto <= monto_bruto),
  CHECK (monto_aplicado_factura <= monto_bruto)
);

CREATE INDEX IF NOT EXISTS idx_webpay_liquidaciones_empresa_estado_fecha
ON public.webpay_liquidaciones (empresa_id, estado, fecha_abono_esperada);

CREATE INDEX IF NOT EXISTS idx_webpay_liquidaciones_factura
ON public.webpay_liquidaciones (factura_id)
WHERE factura_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_webpay_liquidaciones_movimiento
ON public.webpay_liquidaciones (movimiento_banco_id)
WHERE movimiento_banco_id IS NOT NULL;

INSERT INTO public.treasury_categories (empresa_id, code, nombre, direction_scope, sort_order, active, is_system)
SELECT
  e.id,
  seed.code,
  seed.nombre,
  seed.direction_scope,
  seed.sort_order,
  true,
  true
FROM public.empresas e
CROSS JOIN (
  VALUES
    ('checks_in_transit', 'Cheques en cartera', 'inflow', 24),
    ('webpay_settlements', 'Abonos WebPay', 'inflow', 25)
) AS seed(code, nombre, direction_scope, sort_order)
ON CONFLICT (empresa_id, code) DO UPDATE
SET
  nombre = EXCLUDED.nombre,
  direction_scope = EXCLUDED.direction_scope,
  sort_order = EXCLUDED.sort_order,
  active = true,
  is_system = true,
  updated_at = now();

ALTER TABLE public.cheques_cartera ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webpay_liquidaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cheques_cartera_select_scoped" ON public.cheques_cartera;
DROP POLICY IF EXISTS "cheques_cartera_write_scoped" ON public.cheques_cartera;
CREATE POLICY "cheques_cartera_select_scoped"
ON public.cheques_cartera FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "cheques_cartera_write_scoped"
ON public.cheques_cartera FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

DROP POLICY IF EXISTS "webpay_liquidaciones_select_scoped" ON public.webpay_liquidaciones;
DROP POLICY IF EXISTS "webpay_liquidaciones_write_scoped" ON public.webpay_liquidaciones;
CREATE POLICY "webpay_liquidaciones_select_scoped"
ON public.webpay_liquidaciones FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "webpay_liquidaciones_write_scoped"
ON public.webpay_liquidaciones FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

DROP TRIGGER IF EXISTS trg_cheques_cartera_updated_at ON public.cheques_cartera;
CREATE TRIGGER trg_cheques_cartera_updated_at
BEFORE UPDATE ON public.cheques_cartera
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_webpay_liquidaciones_updated_at ON public.webpay_liquidaciones;
CREATE TRIGGER trg_webpay_liquidaciones_updated_at
BEFORE UPDATE ON public.webpay_liquidaciones
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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
  instrument_allocations AS (
    SELECT
      linked.factura_id,
      SUM(linked.monto_aplicado_factura)::numeric(14,2) AS allocated_amount
    FROM (
      SELECT factura_id, monto_aplicado_factura
      FROM public.cheques_cartera
      WHERE factura_id IS NOT NULL
        AND estado IN ('en_cartera', 'depositado', 'cobrado')

      UNION ALL

      SELECT factura_id, monto_aplicado_factura
      FROM public.webpay_liquidaciones
      WHERE factura_id IS NOT NULL
        AND estado IN ('pendiente', 'conciliado')
    ) AS linked
    GROUP BY linked.factura_id
  )
  SELECT
    f.id AS factura_id,
    f.tercero_id,
    COALESCE(f.tercero_nombre, 'Sin cliente') AS tercero_nombre,
    COALESCE(f.numero_documento, '') AS numero_documento,
    GREATEST(f.monto - COALESCE(ia.allocated_amount, 0), 0)::numeric(14,2) AS amount,
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
  LEFT JOIN instrument_allocations ia ON ia.factura_id = f.id
  WHERE f.empresa_id = p_empresa_id
    AND f.tipo = 'venta'
    AND f.estado IN ('pendiente', 'morosa')
    AND GREATEST(f.monto - COALESCE(ia.allocated_amount, 0), 0) > 0;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cheques_cartera TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webpay_liquidaciones TO authenticated;
GRANT SELECT ON public.v_treasury_open_items TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_collection_pipeline(uuid, date) TO authenticated;
