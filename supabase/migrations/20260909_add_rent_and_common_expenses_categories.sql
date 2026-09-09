-- Recurring occupancy costs that must be selectable from bank reconciliation.
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
  seed.code,
  seed.nombre,
  'outflow',
  seed.sort_order,
  true,
  true
FROM public.empresas e
CROSS JOIN (
  VALUES
    ('rent', 'Arriendo', 50),
    ('common_expenses', 'Gastos comunes', 51)
) AS seed(code, nombre, sort_order)
ON CONFLICT (empresa_id, code) DO UPDATE
SET
  nombre = EXCLUDED.nombre,
  direction_scope = EXCLUDED.direction_scope,
  sort_order = EXCLUDED.sort_order,
  active = true,
  is_system = true,
  updated_at = now();
