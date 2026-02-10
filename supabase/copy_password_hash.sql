-- 1. Capturar el hash válido del usuario dummy
DO $$
DECLARE
    valid_hash TEXT;
BEGIN
    SELECT encrypted_password INTO valid_hash
    FROM auth.users
    WHERE email = 'test_login@example.com';

    IF valid_hash IS NULL THEN
        RAISE EXCEPTION 'No se encontró el usuario dummy';
    END IF;

    -- 2. Actualizar el usuario objetivo con ese hash Y confirmar email
    UPDATE auth.users
    SET 
        encrypted_password = valid_hash,
        email_confirmed_at = now(),
        updated_at = now(),
        raw_app_meta_data = raw_app_meta_data || '{"provider": "email", "providers": ["email"]}'
    WHERE email = 'aiterraz@gmail.com';

    -- 3. Borrar el usuario dummy (para no dejar basura)
    DELETE FROM auth.users WHERE email = 'test_login@example.com';
    
    -- 4. Borrar perfil dummy si se creó (por el trigger)
    DELETE FROM public.profiles WHERE email = 'test_login@example.com'; 
END $$;

-- 5. Verificar resultado final
SELECT id, email, email_confirmed_at, updated_at 
FROM auth.users 
WHERE email = 'aiterraz@gmail.com';
