-- Accounts sign in with an email and password. The API gives an anonymous player
-- an email and password (as already confirmed, so no email is sent); it asks this
-- first, because Supabase's admin update doesn't say when an email is taken.
create function public.email_in_use(p_email text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from auth.users where lower(email) = lower(p_email))
$$;

-- Only the API may run it.
revoke all on function public.email_in_use(text) from public, anon, authenticated;
grant execute on function public.email_in_use(text) to service_role;
