-- ═══════════════════════════════════════════════════════
-- 003_planner_notes.sql
-- Cloud-synced daily planner notes for premium dashboard
-- Notes are restricted to owner profile only (is_owner = true)
-- ═══════════════════════════════════════════════════════

create table if not exists public.planner_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  note_date date not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One note per profile per day
  unique(profile_id, note_date)
);

-- Index for fast lookups by user + date range
create index if not exists idx_planner_notes_user_date
  on public.planner_notes(user_id, note_date);

create index if not exists idx_planner_notes_profile_date
  on public.planner_notes(profile_id, note_date);

-- Row Level Security
alter table public.planner_notes enable row level security;

-- Drop existing policies if re-running (e.g. after 002_planner_notes)
drop policy if exists "user can read own planner notes" on public.planner_notes;
drop policy if exists "user can insert own planner notes" on public.planner_notes;
drop policy if exists "user can update own planner notes" on public.planner_notes;
drop policy if exists "user can delete own planner notes" on public.planner_notes;

-- Owner-only: notes may only be read for profiles where is_owner = true
create policy "user can read own planner notes"
  on public.planner_notes for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and is_owner = true
    )
  );

create policy "user can insert own planner notes"
  on public.planner_notes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and is_owner = true
    )
  );

create policy "user can update own planner notes"
  on public.planner_notes for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and is_owner = true
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and is_owner = true
    )
  );

create policy "user can delete own planner notes"
  on public.planner_notes for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and is_owner = true
    )
  );

-- Reuse the existing updated_at trigger function from 001
drop trigger if exists trg_planner_notes_updated_at on public.planner_notes;

create trigger trg_planner_notes_updated_at
  before update on public.planner_notes
  for each row execute function public.touch_updated_at();
