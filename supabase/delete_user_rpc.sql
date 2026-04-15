-- Legacy entrypoint kept for compatibility.
-- Users are deactivated instead of physically deleted.
create or replace function public.delete_user_completely(user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  perform public.deactivate_user_account(user_id, 'Desactivado desde script legacy');
end;
$$;
