-- Idempotent catch-up for live DBs that may have missed part of 20260409_social_planner.sql.
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS.

begin;

create table if not exists public.social_day_entries (
  id uuid primary key default gen_random_uuid(),
  planner_id uuid not null references public.social_planners(id) on delete cascade,
  entry_date date not null,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_day_entries_unique_author_day unique (planner_id, entry_date, author_user_id)
);

create index if not exists social_day_entries_planner_date_idx
  on public.social_day_entries (planner_id, entry_date);

alter table public.social_day_entries enable row level security;

drop policy if exists social_day_entries_select_for_members on public.social_day_entries;
create policy social_day_entries_select_for_members
on public.social_day_entries
for select
using (public.is_active_social_member(planner_id));

drop policy if exists social_day_entries_insert_own on public.social_day_entries;
create policy social_day_entries_insert_own
on public.social_day_entries
for insert
with check (
  author_user_id = auth.uid()
  and public.is_active_social_member(planner_id)
);

drop policy if exists social_day_entries_update_own on public.social_day_entries;
create policy social_day_entries_update_own
on public.social_day_entries
for update
using (
  author_user_id = auth.uid()
  and public.is_active_social_member(planner_id)
)
with check (
  author_user_id = auth.uid()
  and public.is_active_social_member(planner_id)
);

commit;
