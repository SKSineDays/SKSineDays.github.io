-- Add origin_day to subscriber_profile (1–18, from owner birthdate)
-- Run in Supabase SQL editor

alter table public.subscriber_profile
  add column if not exists origin_day smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriber_profile_origin_day_range_chk'
  ) then
    alter table public.subscriber_profile
      add constraint subscriber_profile_origin_day_range_chk
      check (origin_day is null or (origin_day >= 1 and origin_day <= 18));
  end if;
end $$;

create index if not exists idx_subscriber_profile_origin_day
  on public.subscriber_profile (origin_day);
