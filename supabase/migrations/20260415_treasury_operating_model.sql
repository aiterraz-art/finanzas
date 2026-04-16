CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.classify_recurring_category(raw_description text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(lower(raw_description), '') ~ '(arriend|rent|lease)' THEN 'rent'
    WHEN coalesce(lower(raw_description), '') ~ '(impuesto|iva|ppm|tesoreria|sii)' THEN 'taxes'
    WHEN coalesce(lower(raw_description), '') ~ '(sueldo|nomina|n[oó]mina|remuneraci|previ|afp|salud)' THEN 'payroll'
    WHEN coalesce(lower(raw_description), '') ~ '(maquina|equipo|activo|capex|inversi[oó]n)' THEN 'capex'
    ELSE 'services'
  END;
$$;

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  banco TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('corriente', 'vista', 'ahorro', 'caja_chica')),
  moneda TEXT NOT NULL,
  numero_mascarado TEXT,
  saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
  saldo_inicial_fecha DATE NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  es_principal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_accounts_empresa_principal
ON public.bank_accounts (empresa_id)
WHERE es_principal;

CREATE INDEX IF NOT EXISTS idx_bank_accounts_empresa_activa
ON public.bank_accounts (empresa_id, activa, nombre);

CREATE TABLE IF NOT EXISTS public.treasury_policies (
  empresa_id UUID PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  moneda_base TEXT NOT NULL,
  timezone TEXT NOT NULL,
  forecast_weeks INTEGER NOT NULL DEFAULT 13,
  week_starts_on INTEGER NOT NULL DEFAULT 1 CHECK (week_starts_on BETWEEN 1 AND 7),
  minimum_cash_buffer NUMERIC(14,2) NOT NULL DEFAULT 0,
  critical_cash_buffer NUMERIC(14,2) NOT NULL DEFAULT 0,
  stale_bank_import_days INTEGER NOT NULL DEFAULT 3,
  missing_followup_days INTEGER NOT NULL DEFAULT 7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.treasury_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  nombre TEXT NOT NULL,
  direction_scope TEXT NOT NULL CHECK (direction_scope IN ('inflow', 'outflow', 'both')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, code)
);

CREATE TABLE IF NOT EXISTS public.cash_commitment_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.treasury_categories(id) ON DELETE RESTRICT,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  obligation_type TEXT NOT NULL CHECK (obligation_type IN ('tax', 'payroll', 'recurring', 'manual', 'debt', 'capex')),
  description TEXT NOT NULL,
  counterparty TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual')),
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7),
  months_of_year SMALLINT[],
  default_amount NUMERIC(14,2),
  requires_amount_confirmation BOOLEAN NOT NULL DEFAULT false,
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'normal', 'deferrable')),
  active BOOLEAN NOT NULL DEFAULT true,
  next_due_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_commitment_templates_empresa_due
ON public.cash_commitment_templates (empresa_id, active, next_due_date);

CREATE TABLE IF NOT EXISTS public.cash_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.cash_commitment_templates(id) ON DELETE SET NULL,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  category_id UUID NOT NULL REFERENCES public.treasury_categories(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'template', 'tax', 'payroll', 'debt', 'capex')),
  source_reference TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  counterparty TEXT,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  is_estimated BOOLEAN NOT NULL DEFAULT true,
  due_date DATE NOT NULL,
  expected_date DATE NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'normal', 'deferrable')),
  status TEXT NOT NULL CHECK (status IN ('planned', 'confirmed', 'paid', 'cancelled', 'deferred')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_commitments_empresa_template_due
ON public.cash_commitments (empresa_id, template_id, due_date)
WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_commitments_empresa_expected_status
ON public.cash_commitments (empresa_id, expected_date, status);

CREATE TABLE IF NOT EXISTS public.collection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  factura_id UUID NOT NULL REFERENCES public.facturas(id) ON DELETE CASCADE,
  tercero_id UUID NOT NULL REFERENCES public.terceros(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('call', 'email', 'whatsapp', 'meeting', 'other')),
  event_type TEXT NOT NULL CHECK (event_type IN ('reminder', 'promise', 'dispute', 'no_answer', 'resolved')),
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  promised_date DATE,
  promised_amount NUMERIC(14,2),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collection_events_factura_happened_at
ON public.collection_events (factura_id, happened_at DESC);

CREATE TABLE IF NOT EXISTS public.bank_statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  imported_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count INTEGER NOT NULL DEFAULT 0,
  period_from DATE,
  period_to DATE
);

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_empresa_account
ON public.bank_statement_imports (empresa_id, bank_account_id, imported_at DESC);

ALTER TABLE public.movimientos_banco
  ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES public.bank_statement_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_hash TEXT,
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS treasury_category_id UUID REFERENCES public.treasury_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_cash_date DATE,
  ADD COLUMN IF NOT EXISTS cash_confidence_pct SMALLINT CHECK (cash_confidence_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS treasury_priority TEXT CHECK (treasury_priority IN ('critical', 'high', 'normal', 'deferrable')),
  ADD COLUMN IF NOT EXISTS preferred_bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promised_payment_date DATE,
  ADD COLUMN IF NOT EXISTS last_collection_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS disputed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.rendiciones
  ADD COLUMN IF NOT EXISTS treasury_category_id UUID REFERENCES public.treasury_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS planned_cash_date DATE,
  ADD COLUMN IF NOT EXISTS treasury_priority TEXT CHECK (treasury_priority IN ('critical', 'high', 'normal', 'deferrable')),
  ADD COLUMN IF NOT EXISTS preferred_bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movimientos_banco_empresa_account_fecha
ON public.movimientos_banco (empresa_id, bank_account_id, fecha_movimiento DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_movimientos_banco_account_source_hash
ON public.movimientos_banco (bank_account_id, source_hash)
WHERE source_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_facturas_empresa_planned_cash_date
ON public.facturas (empresa_id, planned_cash_date);

CREATE INDEX IF NOT EXISTS idx_facturas_empresa_priority
ON public.facturas (empresa_id, treasury_priority, planned_cash_date);

CREATE INDEX IF NOT EXISTS idx_rendiciones_empresa_planned_cash_date
ON public.rendiciones (empresa_id, planned_cash_date);

DO $$
BEGIN
  INSERT INTO public.bank_accounts (
    empresa_id,
    nombre,
    banco,
    tipo,
    moneda,
    numero_mascarado,
    saldo_inicial,
    saldo_inicial_fecha,
    activa,
    es_principal
  )
  SELECT
    e.id,
    'Cuenta Principal',
    COALESCE(NULLIF(e.nombre, ''), 'Banco Principal'),
    'corriente',
    COALESCE(NULLIF(e.moneda, ''), 'CLP'),
    NULL,
    0,
    CURRENT_DATE,
    true,
    true
  FROM public.empresas e
  WHERE e.activa
    AND NOT EXISTS (
      SELECT 1
      FROM public.bank_accounts ba
      WHERE ba.empresa_id = e.id
    );
END $$;

UPDATE public.movimientos_banco mb
SET bank_account_id = ba.id
FROM public.bank_accounts ba
WHERE mb.empresa_id = ba.empresa_id
  AND ba.es_principal
  AND mb.bank_account_id IS NULL;

WITH weekly_outflows AS (
  SELECT
    empresa_id,
    date_trunc('week', fecha_movimiento::timestamp)::date AS week_start,
    SUM(ABS(COALESCE(salida_banco, CASE WHEN monto < 0 THEN ABS(monto) ELSE 0 END))) AS weekly_outflow
  FROM public.movimientos_banco
  WHERE fecha_movimiento >= CURRENT_DATE - INTERVAL '56 days'
  GROUP BY empresa_id, date_trunc('week', fecha_movimiento::timestamp)::date
),
outflow_stats AS (
  SELECT
    e.id AS empresa_id,
    COALESCE(AVG(w.weekly_outflow), 0) AS avg_weekly_outflow
  FROM public.empresas e
  LEFT JOIN weekly_outflows w ON w.empresa_id = e.id
  GROUP BY e.id
)
INSERT INTO public.treasury_policies (
  empresa_id,
  moneda_base,
  timezone,
  forecast_weeks,
  week_starts_on,
  minimum_cash_buffer,
  critical_cash_buffer,
  stale_bank_import_days,
  missing_followup_days
)
SELECT
  e.id,
  COALESCE(NULLIF(e.moneda, ''), 'CLP'),
  COALESCE(NULLIF(e.timezone, ''), 'America/Santiago'),
  13,
  1,
  ROUND(COALESCE(s.avg_weekly_outflow, 0) * 2, 2),
  ROUND(COALESCE(s.avg_weekly_outflow, 0), 2),
  3,
  7
FROM public.empresas e
LEFT JOIN outflow_stats s ON s.empresa_id = e.id
ON CONFLICT (empresa_id) DO UPDATE
SET
  moneda_base = EXCLUDED.moneda_base,
  timezone = EXCLUDED.timezone,
  forecast_weeks = EXCLUDED.forecast_weeks,
  week_starts_on = EXCLUDED.week_starts_on,
  minimum_cash_buffer = EXCLUDED.minimum_cash_buffer,
  critical_cash_buffer = EXCLUDED.critical_cash_buffer,
  stale_bank_import_days = EXCLUDED.stale_bank_import_days,
  missing_followup_days = EXCLUDED.missing_followup_days,
  updated_at = now();

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
    ('sales', 'Ventas', 'inflow', 10),
    ('suppliers', 'Proveedores', 'outflow', 20),
    ('payroll', 'Nomina', 'outflow', 30),
    ('taxes', 'Impuestos', 'outflow', 40),
    ('rent', 'Arriendos', 'outflow', 50),
    ('import_costs', 'Gastos de importacion', 'outflow', 55),
    ('services', 'Servicios', 'outflow', 60),
    ('capex', 'Capex', 'outflow', 70),
    ('other_inflow', 'Otros Ingresos', 'inflow', 80),
    ('other_outflow', 'Otros Egresos', 'outflow', 90)
) AS seed(code, nombre, direction_scope, sort_order)
ON CONFLICT (empresa_id, code) DO UPDATE
SET
  nombre = EXCLUDED.nombre,
  direction_scope = EXCLUDED.direction_scope,
  sort_order = EXCLUDED.sort_order,
  active = true,
  is_system = true,
  updated_at = now();

WITH recurring_source AS (
  SELECT
    gr.id,
    gr.empresa_id,
    public.classify_recurring_category(gr.descripcion) AS category_code,
    gr.descripcion,
    gr.categoria,
    gr.monto,
    gr.dia_pago,
    ba.id AS bank_account_id
  FROM public.gastos_recurrentes gr
  LEFT JOIN public.bank_accounts ba
    ON ba.empresa_id = gr.empresa_id
   AND ba.es_principal
  WHERE COALESCE(gr.activo, true)
),
resolved AS (
  SELECT
    rs.*,
    tc.id AS category_id,
    CASE
      WHEN rs.category_code = 'taxes' THEN 'tax'
      WHEN rs.category_code = 'payroll' THEN 'payroll'
      WHEN rs.category_code = 'capex' THEN 'capex'
      ELSE 'recurring'
    END AS obligation_type,
    CASE
      WHEN rs.category_code IN ('taxes', 'payroll') THEN 'critical'
      WHEN rs.category_code = 'rent' THEN 'high'
      ELSE 'normal'
    END AS priority
  FROM recurring_source rs
  JOIN public.treasury_categories tc
    ON tc.empresa_id = rs.empresa_id
   AND tc.code = rs.category_code
),
prepared AS (
  SELECT
    r.*,
    CASE
      WHEN COALESCE(r.dia_pago, 1) >= EXTRACT(DAY FROM CURRENT_DATE)::integer
        THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::integer, EXTRACT(MONTH FROM CURRENT_DATE)::integer, LEAST(GREATEST(COALESCE(r.dia_pago, 1), 1), 28))
      ELSE (
        date_trunc('month', CURRENT_DATE + INTERVAL '1 month')::date
        + (LEAST(GREATEST(COALESCE(r.dia_pago, 1), 1), 28) - 1)
      )
    END AS next_due_date
  FROM resolved r
)
INSERT INTO public.cash_commitment_templates (
  empresa_id,
  category_id,
  bank_account_id,
  obligation_type,
  description,
  counterparty,
  frequency,
  day_of_month,
  default_amount,
  requires_amount_confirmation,
  priority,
  active,
  next_due_date
)
SELECT
  p.empresa_id,
  p.category_id,
  p.bank_account_id,
  p.obligation_type,
  p.descripcion,
  NULL,
  'monthly',
  LEAST(GREATEST(COALESCE(p.dia_pago, 1), 1), 28),
  p.monto,
  false,
  p.priority,
  true,
  p.next_due_date
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.cash_commitment_templates cct
  WHERE cct.empresa_id = p.empresa_id
    AND cct.description = p.descripcion
    AND cct.obligation_type = p.obligation_type
);

UPDATE public.facturas f
SET
  treasury_category_id = tc.id,
  planned_cash_date = CASE
    WHEN f.tipo = 'venta' THEN COALESCE(f.promised_payment_date, f.fecha_vencimiento, f.fecha_emision + 30)
    ELSE COALESCE(f.fecha_vencimiento, f.fecha_emision + 30)
  END,
  cash_confidence_pct = CASE
    WHEN f.tipo = 'compra' THEN 100
    WHEN COALESCE(f.disputed, false) THEN 0
    WHEN COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) < CURRENT_DATE - 30 THEN 30
    WHEN COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) < CURRENT_DATE - 15 THEN 50
    WHEN COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) < CURRENT_DATE THEN 70
    ELSE 90
  END,
  treasury_priority = CASE
    WHEN f.tipo = 'compra' THEN COALESCE(f.treasury_priority, 'normal')
    ELSE COALESCE(f.treasury_priority, 'high')
  END,
  preferred_bank_account_id = COALESCE(
    f.preferred_bank_account_id,
    (
      SELECT ba.id
      FROM public.bank_accounts ba
      WHERE ba.empresa_id = f.empresa_id
        AND ba.es_principal
      LIMIT 1
    )
  )
FROM public.treasury_categories tc
WHERE f.empresa_id = tc.empresa_id
  AND tc.code = CASE WHEN f.tipo = 'venta' THEN 'sales' ELSE 'suppliers' END;

UPDATE public.rendiciones r
SET
  treasury_category_id = tc.id,
  planned_cash_date = COALESCE(r.planned_cash_date, r.fecha, (r.created_at AT TIME ZONE 'UTC')::date + 7),
  treasury_priority = COALESCE(r.treasury_priority, 'high'),
  preferred_bank_account_id = COALESCE(
    r.preferred_bank_account_id,
    (
      SELECT ba.id
      FROM public.bank_accounts ba
      WHERE ba.empresa_id = r.empresa_id
        AND ba.es_principal
      LIMIT 1
    )
  )
FROM public.treasury_categories tc
WHERE r.empresa_id = tc.empresa_id
  AND tc.code = 'other_outflow';

UPDATE public.movimientos_banco mb
SET source_hash = concat_ws(
  '|',
  COALESCE(mb.bank_account_id::text, ''),
  COALESCE(mb.fecha_movimiento::text, ''),
  COALESCE(mb.n_operacion, ''),
  COALESCE(mb.descripcion, ''),
  COALESCE(mb.monto::text, ''),
  COALESCE(mb.saldo::text, '')
)
WHERE mb.source_hash IS NULL
  AND mb.bank_account_id IS NOT NULL;

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_commitment_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_accounts_select_scoped" ON public.bank_accounts;
DROP POLICY IF EXISTS "bank_accounts_write_scoped" ON public.bank_accounts;
CREATE POLICY "bank_accounts_select_scoped"
ON public.bank_accounts FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "bank_accounts_write_scoped"
ON public.bank_accounts FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

DROP POLICY IF EXISTS "treasury_policies_select_scoped" ON public.treasury_policies;
DROP POLICY IF EXISTS "treasury_policies_write_scoped" ON public.treasury_policies;
CREATE POLICY "treasury_policies_select_scoped"
ON public.treasury_policies FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "treasury_policies_write_scoped"
ON public.treasury_policies FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

DROP POLICY IF EXISTS "treasury_categories_select_scoped" ON public.treasury_categories;
DROP POLICY IF EXISTS "treasury_categories_write_scoped" ON public.treasury_categories;
CREATE POLICY "treasury_categories_select_scoped"
ON public.treasury_categories FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "treasury_categories_write_scoped"
ON public.treasury_categories FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

DROP POLICY IF EXISTS "cash_commitment_templates_select_scoped" ON public.cash_commitment_templates;
DROP POLICY IF EXISTS "cash_commitment_templates_write_scoped" ON public.cash_commitment_templates;
CREATE POLICY "cash_commitment_templates_select_scoped"
ON public.cash_commitment_templates FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "cash_commitment_templates_write_scoped"
ON public.cash_commitment_templates FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

DROP POLICY IF EXISTS "cash_commitments_select_scoped" ON public.cash_commitments;
DROP POLICY IF EXISTS "cash_commitments_write_scoped" ON public.cash_commitments;
CREATE POLICY "cash_commitments_select_scoped"
ON public.cash_commitments FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "cash_commitments_write_scoped"
ON public.cash_commitments FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

DROP POLICY IF EXISTS "collection_events_select_scoped" ON public.collection_events;
DROP POLICY IF EXISTS "collection_events_write_scoped" ON public.collection_events;
CREATE POLICY "collection_events_select_scoped"
ON public.collection_events FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "collection_events_write_scoped"
ON public.collection_events FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "bank_statement_imports_select_scoped" ON public.bank_statement_imports;
DROP POLICY IF EXISTS "bank_statement_imports_write_scoped" ON public.bank_statement_imports;
CREATE POLICY "bank_statement_imports_select_scoped"
ON public.bank_statement_imports FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "bank_statement_imports_write_scoped"
ON public.bank_statement_imports FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id) AND imported_by = auth.uid());

CREATE OR REPLACE FUNCTION public.apply_collection_event_to_invoice()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.facturas
  SET
    last_collection_contact_at = NEW.happened_at,
    promised_payment_date = CASE
      WHEN NEW.event_type = 'promise' AND NEW.promised_date IS NOT NULL THEN NEW.promised_date
      ELSE promised_payment_date
    END,
    planned_cash_date = CASE
      WHEN NEW.event_type = 'promise' AND NEW.promised_date IS NOT NULL THEN NEW.promised_date
      ELSE planned_cash_date
    END,
    disputed = CASE
      WHEN NEW.event_type = 'dispute' THEN true
      WHEN NEW.event_type = 'resolved' THEN false
      ELSE disputed
    END,
    cash_confidence_pct = CASE
      WHEN NEW.event_type = 'promise' AND NEW.promised_date IS NOT NULL THEN GREATEST(COALESCE(cash_confidence_pct, 60), 80)
      WHEN NEW.event_type = 'dispute' THEN 0
      WHEN NEW.event_type = 'no_answer' THEN GREATEST(COALESCE(cash_confidence_pct, 60) - 10, 10)
      WHEN NEW.event_type = 'resolved' THEN 100
      ELSE cash_confidence_pct
    END
  WHERE id = NEW.factura_id
    AND empresa_id = NEW.empresa_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_collection_events_apply ON public.collection_events;
CREATE TRIGGER trg_collection_events_apply
AFTER INSERT ON public.collection_events
FOR EACH ROW EXECUTE FUNCTION public.apply_collection_event_to_invoice();

DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
BEFORE UPDATE ON public.bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_treasury_policies_updated_at ON public.treasury_policies;
CREATE TRIGGER trg_treasury_policies_updated_at
BEFORE UPDATE ON public.treasury_policies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_treasury_categories_updated_at ON public.treasury_categories;
CREATE TRIGGER trg_treasury_categories_updated_at
BEFORE UPDATE ON public.treasury_categories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_cash_commitment_templates_updated_at ON public.cash_commitment_templates;
CREATE TRIGGER trg_cash_commitment_templates_updated_at
BEFORE UPDATE ON public.cash_commitment_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_cash_commitments_updated_at ON public.cash_commitments;
CREATE TRIGGER trg_cash_commitments_updated_at
BEFORE UPDATE ON public.cash_commitments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP VIEW IF EXISTS public.v_bank_account_positions;
CREATE VIEW public.v_bank_account_positions
WITH (security_invoker = true)
AS
WITH latest_balances AS (
  SELECT DISTINCT ON (mb.bank_account_id)
    mb.bank_account_id,
    mb.empresa_id,
    mb.fecha_movimiento,
    mb.saldo
  FROM public.movimientos_banco mb
  WHERE mb.bank_account_id IS NOT NULL
  ORDER BY mb.bank_account_id, mb.fecha_movimiento DESC, mb.id_secuencial DESC NULLS LAST, mb.created_at DESC
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

DROP VIEW IF EXISTS public.v_treasury_open_items;
CREATE VIEW public.v_treasury_open_items
WITH (security_invoker = true)
AS
SELECT
  'invoice_receivable'::text AS source_type,
  f.id AS source_id,
  f.empresa_id,
  COALESCE(f.preferred_bank_account_id, ba.id) AS bank_account_id,
  'inflow'::text AS direction,
  COALESCE(f.tercero_nombre, 'Sin cliente') AS counterparty,
  COALESCE(tc.code, 'sales') AS category_code,
  COALESCE(tc.nombre, 'Ventas') AS category_name,
  f.monto::numeric(14,2) AS amount,
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
WHERE f.tipo = 'venta'
  AND f.estado IN ('pendiente', 'morosa')

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
WHERE cc.status IN ('planned', 'confirmed', 'deferred');

CREATE OR REPLACE FUNCTION public.generate_cash_commitments(p_empresa_id uuid, p_until_date date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  tpl RECORD;
  due_date_cursor DATE;
  next_due DATE;
  chosen_amount NUMERIC(14,2);
  generated_count INTEGER := 0;
BEGIN
  FOR tpl IN
    SELECT *
    FROM public.cash_commitment_templates
    WHERE empresa_id = p_empresa_id
      AND active = true
    ORDER BY next_due_date, description
  LOOP
    due_date_cursor := tpl.next_due_date;

    WHILE due_date_cursor <= p_until_date LOOP
      chosen_amount := tpl.default_amount;

      IF tpl.requires_amount_confirmation THEN
        SELECT cc.amount
        INTO chosen_amount
        FROM public.cash_commitments cc
        WHERE cc.empresa_id = tpl.empresa_id
          AND cc.template_id = tpl.id
          AND cc.status IN ('confirmed', 'paid')
        ORDER BY cc.due_date DESC
        LIMIT 1;

        chosen_amount := COALESCE(chosen_amount, tpl.default_amount);
        IF chosen_amount IS NULL THEN
          RAISE EXCEPTION 'Template % requires amount confirmation and has no default or historic amount.', tpl.description;
        END IF;
      END IF;

      INSERT INTO public.cash_commitments (
        empresa_id,
        template_id,
        bank_account_id,
        category_id,
        source_type,
        source_reference,
        direction,
        counterparty,
        description,
        amount,
        is_estimated,
        due_date,
        expected_date,
        priority,
        status,
        notes
      )
      VALUES (
        tpl.empresa_id,
        tpl.id,
        tpl.bank_account_id,
        tpl.category_id,
        'template',
        tpl.obligation_type,
        'outflow',
        tpl.counterparty,
        tpl.description,
        chosen_amount,
        tpl.requires_amount_confirmation,
        due_date_cursor,
        due_date_cursor,
        tpl.priority,
        'planned',
        NULL
      )
      ON CONFLICT DO NOTHING;

      IF FOUND THEN
        generated_count := generated_count + 1;
      END IF;

      next_due := CASE tpl.frequency
        WHEN 'weekly' THEN due_date_cursor + 7
        WHEN 'biweekly' THEN due_date_cursor + 14
        WHEN 'monthly' THEN (due_date_cursor + INTERVAL '1 month')::date
        WHEN 'quarterly' THEN (due_date_cursor + INTERVAL '3 month')::date
        WHEN 'annual' THEN (due_date_cursor + INTERVAL '1 year')::date
        ELSE due_date_cursor + 30
      END;

      due_date_cursor := next_due;
    END LOOP;

    UPDATE public.cash_commitment_templates
    SET next_due_date = due_date_cursor
    WHERE id = tpl.id;
  END LOOP;

  RETURN generated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_treasury_forecast(p_empresa_id uuid, p_as_of date, p_weeks integer DEFAULT 13)
RETURNS TABLE (
  week_start date,
  week_end date,
  opening_cash numeric,
  expected_inflows numeric,
  committed_outflows numeric,
  net_cash numeric,
  closing_cash numeric,
  minimum_buffer numeric,
  below_buffer boolean,
  negative_cash boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  as_of_date DATE := COALESCE(p_as_of, CURRENT_DATE);
  weeks_count INTEGER := GREATEST(COALESCE(p_weeks, 13), 1);
BEGIN
  PERFORM public.generate_cash_commitments(p_empresa_id, (date_trunc('week', as_of_date::timestamp)::date + ((weeks_count - 1) * 7) + 6));

  RETURN QUERY
  WITH policy AS (
    SELECT
      COALESCE(tp.minimum_cash_buffer, 0)::numeric(14,2) AS minimum_cash_buffer
    FROM public.treasury_policies tp
    WHERE tp.empresa_id = p_empresa_id
  ),
  opening AS (
    SELECT COALESCE(SUM(v.current_balance), 0)::numeric(14,2) AS current_cash
    FROM public.v_bank_account_positions v
    WHERE v.empresa_id = p_empresa_id
  ),
  weeks AS (
    SELECT generate_series(
      date_trunc('week', as_of_date::timestamp)::date,
      date_trunc('week', as_of_date::timestamp)::date + ((weeks_count - 1) * 7),
      INTERVAL '7 days'
    )::date AS week_start
  ),
  week_items AS (
    SELECT
      date_trunc('week', oi.expected_date::timestamp)::date AS week_start,
      SUM(CASE WHEN oi.direction = 'inflow' THEN ROUND(oi.amount * oi.confidence_pct / 100.0, 2) ELSE 0 END)::numeric(14,2) AS inflows,
      SUM(CASE WHEN oi.direction = 'outflow' THEN oi.amount ELSE 0 END)::numeric(14,2) AS outflows
    FROM public.v_treasury_open_items oi
    WHERE oi.empresa_id = p_empresa_id
      AND oi.expected_date BETWEEN date_trunc('week', as_of_date::timestamp)::date
        AND (date_trunc('week', as_of_date::timestamp)::date + ((weeks_count - 1) * 7) + 6)
    GROUP BY date_trunc('week', oi.expected_date::timestamp)::date
  ),
  merged AS (
    SELECT
      w.week_start,
      COALESCE(wi.inflows, 0)::numeric(14,2) AS expected_inflows,
      COALESCE(wi.outflows, 0)::numeric(14,2) AS committed_outflows
    FROM weeks w
    LEFT JOIN week_items wi USING (week_start)
  ),
  calculated AS (
    SELECT
      m.week_start,
      (m.week_start + 6)::date AS week_end,
      (SELECT current_cash FROM opening)
        + COALESCE(SUM(m.expected_inflows - m.committed_outflows)
            OVER (ORDER BY m.week_start ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::numeric(14,2) AS opening_cash,
      m.expected_inflows,
      m.committed_outflows,
      (m.expected_inflows - m.committed_outflows)::numeric(14,2) AS net_cash,
      (SELECT current_cash FROM opening)
        + SUM(m.expected_inflows - m.committed_outflows)
          OVER (ORDER BY m.week_start ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::numeric(14,2) AS closing_cash,
      COALESCE((SELECT minimum_cash_buffer FROM policy), 0)::numeric(14,2) AS minimum_buffer
    FROM merged m
  )
  SELECT
    c.week_start,
    c.week_end,
    c.opening_cash,
    c.expected_inflows,
    c.committed_outflows,
    c.net_cash,
    c.closing_cash,
    c.minimum_buffer,
    c.closing_cash < c.minimum_buffer AS below_buffer,
    c.closing_cash < 0 AS negative_cash
  FROM calculated c
  ORDER BY c.week_start;
END;
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
      COALESCE((SELECT COUNT(*) FROM public.facturas WHERE empresa_id = p_empresa_id AND estado IN ('pendiente', 'morosa') AND (planned_cash_date IS NULL OR treasury_category_id IS NULL)), 0)
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

CREATE OR REPLACE FUNCTION public.get_payment_queue(p_empresa_id uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  source_type text,
  source_id uuid,
  counterparty text,
  category_code text,
  category_name text,
  amount numeric,
  due_date date,
  expected_date date,
  priority text,
  bank_account_id uuid,
  notes text,
  suggested_action text
)
LANGUAGE sql
AS $$
  WITH base AS (
    SELECT *
    FROM public.v_treasury_open_items
    WHERE empresa_id = p_empresa_id
      AND direction = 'outflow'
      AND status IN ('pendiente', 'morosa', 'planned', 'confirmed', 'deferred')
  ),
  forecast_min AS (
    SELECT COALESCE(MIN(closing_cash), 0) AS min_cash
    FROM public.get_treasury_forecast(p_empresa_id, COALESCE(p_as_of, CURRENT_DATE), 13)
  )
  SELECT
    b.source_type,
    b.source_id,
    b.counterparty,
    b.category_code,
    b.category_name,
    b.amount,
    b.due_date,
    b.expected_date,
    b.priority,
    b.bank_account_id,
    b.notes,
    CASE
      WHEN b.bank_account_id IS NULL THEN 'Asignar cuenta bancaria'
      WHEN b.notes IS NOT NULL AND b.notes <> '' THEN 'Bloqueado por caja'
      WHEN b.priority = 'critical' AND b.expected_date <= COALESCE(p_as_of, CURRENT_DATE) + 3 THEN 'Pagar hoy'
      WHEN b.priority = 'high' AND b.expected_date <= COALESCE(p_as_of, CURRENT_DATE) + 7 THEN 'Programar esta semana'
      WHEN b.priority = 'deferrable' AND (SELECT min_cash FROM forecast_min) < 0 THEN 'Postergar / renegociar'
      ELSE 'Revisar programacion'
    END AS suggested_action
  FROM base b
  ORDER BY
    CASE b.priority
      WHEN 'critical' THEN 4
      WHEN 'high' THEN 3
      WHEN 'normal' THEN 2
      ELSE 1
    END DESC,
    b.expected_date ASC,
    b.amount DESC;
$$;

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
  )
  SELECT
    f.id AS factura_id,
    f.tercero_id,
    COALESCE(f.tercero_nombre, 'Sin cliente') AS tercero_nombre,
    COALESCE(f.numero_documento, '') AS numero_documento,
    f.monto::numeric(14,2) AS amount,
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
  WHERE f.empresa_id = p_empresa_id
    AND f.tipo = 'venta'
    AND f.estado IN ('pendiente', 'morosa');
$$;

GRANT SELECT ON public.v_bank_account_positions TO authenticated;
GRANT SELECT ON public.v_treasury_open_items TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_cash_commitments(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_treasury_forecast(uuid, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_treasury_kpis(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_queue(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_collection_pipeline(uuid, date) TO authenticated;
