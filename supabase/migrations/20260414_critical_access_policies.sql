-- Tighten critical access policies for multi-company isolation and read-only viewers.

CREATE OR REPLACE FUNCTION public.is_global_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_company_membership(target_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_empresas
    WHERE user_id = auth.uid()
      AND empresa_id = target_empresa_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_company(target_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_admin() OR EXISTS (
    SELECT 1
    FROM public.user_empresas
    WHERE user_id = auth.uid()
      AND empresa_id = target_empresa_id
      AND role IN ('owner', 'admin', 'manager', 'user')
  );
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_self_or_admin"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.is_global_admin());

DROP POLICY IF EXISTS "Enable delete for admins" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin"
ON public.profiles
FOR DELETE
TO authenticated
USING (public.is_global_admin());

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresas_authenticated_select" ON public.empresas;
DROP POLICY IF EXISTS "empresas_authenticated_write" ON public.empresas;
DROP POLICY IF EXISTS "empresas_select_scoped" ON public.empresas;
DROP POLICY IF EXISTS "empresas_insert_admin" ON public.empresas;
DROP POLICY IF EXISTS "empresas_update_admin" ON public.empresas;
DROP POLICY IF EXISTS "empresas_delete_admin" ON public.empresas;

CREATE POLICY "empresas_select_scoped"
ON public.empresas
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(id));

CREATE POLICY "empresas_insert_admin"
ON public.empresas
FOR INSERT
TO authenticated
WITH CHECK (public.is_global_admin());

CREATE POLICY "empresas_update_admin"
ON public.empresas
FOR UPDATE
TO authenticated
USING (public.is_global_admin())
WITH CHECK (public.is_global_admin());

CREATE POLICY "empresas_delete_admin"
ON public.empresas
FOR DELETE
TO authenticated
USING (public.is_global_admin());

ALTER TABLE public.user_empresas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_empresas_authenticated_select" ON public.user_empresas;
DROP POLICY IF EXISTS "user_empresas_authenticated_write" ON public.user_empresas;
DROP POLICY IF EXISTS "user_empresas_select_scoped" ON public.user_empresas;
DROP POLICY IF EXISTS "user_empresas_insert_admin" ON public.user_empresas;
DROP POLICY IF EXISTS "user_empresas_update_admin" ON public.user_empresas;
DROP POLICY IF EXISTS "user_empresas_delete_admin" ON public.user_empresas;

CREATE POLICY "user_empresas_select_scoped"
ON public.user_empresas
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR user_id = auth.uid());

CREATE POLICY "user_empresas_insert_admin"
ON public.user_empresas
FOR INSERT
TO authenticated
WITH CHECK (public.is_global_admin());

CREATE POLICY "user_empresas_update_admin"
ON public.user_empresas
FOR UPDATE
TO authenticated
USING (public.is_global_admin())
WITH CHECK (public.is_global_admin());

CREATE POLICY "user_empresas_delete_admin"
ON public.user_empresas
FOR DELETE
TO authenticated
USING (public.is_global_admin());

ALTER TABLE public.terceros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "terceros_select_scoped" ON public.terceros;
DROP POLICY IF EXISTS "terceros_insert_scoped" ON public.terceros;
DROP POLICY IF EXISTS "terceros_update_scoped" ON public.terceros;
DROP POLICY IF EXISTS "terceros_delete_scoped" ON public.terceros;

CREATE POLICY "terceros_select_scoped"
ON public.terceros
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "terceros_insert_scoped"
ON public.terceros
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "terceros_update_scoped"
ON public.terceros
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "terceros_delete_scoped"
ON public.terceros
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.facturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facturas_select_scoped" ON public.facturas;
DROP POLICY IF EXISTS "facturas_insert_scoped" ON public.facturas;
DROP POLICY IF EXISTS "facturas_update_scoped" ON public.facturas;
DROP POLICY IF EXISTS "facturas_delete_scoped" ON public.facturas;

CREATE POLICY "facturas_select_scoped"
ON public.facturas
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "facturas_insert_scoped"
ON public.facturas
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "facturas_update_scoped"
ON public.facturas
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "facturas_delete_scoped"
ON public.facturas
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.movimientos_banco ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "movimientos_banco_select_scoped" ON public.movimientos_banco;
DROP POLICY IF EXISTS "movimientos_banco_insert_scoped" ON public.movimientos_banco;
DROP POLICY IF EXISTS "movimientos_banco_update_scoped" ON public.movimientos_banco;
DROP POLICY IF EXISTS "movimientos_banco_delete_scoped" ON public.movimientos_banco;

CREATE POLICY "movimientos_banco_select_scoped"
ON public.movimientos_banco
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "movimientos_banco_insert_scoped"
ON public.movimientos_banco
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "movimientos_banco_update_scoped"
ON public.movimientos_banco
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "movimientos_banco_delete_scoped"
ON public.movimientos_banco
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.rendiciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo a usuarios autenticados" ON public.rendiciones;
DROP POLICY IF EXISTS "rendiciones_select_scoped" ON public.rendiciones;
DROP POLICY IF EXISTS "rendiciones_insert_scoped" ON public.rendiciones;
DROP POLICY IF EXISTS "rendiciones_update_scoped" ON public.rendiciones;
DROP POLICY IF EXISTS "rendiciones_delete_scoped" ON public.rendiciones;

CREATE POLICY "rendiciones_select_scoped"
ON public.rendiciones
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "rendiciones_insert_scoped"
ON public.rendiciones
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "rendiciones_update_scoped"
ON public.rendiciones
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "rendiciones_delete_scoped"
ON public.rendiciones
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.rendicion_detalles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo a usuarios autenticados detalles" ON public.rendicion_detalles;
DROP POLICY IF EXISTS "rendicion_detalles_select_scoped" ON public.rendicion_detalles;
DROP POLICY IF EXISTS "rendicion_detalles_insert_scoped" ON public.rendicion_detalles;
DROP POLICY IF EXISTS "rendicion_detalles_update_scoped" ON public.rendicion_detalles;
DROP POLICY IF EXISTS "rendicion_detalles_delete_scoped" ON public.rendicion_detalles;

CREATE POLICY "rendicion_detalles_select_scoped"
ON public.rendicion_detalles
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "rendicion_detalles_insert_scoped"
ON public.rendicion_detalles
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "rendicion_detalles_update_scoped"
ON public.rendicion_detalles
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "rendicion_detalles_delete_scoped"
ON public.rendicion_detalles
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.facturas_pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facturas_pagos_select_scoped" ON public.facturas_pagos;
DROP POLICY IF EXISTS "facturas_pagos_insert_scoped" ON public.facturas_pagos;
DROP POLICY IF EXISTS "facturas_pagos_update_scoped" ON public.facturas_pagos;
DROP POLICY IF EXISTS "facturas_pagos_delete_scoped" ON public.facturas_pagos;

CREATE POLICY "facturas_pagos_select_scoped"
ON public.facturas_pagos
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "facturas_pagos_insert_scoped"
ON public.facturas_pagos
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "facturas_pagos_update_scoped"
ON public.facturas_pagos
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "facturas_pagos_delete_scoped"
ON public.facturas_pagos
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.gastos_recurrentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gastos_recurrentes_select_scoped" ON public.gastos_recurrentes;
DROP POLICY IF EXISTS "gastos_recurrentes_insert_scoped" ON public.gastos_recurrentes;
DROP POLICY IF EXISTS "gastos_recurrentes_update_scoped" ON public.gastos_recurrentes;
DROP POLICY IF EXISTS "gastos_recurrentes_delete_scoped" ON public.gastos_recurrentes;

CREATE POLICY "gastos_recurrentes_select_scoped"
ON public.gastos_recurrentes
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "gastos_recurrentes_insert_scoped"
ON public.gastos_recurrentes
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "gastos_recurrentes_update_scoped"
ON public.gastos_recurrentes
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "gastos_recurrentes_delete_scoped"
ON public.gastos_recurrentes
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.presupuestos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presupuestos_select_scoped" ON public.presupuestos;
DROP POLICY IF EXISTS "presupuestos_insert_scoped" ON public.presupuestos;
DROP POLICY IF EXISTS "presupuestos_update_scoped" ON public.presupuestos;
DROP POLICY IF EXISTS "presupuestos_delete_scoped" ON public.presupuestos;

CREATE POLICY "presupuestos_select_scoped"
ON public.presupuestos
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "presupuestos_insert_scoped"
ON public.presupuestos
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "presupuestos_update_scoped"
ON public.presupuestos
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "presupuestos_delete_scoped"
ON public.presupuestos
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.collection_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can insert collection reminders" ON public.collection_reminders;
DROP POLICY IF EXISTS "Authenticated can read collection reminders" ON public.collection_reminders;
DROP POLICY IF EXISTS "collection_reminders_select_scoped" ON public.collection_reminders;
DROP POLICY IF EXISTS "collection_reminders_insert_scoped" ON public.collection_reminders;
DROP POLICY IF EXISTS "collection_reminders_update_scoped" ON public.collection_reminders;
DROP POLICY IF EXISTS "collection_reminders_delete_scoped" ON public.collection_reminders;

CREATE POLICY "collection_reminders_select_scoped"
ON public.collection_reminders
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "collection_reminders_insert_scoped"
ON public.collection_reminders
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "collection_reminders_update_scoped"
ON public.collection_reminders
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "collection_reminders_delete_scoped"
ON public.collection_reminders
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));

ALTER TABLE public.bank_import_column_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_import_configs_authenticated_select" ON public.bank_import_column_configs;
DROP POLICY IF EXISTS "bank_import_configs_authenticated_write" ON public.bank_import_column_configs;
DROP POLICY IF EXISTS "bank_import_configs_select_scoped" ON public.bank_import_column_configs;
DROP POLICY IF EXISTS "bank_import_configs_insert_scoped" ON public.bank_import_column_configs;
DROP POLICY IF EXISTS "bank_import_configs_update_scoped" ON public.bank_import_column_configs;
DROP POLICY IF EXISTS "bank_import_configs_delete_scoped" ON public.bank_import_column_configs;

CREATE POLICY "bank_import_configs_select_scoped"
ON public.bank_import_column_configs
FOR SELECT
TO authenticated
USING (public.is_global_admin() OR public.has_company_membership(empresa_id));

CREATE POLICY "bank_import_configs_insert_scoped"
ON public.bank_import_column_configs
FOR INSERT
TO authenticated
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "bank_import_configs_update_scoped"
ON public.bank_import_column_configs
FOR UPDATE
TO authenticated
USING (public.can_write_company(empresa_id))
WITH CHECK (public.can_write_company(empresa_id));

CREATE POLICY "bank_import_configs_delete_scoped"
ON public.bank_import_column_configs
FOR DELETE
TO authenticated
USING (public.can_write_company(empresa_id));
