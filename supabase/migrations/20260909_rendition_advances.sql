CREATE TABLE IF NOT EXISTS public.rendition_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  return_movement_id UUID UNIQUE REFERENCES public.movimientos_banco(id) ON DELETE SET NULL,
  worker_name TEXT NOT NULL,
  rut TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  remaining_amount NUMERIC(14,2) NOT NULL CHECK (remaining_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'CLP',
  issued_at DATE,
  returned_at DATE,
  status TEXT NOT NULL CHECK (status IN ('open', 'settled', 'cancelled')) DEFAULT 'open',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rendition_advances_empresa_status
  ON public.rendition_advances(empresa_id, status, issued_at DESC);

DROP TRIGGER IF EXISTS trg_rendition_advances_updated_at ON public.rendition_advances;
CREATE TRIGGER trg_rendition_advances_updated_at
BEFORE UPDATE ON public.rendition_advances
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.rendition_advances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rendition_advances_select" ON public.rendition_advances;
CREATE POLICY "rendition_advances_select"
ON public.rendition_advances
FOR SELECT
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

DROP POLICY IF EXISTS "rendition_advances_write" ON public.rendition_advances;
CREATE POLICY "rendition_advances_write"
ON public.rendition_advances
FOR ALL
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

GRANT SELECT, INSERT, UPDATE ON public.rendition_advances TO authenticated;

ALTER TABLE public.movimientos_banco
DROP CONSTRAINT IF EXISTS movimientos_banco_tipo_conciliacion_check;

ALTER TABLE public.movimientos_banco
ADD CONSTRAINT movimientos_banco_tipo_conciliacion_check
CHECK (
  tipo_conciliacion IS NULL
  OR tipo_conciliacion IN ('factura', 'rendicion', 'cheque', 'webpay', 'commitment', 'advance', 'rendition_advance', 'remuneraciones', 'otros_egresos')
);
