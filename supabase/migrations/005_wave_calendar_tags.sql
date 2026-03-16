-- ═══════════════════════════════════════════════════════
-- 005_wave_calendar_tags.sql
-- Color tags + labels for the Interactive Wave Calendar
-- Restricted to owner profile only (is_owner = true)
-- ═══════════════════════════════════════════════════════

create table if not exists public.wave_calendar_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tag_date date not null,
  color text not null default '',
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One tag per profile per day
  unique(profile_id, tag_date)
);

-- Index for fast lookups by profile + date range
create index if not exists idx_wave_cal_tags_profile_date
  on public.wave_calendar_tags(profile_id, tag_date);

-- Row Level Security
alter table public.wave_calendar_tags enable row level security;

-- Owner-only policies (same pattern as planner_notes)
create policy "user can read own wave calendar tags"
  on public.wave_calendar_tags for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and is_owner = true
    )
  );

create policy "user can insert own wave calendar tags"
  on public.wave_calendar_tags for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and is_owner = true
    )
  );

create policy "user can update own wave calendar tags"
  on public.wave_calendar_tags for update
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

create policy "user can delete own wave calendar tags"
  on public.wave_calendar_tags for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and is_owner = true
    )
  );

-- Reuse existing updated_at trigger function from 001
drop trigger if exists trg_wave_cal_tags_updated_at on public.wave_calendar_tags;

create trigger trg_wave_cal_tags_updated_at
  before update on public.wave_calendar_tags
  for each row execute function public.touch_updated_at();
