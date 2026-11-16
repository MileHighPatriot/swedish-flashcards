-- Svenska Kort sync. Paste this once into the SQL editor of a Supabase project.
-- It is safe to run again, and safe to add to a project that other apps use:
-- everything it creates is named svenska_*.
--
-- One table holds every synced row (decks, cards, reviews, …) as JSON.
-- Each signed-in user can only ever see and change their own rows.

create table if not exists public.svenska_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  store text not null,
  id text not null,
  -- The device's own "last changed" time. The newer copy wins.
  updated_at timestamptz not null,
  deleted boolean not null default false,
  data jsonb not null,
  -- When the server took the row. Devices ask for "everything since" by this.
  server_at timestamptz not null default clock_timestamp(),
  primary key (user_id, store, id)
);

create index if not exists svenska_records_user_server_at on public.svenska_records (user_id, server_at);

alter table public.svenska_records enable row level security;

drop policy if exists "svenska read own" on public.svenska_records;
create policy "svenska read own" on public.svenska_records
  for select using (auth.uid() = user_id);

drop policy if exists "svenska add own" on public.svenska_records;
create policy "svenska add own" on public.svenska_records
  for insert with check (auth.uid() = user_id);

drop policy if exists "svenska change own" on public.svenska_records;
create policy "svenska change own" on public.svenska_records
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Takes a batch of rows and keeps, per row, whichever copy changed most recently.
create or replace function public.svenska_push_records(rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  changed integer;
begin
  insert into public.svenska_records (user_id, store, id, updated_at, deleted, data, server_at)
  select
    auth.uid(),
    r ->> 'store',
    r ->> 'id',
    (r ->> 'updated_at')::timestamptz,
    coalesce((r ->> 'deleted')::boolean, false),
    r -> 'data',
    clock_timestamp()
  from jsonb_array_elements(rows) as r
  on conflict (user_id, store, id) do update
    set updated_at = excluded.updated_at,
        deleted = excluded.deleted,
        data = excluded.data,
        server_at = clock_timestamp()
    where excluded.updated_at > public.svenska_records.updated_at;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.svenska_push_records(jsonb) from public, anon;
grant execute on function public.svenska_push_records(jsonb) to authenticated;
