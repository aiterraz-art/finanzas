-- Toll road charges are operational outflows and must be selectable in bank reconciliation.
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
  'tolls',
  'Autopistas',
  'outflow',
  59,
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
