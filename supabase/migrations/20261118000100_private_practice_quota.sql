create table if not exists public.private_practice_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  attempts integer not null,
  primary key (user_id, usage_date)
);

alter table public.private_practice_usage enable row level security;
revoke all on public.private_practice_usage from public, anon, authenticated;

create or replace function public.reserve_private_practice_attempt(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved integer;
begin
  insert into public.private_practice_usage as usage (user_id, usage_date, attempts)
  values (p_user_id, (now() at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_date) do update
  set attempts = usage.attempts + 1
  where usage.attempts < 5
  returning attempts into reserved;

  return 5 - reserved;
end;
$$;

revoke all on function public.reserve_private_practice_attempt(uuid) from public, anon, authenticated;
grant execute on function public.reserve_private_practice_attempt(uuid) to service_role;
