-- check if RLS is enabled on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policy to allow admins to delete any profile
DROP POLICY IF EXISTS "Enable delete for admins" ON public.profiles;

CREATE POLICY "Enable delete for admins"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  exists (
    select 1 from public.profiles
    where id = auth.uid()
    and role = 'admin'
  )
);
