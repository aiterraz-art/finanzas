-- Make the tax outflow category explicit in bank reconciliation.
INSERT INTO public.treasury_categories (
  empresa_id,
  code,
  nombre,
  direction_scope,
  sort_order,
  active,
  is_system
)
SELECT
  e.id,
  'taxes',
  'Pago IVA e impuestos',
  'outflow',
  40,
  true,
  true
FROM public.empresas e
ON CONFLICT (empresa_id, code) DO UPDATE
SET
  nombre = EXCLUDED.nombre,
  direction_scope = EXCLUDED.direction_scope,
  sort_order = EXCLUDED.sort_order,
  active = true,
  is_system = true,
  updated_at = now();
