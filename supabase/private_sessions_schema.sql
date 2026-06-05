-- Private session access and user-scoped language-learning data.
-- Run this in the Supabase SQL editor, then insert the one email that should
-- currently be allowed to use Start Private Session:
--
--   insert into public.private_session_access (email, note)
--   values ('allowed-person@example.com', 'Initial private-session tester');
--
-- Add more rows later when access should be driven by the allow-list table.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

create table if not exists public.private_session_access (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.private_session_access is
  'Email allow-list for Start Private Session. A user can start private sessions only when their authenticated email has an active row.';
comment on column public.private_session_access.email is
  'Authenticated Supabase email address allowed to access private sessions.';
comment on column public.private_session_access.active is
  'Set false to revoke access without deleting history.';

create or replace function public.private_session_access_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists private_session_access_set_updated_at on public.private_session_access;
create trigger private_session_access_set_updated_at
before update on public.private_session_access
for each row execute function public.private_session_access_updated_at();

create or replace function public.has_private_session_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.private_session_access access
    where access.email = nullif(auth.jwt() ->> 'email', '')::citext
      and access.active = true
  );
$$;

revoke all on function public.has_private_session_access() from public;
grant execute on function public.has_private_session_access() to authenticated;

alter table public.private_session_access enable row level security;

-- Authenticated users can only see their own active allow-list row. The table
-- is managed by project owners/service-role code, not directly by browsers.
drop policy if exists "Users can read their own active private-session access" on public.private_session_access;
create policy "Users can read their own active private-session access"
on public.private_session_access
for select
to authenticated
using (
  email = nullif(auth.jwt() ->> 'email', '')::citext
  and active = true
);

revoke all on public.private_session_access from anon;
revoke all on public.private_session_access from authenticated;
grant select on public.private_session_access to authenticated;

create table if not exists public.user_languages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  language_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, language_name)
);

create table if not exists public.language_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_language_id uuid not null references public.user_languages(id) on delete cascade,
  source_text text not null,
  source_word_count integer not null check (source_word_count >= 0 and source_word_count <= 1200),
  created_at timestamptz not null default now()
);

create table if not exists public.material_sentences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.language_materials(id) on delete cascade,
  position integer not null check (position >= 0),
  source_text text not null,
  english_text text,
  created_at timestamptz not null default now(),
  unique (material_id, position)
);

create table if not exists public.material_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.language_materials(id) on delete cascade,
  source_word text not null,
  normalized_word text not null,
  english_text text,
  frequency integer not null default 1 check (frequency > 0),
  created_at timestamptz not null default now(),
  unique (material_id, normalized_word)
);

create table if not exists public.language_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_language_id uuid not null references public.user_languages(id) on delete cascade,
  title text,
  content_json jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.owned_by_current_user_with_private_session_access(row_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = row_user_id and public.has_private_session_access();
$$;

revoke all on function public.owned_by_current_user_with_private_session_access(uuid) from public;
grant execute on function public.owned_by_current_user_with_private_session_access(uuid) to authenticated;

alter table public.user_languages enable row level security;
alter table public.language_materials enable row level security;
alter table public.material_sentences enable row level security;
alter table public.material_words enable row level security;
alter table public.language_lessons enable row level security;

-- Private-session data policies: users must both own the row and be allow-listed.
drop policy if exists "Allow-listed users manage their languages" on public.user_languages;
create policy "Allow-listed users manage their languages"
on public.user_languages
for all
to authenticated
using (public.owned_by_current_user_with_private_session_access(user_id))
with check (public.owned_by_current_user_with_private_session_access(user_id));

drop policy if exists "Allow-listed users manage their materials" on public.language_materials;
create policy "Allow-listed users manage their materials"
on public.language_materials
for all
to authenticated
using (public.owned_by_current_user_with_private_session_access(user_id))
with check (
  public.owned_by_current_user_with_private_session_access(user_id)
  and exists (
    select 1
    from public.user_languages lang
    where lang.id = user_language_id
      and lang.user_id = auth.uid()
  )
);

drop policy if exists "Allow-listed users read their sentences" on public.material_sentences;
create policy "Allow-listed users read their sentences"
on public.material_sentences
for select
to authenticated
using (public.owned_by_current_user_with_private_session_access(user_id));

drop policy if exists "Allow-listed users read their words" on public.material_words;
create policy "Allow-listed users read their words"
on public.material_words
for select
to authenticated
using (public.owned_by_current_user_with_private_session_access(user_id));

drop policy if exists "Allow-listed users read their lessons" on public.language_lessons;
create policy "Allow-listed users read their lessons"
on public.language_lessons
for select
to authenticated
using (public.owned_by_current_user_with_private_session_access(user_id));

-- The Edge Function should use the service role to insert generated sentences,
-- words, and lessons after validating the caller JWT and material ownership.
revoke all on public.user_languages from anon;
revoke all on public.language_materials from anon;
revoke all on public.material_sentences from anon;
revoke all on public.material_words from anon;
revoke all on public.language_lessons from anon;

grant select, insert, update, delete on public.user_languages to authenticated;
grant select, insert on public.language_materials to authenticated;
grant select on public.material_sentences to authenticated;
grant select on public.material_words to authenticated;
grant select on public.language_lessons to authenticated;

-- Language block history for the 20×20 visualization grid.
-- Run this section in the Supabase SQL editor before using the updated
-- visualization. The app writes one row per language session. Each row records
-- the grid positions gained or lost during that session so LIFO block removal
-- can be replayed exactly from stored data.
create table if not exists public.language_block_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null,
  date date not null,
  block_added boolean not null default false,
  block_removed boolean not null default false,
  position_added_block text[] not null default '{}',
  position_removed_block text[] not null default '{}',
  punctuation numeric not null default 0,
  visible_positions text[] not null default '{}',
  hidden_positions text[] not null default '{}',
  session_sequence integer not null check (session_sequence > 0),
  operation_index integer not null default 0 check (operation_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, language, session_sequence)
);

comment on table public.language_block_history is
  'Per-session block stack history for the visualization grid. Positions are row,column coordinates in the 20×20 grid.';
comment on column public.language_block_history.block_added is
  'True when this session increased the visible block stack.';
comment on column public.language_block_history.block_removed is
  'True when this session removed one or more visible blocks using LIFO.';
comment on column public.language_block_history.position_added_block is
  'One or more row,column positions added by this session, in stack order.';
comment on column public.language_block_history.position_removed_block is
  'One or more row,column positions removed by this session, in LIFO order.';
comment on column public.language_block_history.punctuation is
  'Study-strength punctuation after the session.';

create index if not exists language_block_history_user_language_sequence_idx
  on public.language_block_history (user_id, language, session_sequence);
create index if not exists language_block_history_user_language_date_idx
  on public.language_block_history (user_id, language, date);

create or replace function public.language_block_history_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists language_block_history_set_updated_at on public.language_block_history;
create trigger language_block_history_set_updated_at
before update on public.language_block_history
for each row execute function public.language_block_history_updated_at();

alter table public.language_block_history enable row level security;

drop policy if exists "Users manage their own language block history" on public.language_block_history;
create policy "Users manage their own language block history"
on public.language_block_history
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke all on public.language_block_history from anon;
grant select, insert, update, delete on public.language_block_history to authenticated;
