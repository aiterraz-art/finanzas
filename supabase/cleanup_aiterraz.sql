-- Borrar completamente el usuario corrupto para permitir re-invitación limpia
DELETE FROM auth.users WHERE email = 'aiterraz@gmail.com';
DELETE FROM public.profiles WHERE email = 'aiterraz@gmail.com';
