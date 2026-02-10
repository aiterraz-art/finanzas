-- NUCLEAR FIX por si todo lo demás falla
-- Ejecuta TODAS las líneas a continuación

-- 1. Asegurar que la extensión de encriptación está activa
create extension if not exists "pgcrypto" with schema extensions;

-- 2. Forzar actualización de TODOS los campos relevantes
update auth.users
set 
    -- Forzar contraseña a: temp123456
    encrypted_password = extensions.crypt('temp123456', extensions.gen_salt('bf')),
    
    -- Forzar confirmación
    email_confirmed_at = now(),
    
    -- Forzar rol y audiencia correctos
    aud = 'authenticated',
    role = 'authenticated',
    
    -- Limpiar bloqueos
    banned_until = null,
    
    -- Asegurar metadata mínima (provider email)
    raw_app_meta_data = '{"provider": "email", "providers": ["email"]}'::jsonb
where email = 'aiterraz@gmail.com';

-- 3. Verificar el resultado (debe devolver 1 fila con la fecha de hoy en email_confirmed_at)
select id, email, role, aud, email_confirmed_at 
from auth.users 
where email = 'aiterraz@gmail.com';
