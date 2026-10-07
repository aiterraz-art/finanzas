-- Las rendiciones deben revisarse contra facturas de compra antes de entrar al P/L:
-- o se vinculan sus facturas, o se confirma que no incluye facturas a nombre de la empresa.
ALTER TABLE public.cash_commitments
  ADD COLUMN IF NOT EXISTS invoice_check TEXT CHECK (invoice_check IS NULL OR invoice_check IN ('no_invoices', 'linked')),
  ADD COLUMN IF NOT EXISTS invoice_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_checked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Las que ya tienen facturas vinculadas quedan revisadas.
UPDATE public.cash_commitments AS cc
SET invoice_check = 'linked', invoice_checked_at = now()
WHERE cc.invoice_check IS NULL
  AND EXISTS (SELECT 1 FROM public.pnl_invoice_links AS l WHERE l.cash_commitment_id = cc.id);
