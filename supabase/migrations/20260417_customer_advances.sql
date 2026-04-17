CREATE TABLE IF NOT EXISTS public.customer_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tercero_id UUID REFERENCES public.terceros(id) ON DELETE SET NULL,
  movimiento_banco_id UUID UNIQUE REFERENCES public.movimientos_banco(id) ON DELETE SET NULL,
  tercero_nombre TEXT NOT NULL,
  rut TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  remaining_amount NUMERIC(14,2) NOT NULL CHECK (remaining_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'CLP',
  received_at DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'applied', 'cancelled')) DEFAULT 'open',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_advances_empresa_status_received_at
  ON public.customer_advances(empresa_id, status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_advances_tercero
  ON public.customer_advances(empresa_id, tercero_id, status);

DROP TRIGGER IF EXISTS trg_customer_advances_updated_at ON public.customer_advances;
CREATE TRIGGER trg_customer_advances_updated_at
BEFORE UPDATE ON public.customer_advances
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_advances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_advances_select" ON public.customer_advances;
CREATE POLICY "customer_advances_select"
ON public.customer_advances
FOR SELECT
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

DROP POLICY IF EXISTS "customer_advances_write" ON public.customer_advances;
CREATE POLICY "customer_advances_write"
ON public.customer_advances
FOR ALL
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

GRANT SELECT, INSERT, UPDATE ON public.customer_advances TO authenticated;

ALTER TABLE public.movimientos_banco
DROP CONSTRAINT IF EXISTS movimientos_banco_tipo_conciliacion_check;

ALTER TABLE public.movimientos_banco
ADD CONSTRAINT movimientos_banco_tipo_conciliacion_check
CHECK (
  tipo_conciliacion IS NULL
  OR tipo_conciliacion IN ('factura', 'rendicion', 'cheque', 'webpay', 'commitment', 'advance', 'remuneraciones', 'otros_egresos')
);
