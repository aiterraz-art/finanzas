INSERT INTO public.treasury_categories (empresa_id, code, nombre, direction_scope, sort_order, active, is_system)
SELECT
  e.id,
  'suppliers',
  'Proveedores',
  'outflow',
  20,
  true,
  true
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.treasury_categories tc
  WHERE tc.empresa_id = e.id
    AND tc.code = 'suppliers'
);

UPDATE public.treasury_categories
SET
  nombre = 'Proveedores',
  direction_scope = 'outflow',
  sort_order = 20,
  active = true,
  is_system = true,
  updated_at = now()
WHERE code = 'suppliers';
