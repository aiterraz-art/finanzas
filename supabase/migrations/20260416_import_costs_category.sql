INSERT INTO public.treasury_categories (empresa_id, code, nombre, direction_scope, sort_order, active, is_system)
SELECT
  e.id,
  'import_costs',
  'Gastos de importacion',
  'outflow',
  55,
  true,
  true
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.treasury_categories tc
  WHERE tc.empresa_id = e.id
    AND tc.code = 'import_costs'
);
