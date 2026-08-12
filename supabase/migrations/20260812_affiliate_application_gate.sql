begin;

create table public.affiliate_applications (
  id uuid primary key default gen_random_uuid(),
  -- Null is allowed because affiliate.html can be used before
  -- someone has a SineDay account.
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  display_name text not null,
  instagram text,
  tiktok text,
  youtube text,
  website text,
  other_social text,
  introduction text not null,
  source text not null default 'public'
    check (source in ('public', 'dashboard')),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'declined')),
  review_notes text,
  reviewed_at timestamptz,
  approved_at timestamptz,
  -- Filled when an approved application becomes a real Affiliate.
  affiliate_id uuid unique
    references public.affiliates(id)
    on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_applications_email_check
    check (
      email = lower(btrim(email))
      and char_length(email) between 3 and 254
      and position('@' in email) > 1
    ),
  constraint affiliate_applications_display_name_check
    check (
      char_length(btrim(display_name)) between 2 and 80
    ),
  constraint affiliate_applications_intro_check
    check (
      char_length(btrim(introduction)) between 20 and 1000
    ),
  constraint affiliate_applications_social_required_check
    check (
      nullif(btrim(coalesce(instagram, '')), '') is not null
      or nullif(btrim(coalesce(tiktok, '')), '') is not null
      or nullif(btrim(coalesce(youtube, '')), '') is not null
      or nullif(btrim(coalesce(website, '')), '') is not null
      or nullif(btrim(coalesce(other_social, '')), '') is not null
    )
);

-- One application record per email.
create unique index affiliate_applications_email_uidx
  on public.affiliate_applications (email);

-- Once associated with a SineDay account, one application per account.
create unique index affiliate_applications_user_uidx
  on public.affiliate_applications (user_id)
  where user_id is not null;

-- Your primary Supabase review queue.
create index affiliate_applications_review_queue_idx
  on public.affiliate_applications (review_status, created_at desc);

create index affiliate_applications_source_idx
  on public.affiliate_applications (source, created_at desc);

drop trigger if exists trg_affiliate_applications_updated_at
  on public.affiliate_applications;

create trigger trg_affiliate_applications_updated_at
before update on public.affiliate_applications
for each row
execute function public.set_row_updated_at();

-- Automatically timestamp Stephen's review action.
create or replace function public.set_affiliate_application_review_dates()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.review_status is distinct from old.review_status then
    if new.review_status in ('approved', 'declined') then
      new.reviewed_at = now();
    else
      new.reviewed_at = null;
    end if;

    if new.review_status = 'approved' then
      new.approved_at = coalesce(new.approved_at, now());
    else
      new.approved_at = null;
    end if;
  end if;

  return new;
end;
$$;

revoke execute
on function public.set_affiliate_application_review_dates()
from public, anon, authenticated;

drop trigger if exists trg_affiliate_applications_review_dates
  on public.affiliate_applications;

create trigger trg_affiliate_applications_review_dates
before update of review_status
on public.affiliate_applications
for each row
execute function public.set_affiliate_application_review_dates();

-- Defense in depth.
alter table public.affiliate_applications
enable row level security;

-- The browser NEVER talks directly to this table.
revoke all
on public.affiliate_applications
from anon, authenticated;

-- Only serverless routes using the service-role client write/read it.
grant all
on public.affiliate_applications
to service_role;

commit;
