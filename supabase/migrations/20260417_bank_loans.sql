CREATE TABLE IF NOT EXISTS public.bank_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  bank_account_id UUID NULL REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  treasury_category_id UUID NULL REFERENCES public.treasury_categories(id) ON DELETE SET NULL,
  lender_name TEXT NOT NULL,
  loan_name TEXT NOT NULL,
  principal_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  installment_amount NUMERIC(14,2) NOT NULL,
  total_installments INTEGER NOT NULL CHECK (total_installments > 0),
  first_due_date DATE NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual')),
  priority TEXT NOT NULL DEFAULT 'high' CHECK (priority IN ('critical', 'high', 'normal', 'deferrable')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  notes TEXT NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_loans_empresa_status
ON public.bank_loans (empresa_id, status, first_due_date);

ALTER TABLE public.bank_loans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_loans_select_scoped" ON public.bank_loans;
DROP POLICY IF EXISTS "bank_loans_write_scoped" ON public.bank_loans;
CREATE POLICY "bank_loans_select_scoped"
ON public.bank_loans FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));
CREATE POLICY "bank_loans_write_scoped"
ON public.bank_loans FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

DROP TRIGGER IF EXISTS trg_bank_loans_updated_at ON public.bank_loans;
CREATE TRIGGER trg_bank_loans_updated_at
BEFORE UPDATE ON public.bank_loans
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.bank_loans TO authenticated;

INSERT INTO public.treasury_categories (id, empresa_id, code, nombre, direction_scope, sort_order, active, is_system)
SELECT
  gen_random_uuid(),
  e.id,
  'debt_service',
  'Creditos bancarios',
  'outflow',
  45,
  true,
  true
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.treasury_categories tc
  WHERE tc.empresa_id = e.id
    AND tc.code = 'debt_service'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'attach_prevent_delete_trigger'
      AND pg_function_is_visible(oid)
  ) THEN
    PERFORM public.attach_prevent_delete_trigger('public.bank_loans');
  END IF;
END $$;
