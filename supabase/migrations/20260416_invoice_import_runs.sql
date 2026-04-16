CREATE TABLE IF NOT EXISTS public.invoice_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('issued', 'receivables')),
  original_filename TEXT NOT NULL,
  imported_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_rows INTEGER NOT NULL DEFAULT 0,
  inserted_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoice_import_runs_empresa_imported_at
ON public.invoice_import_runs (empresa_id, imported_at DESC);

ALTER TABLE public.invoice_import_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_import_runs_select_scoped" ON public.invoice_import_runs;
DROP POLICY IF EXISTS "invoice_import_runs_write_scoped" ON public.invoice_import_runs;

CREATE POLICY "invoice_import_runs_select_scoped"
ON public.invoice_import_runs FOR SELECT TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "invoice_import_runs_write_scoped"
ON public.invoice_import_runs FOR ALL TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

GRANT SELECT, INSERT, UPDATE ON public.invoice_import_runs TO authenticated;
