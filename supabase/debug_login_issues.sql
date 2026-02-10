-- 1. VERIFICAR ESTADO DEL USUARIO
select id, email, confirmed_at, last_sign_in_at, created_at
from auth.users
where email = 'aiterraz@gmail.com';

-- 2. FORZAR CONFIRMACIÓN (CORREGIDO)
-- 'confirmed_at' es una columna generada, así que solo actualizamos 'email_confirmed_at'.
update auth.users
set email_confirmed_at = now(),
    raw_app_meta_data = raw_app_meta_data || '{"provider": "email", "providers": ["email"]}'
where email = 'aiterraz@gmail.com';

-- 3. RESETEAR CONTRASEÑA MANUALMENTE (OPCIONAL)
-- Ejecuta esto SOLO si la contraseña original sigue fallando tras confirmar el email.
update auth.users
set encrypted_password = crypt('temp123456', gen_salt('bf'))
where email = 'aiterraz@gmail.com';
