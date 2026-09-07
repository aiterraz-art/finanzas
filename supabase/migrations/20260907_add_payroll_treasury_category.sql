-- Ensure every company can classify bank outflows as payroll/remunerations.
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
  'payroll',
  'Remuneraciones',
  'outflow',
  30,
  true,
  true
FROM public.empresas e
ON CONFLICT (empresa_id, code) DO UPDATE
SET
  direction_scope = EXCLUDED.direction_scope,
  active = true,
  is_system = true,
  updated_at = now();
