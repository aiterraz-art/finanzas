-- Trigger para confirmar automáticamente a los usuarios nuevos
-- Útil para instancias self-hosted donde no se puede desactivar "Confirm Email" desde la UI.

CREATE OR REPLACE FUNCTION public.auto_confirm_new_users()
RETURNS TRIGGER AS $$
BEGIN
    -- Establecer la fecha de confirmación al momento de creación
    NEW.email_confirmed_at = NOW();
    -- Asegurar que los metadatos indiquen proveedor email (opcional pero recomendado)
    IF NEW.raw_app_meta_data IS NULL THEN
        NEW.raw_app_meta_data = '{"provider": "email", "providers": ["email"]}'::jsonb;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar trigger si ya existe para evitar duplicados
DROP TRIGGER IF EXISTS on_auth_user_created_auto_confirm ON auth.users;

-- Crear el trigger "BEFORE INSERT" para que se guarde ya confirmado
CREATE TRIGGER on_auth_user_created_auto_confirm
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_new_users();
