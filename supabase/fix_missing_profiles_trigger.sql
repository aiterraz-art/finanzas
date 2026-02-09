-- 1. Create/Ro-create the function to handle new user creation
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, email, role, created_at)
  values (
    new.id, 
    new.email, 
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    extract(epoch from now())
  )
  on conflict (id) do nothing; -- Prevent errors if profile exists
  return new;
end;
$$ language plpgsql security definer;

-- 2. Ensure the trigger exists
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3. Backfill missing profiles (CRITICAL FIX)
-- This inserts profiles for any user in auth.users that doesn't have a corresponding profile
insert into public.profiles (id, email, role, created_at)
select 
  id, 
  email, 
  coalesce(raw_user_meta_data->>'role', 'user'),
  extract(epoch from now())
from auth.users
where id not in (select id from public.profiles);
