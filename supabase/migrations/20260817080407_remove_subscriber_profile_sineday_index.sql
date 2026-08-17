-- Remove the obsolete zero-based Origin Day duplicate.
-- origin_day is the canonical permanent 1–18 value.
-- Existing subscriber and origin_day values are intentionally unchanged.
alter table public.subscriber_profile
  drop column if exists sineday_index;
