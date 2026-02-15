-- Run this in Supabase SQL Editor to create the user_settings table for Premium features.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  language text not null default 'en',
  region text not null default 'US',
  week_start smallint not null default -1, -- -1 = auto, 0 = Sunday, 1 = Monday
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "user can read own settings"
on public.user_settings for select
using (auth.uid() = user_id);

create policy "user can insert own settings"
on public.user_settings for insert
with check (auth.uid() = user_id);

create policy "user can update own settings"
on public.user_settings for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_settings_updated_at on public.user_settings;

create trigger trg_user_settings_updated_at
before update on public.user_settings
for each row execute function public.touch_updated_at();
