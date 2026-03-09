-- ═══════════════════════════════════════════════════════
-- 002_owner_profile.sql
-- Add is_owner flag to profiles table
-- ═══════════════════════════════════════════════════════

-- Add the is_owner column (default false for all existing profiles)
alter table public.profiles
  add column if not exists is_owner boolean not null default false;

-- Ensure only one owner profile per user
create unique index if not exists idx_profiles_one_owner
  on public.profiles (user_id)
  where (is_owner = true);
