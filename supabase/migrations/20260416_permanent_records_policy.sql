ALTER TABLE public.terceros
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE public.rendiciones
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;

ALTER TABLE public.user_empresas
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoke_reason TEXT;

ALTER TABLE public.facturas_pagos
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'aplicado' CHECK (estado IN ('aplicado', 'revertido')),
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_terceros_archived_at
ON public.terceros (empresa_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_facturas_archived_at
ON public.facturas (empresa_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_rendiciones_archived_at
ON public.rendiciones (empresa_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_profiles_activo
ON public.profiles (activo, deactivated_at);

CREATE INDEX IF NOT EXISTS idx_user_empresas_revoked_at
ON public.user_empresas (empresa_id, user_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_facturas_pagos_estado
ON public.facturas_pagos (empresa_id, movimiento_banco_id, estado);

CREATE OR REPLACE FUNCTION public.prevent_delete_permanent_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Physical delete is disabled on %. Archive or deactivate the record instead.', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_prevent_delete_trigger(target_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  trigger_name text := 'trg_prevent_delete_' || replace(target_table::text, '.', '_');
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', trigger_name, target_table);
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION public.prevent_delete_permanent_record()',
    trigger_name,
    target_table
  );
END;
$$;

SELECT public.attach_prevent_delete_trigger('public.empresas');
SELECT public.attach_prevent_delete_trigger('public.terceros');
SELECT public.attach_prevent_delete_trigger('public.facturas');
SELECT public.attach_prevent_delete_trigger('public.movimientos_banco');
SELECT public.attach_prevent_delete_trigger('public.rendiciones');
SELECT public.attach_prevent_delete_trigger('public.rendicion_detalles');
SELECT public.attach_prevent_delete_trigger('public.facturas_pagos');
SELECT public.attach_prevent_delete_trigger('public.gastos_recurrentes');
SELECT public.attach_prevent_delete_trigger('public.presupuestos');
SELECT public.attach_prevent_delete_trigger('public.collection_reminders');
SELECT public.attach_prevent_delete_trigger('public.profiles');
SELECT public.attach_prevent_delete_trigger('public.user_empresas');
SELECT public.attach_prevent_delete_trigger('public.bank_accounts');
SELECT public.attach_prevent_delete_trigger('public.treasury_policies');
SELECT public.attach_prevent_delete_trigger('public.treasury_categories');
SELECT public.attach_prevent_delete_trigger('public.cash_commitment_templates');
SELECT public.attach_prevent_delete_trigger('public.cash_commitments');
SELECT public.attach_prevent_delete_trigger('public.collection_events');
SELECT public.attach_prevent_delete_trigger('public.bank_statement_imports');
SELECT public.attach_prevent_delete_trigger('public.cheques_cartera');
SELECT public.attach_prevent_delete_trigger('public.webpay_liquidaciones');

DROP FUNCTION IF EXISTS public.delete_user_completely(uuid);

CREATE OR REPLACE FUNCTION public.deactivate_user_account(p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND COALESCE(activo, true)
  ) THEN
    RAISE EXCEPTION 'Access denied: Only active admins can deactivate users.';
  END IF;

  UPDATE public.profiles
  SET
    activo = false,
    deactivated_at = now(),
    deactivated_by = auth.uid(),
    deactivation_reason = COALESCE(p_reason, 'Usuario desactivado')
  WHERE id = p_user_id;

  UPDATE public.user_empresas
  SET
    revoked_at = now(),
    revoked_by = auth.uid(),
    revoke_reason = COALESCE(p_reason, 'Acceso revocado por desactivación')
  WHERE user_id = p_user_id
    AND revoked_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user_completely(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.deactivate_user_account(p_user_id, 'Desactivado desde función legacy');
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_user_account(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_completely(uuid) TO authenticated;
