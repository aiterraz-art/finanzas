-- Confirmar al usuario aiterraz@gmail.com (CORREGIDO)
-- 'confirmed_at' es una columna generada, así que SOLO actualizamos 'email_confirmed_at'
UPDATE auth.users
SET 
    email_confirmed_at = now(),
    updated_at = now(),
    raw_app_meta_data = raw_app_meta_data || '{"provider": "email", "providers": ["email"]}'
WHERE email = 'aiterraz@gmail.com';

-- Verificar si quedó confirmado
select email, email_confirmed_at from auth.users where email = 'aiterraz@gmail.com';
