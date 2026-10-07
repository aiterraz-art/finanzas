-- Precisión del P/L:
-- 1. Impuestos de compras que son costo (IVA no recuperable, impuestos sin derecho a crédito).
-- 2. Monto de devengo distinto al pagado (bruto de honorarios, costo empresa, interés de cuotas).
-- 3. Vínculo entre facturas de compra y gastos/rendiciones pagados por banco, para no contar
--    dos veces un gasto que también llegó por el registro de compras del SII.
-- 4. Mes de devengo para los gastos pagados que quedaron sin él.

ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS monto_iva_no_recuperable NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS monto_otros_impuestos NUMERIC(14,2);

ALTER TABLE public.cash_commitments
  ADD COLUMN IF NOT EXISTS pnl_amount NUMERIC(14,2) CHECK (pnl_amount IS NULL OR pnl_amount >= 0);

CREATE TABLE IF NOT EXISTS public.pnl_invoice_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  factura_id UUID NOT NULL UNIQUE REFERENCES public.facturas(id) ON DELETE CASCADE,
  cash_commitment_id UUID REFERENCES public.cash_commitments(id) ON DELETE CASCADE,
  rendicion_id UUID REFERENCES public.rendiciones(id) ON DELETE CASCADE,
  factura_estado_previo TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((cash_commitment_id IS NOT NULL)::int + (rendicion_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS idx_pnl_invoice_links_commitment
  ON public.pnl_invoice_links(cash_commitment_id) WHERE cash_commitment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pnl_invoice_links_rendicion
  ON public.pnl_invoice_links(rendicion_id) WHERE rendicion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pnl_invoice_links_empresa
  ON public.pnl_invoice_links(empresa_id);

ALTER TABLE public.pnl_invoice_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pnl_invoice_links_select" ON public.pnl_invoice_links;
CREATE POLICY "pnl_invoice_links_select"
ON public.pnl_invoice_links
FOR SELECT
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

DROP POLICY IF EXISTS "pnl_invoice_links_write" ON public.pnl_invoice_links;
CREATE POLICY "pnl_invoice_links_write"
ON public.pnl_invoice_links
FOR ALL
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

GRANT SELECT, INSERT, DELETE ON public.pnl_invoice_links TO authenticated;

-- Gastos pagados sin mes de devengo: se usa el mes del pago bancario (o la fecha esperada).
UPDATE public.cash_commitments AS cc
SET accrual_month = date_trunc(
  'month',
  COALESCE(
    (SELECT mb.fecha_movimiento FROM public.movimientos_banco AS mb WHERE mb.id = cc.movimiento_banco_id),
    cc.expected_date,
    cc.due_date
  )
)::date
WHERE cc.status = 'paid'
  AND cc.direction = 'outflow'
  AND cc.accrual_month IS NULL;
