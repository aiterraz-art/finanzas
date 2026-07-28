INSERT INTO public.treasury_categories (empresa_id, code, nombre, direction_scope, sort_order, active, is_system)
SELECT
  e.id,
  seed.code,
  seed.nombre,
  seed.direction_scope,
  seed.sort_order,
  true,
  true
FROM public.empresas e
CROSS JOIN (
  VALUES
    ('bank_fees', 'Comisiones bancarias', 'outflow', 46),
    ('internal_transfers', 'Traspasos entre cuentas', 'both', 47),
    ('utilities', 'Servicios basicos', 'outflow', 57),
    ('subscriptions', 'Suscripciones y software', 'outflow', 61),
    ('professional_fees', 'Honorarios', 'outflow', 62),
    ('insurance', 'Seguros', 'outflow', 63),
    ('logistics', 'Fletes y despachos', 'outflow', 64),
    ('travel_expenses', 'Viaticos y movilizacion', 'outflow', 65),
    ('reimbursements', 'Reembolsos y rendiciones', 'outflow', 66),
    ('petty_cash', 'Caja chica y reposiciones', 'outflow', 67),
    ('maintenance', 'Mantenciones y reparaciones', 'outflow', 68)
) AS seed(code, nombre, direction_scope, sort_order)
ON CONFLICT (empresa_id, code) DO UPDATE
SET
  nombre = EXCLUDED.nombre,
  direction_scope = EXCLUDED.direction_scope,
  sort_order = EXCLUDED.sort_order,
  active = true,
  is_system = true,
  updated_at = now();

UPDATE public.rendiciones r
SET treasury_category_id = tc.id
FROM public.treasury_categories tc
WHERE tc.empresa_id = r.empresa_id
  AND tc.code = 'reimbursements'
  AND r.treasury_category_id IS NULL;
