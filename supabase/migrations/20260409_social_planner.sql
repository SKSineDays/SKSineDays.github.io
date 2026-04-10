-- Social planner: shared calendar, friend requests, member-scoped notes/tasks.
-- Service-role-only helper for server APIs (never granted to anon/authenticated).

begin;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- Resolve auth user id by email (server-side only).
create or replace function public.lookup_auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth
stable
as $$
  select id
  from auth.users
  where lower(trim(email)) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.lookup_auth_user_id_by_email(text) from public;
grant execute on function public.lookup_auth_user_id_by_email(text) to service_role;

create or replace function public.is_active_social_member(p_planner_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.social_planner_members m
    where m.planner_id = p_planner_id
      and m.user_id = coalesce(p_user_id, auth.uid())
      and m.status = 'active'
  );
$$;

create table if not exists public.social_planners (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Social Planner',
  timezone text not null default 'America/Chicago',
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_planners_owner_user_id_key unique (owner_user_id)
);

create table if not exists public.social_planner_members (
  id uuid primary key default gen_random_uuid(),
  planner_id uuid not null references public.social_planners(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  invited_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint social_planner_members_planner_user_key unique (planner_id, user_id)
);

create table if not exists public.social_friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  requester_display_name text not null,
  requester_email text not null,
  recipient_email text not null,
  recipient_user_id uuid references auth.users(id) on delete set null,
  planner_id uuid not null references public.social_planners(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  responded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz
);

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  friend_email text not null,
  friend_display_name text not null,
  friend_owner_profile_id uuid references public.profiles(id) on delete set null,
  source_request_id uuid references public.social_friend_requests(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint social_connections_user_friend_key unique (user_id, friend_user_id)
);

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

create table if not exists public.social_day_tasks (
  id uuid primary key default gen_random_uuid(),
  planner_id uuid not null references public.social_planners(id) on delete cascade,
  task_date date not null,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  is_completed boolean not null default false,
  completed_at timestamptz,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.social_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('friend_request', 'friend_accept', 'planner_update', 'task_added', 'task_completed')),
  title text not null,
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  read_at timestamptz
);

create index if not exists social_planner_members_user_idx
  on public.social_planner_members (user_id, status, created_at desc);

create index if not exists social_friend_requests_recipient_email_idx
  on public.social_friend_requests (recipient_email, status, created_at desc);

create unique index if not exists social_friend_requests_pending_uq
  on public.social_friend_requests (requester_user_id, planner_id, recipient_email)
  where status = 'pending';

create index if not exists social_connections_user_idx
  on public.social_connections (user_id, created_at desc);

create index if not exists social_day_entries_planner_date_idx
  on public.social_day_entries (planner_id, entry_date);

create index if not exists social_day_tasks_planner_date_idx
  on public.social_day_tasks (planner_id, task_date, is_archived);

create index if not exists social_notifications_user_unread_idx
  on public.social_notifications (user_id, is_read, created_at desc);

drop trigger if exists trg_social_planners_updated_at on public.social_planners;
create trigger trg_social_planners_updated_at
before update on public.social_planners
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_social_planner_members_updated_at on public.social_planner_members;
create trigger trg_social_planner_members_updated_at
before update on public.social_planner_members
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_social_friend_requests_updated_at on public.social_friend_requests;
create trigger trg_social_friend_requests_updated_at
before update on public.social_friend_requests
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_social_day_entries_updated_at on public.social_day_entries;
create trigger trg_social_day_entries_updated_at
before update on public.social_day_entries
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_social_day_tasks_updated_at on public.social_day_tasks;
create trigger trg_social_day_tasks_updated_at
before update on public.social_day_tasks
for each row execute function public.set_row_updated_at();

alter table public.social_planners enable row level security;
alter table public.social_planner_members enable row level security;
alter table public.social_friend_requests enable row level security;
alter table public.social_connections enable row level security;
alter table public.social_day_entries enable row level security;
alter table public.social_day_tasks enable row level security;
alter table public.social_notifications enable row level security;

drop policy if exists social_planners_select_for_members on public.social_planners;
create policy social_planners_select_for_members
on public.social_planners
for select
using (
  owner_user_id = auth.uid()
  or public.is_active_social_member(id)
);

drop policy if exists social_planners_update_for_owner on public.social_planners;
create policy social_planners_update_for_owner
on public.social_planners
for update
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists social_planner_members_select_for_members on public.social_planner_members;
create policy social_planner_members_select_for_members
on public.social_planner_members
for select
using (public.is_active_social_member(planner_id));

drop policy if exists social_friend_requests_select_for_parties on public.social_friend_requests;
create policy social_friend_requests_select_for_parties
on public.social_friend_requests
for select
using (
  requester_user_id = auth.uid()
  or lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

-- Inserts only via service role (Premium-checked API). No client INSERT policy.

drop policy if exists social_friend_requests_insert_for_requester on public.social_friend_requests;

-- Updates (accept/decline) only via service role API to keep membership + rows in sync.

drop policy if exists social_friend_requests_update_for_parties on public.social_friend_requests;

drop policy if exists social_connections_select_own on public.social_connections;
create policy social_connections_select_own
on public.social_connections
for select
using (user_id = auth.uid());

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

drop policy if exists social_day_tasks_select_for_members on public.social_day_tasks;
create policy social_day_tasks_select_for_members
on public.social_day_tasks
for select
using (public.is_active_social_member(planner_id));

drop policy if exists social_day_tasks_insert_own on public.social_day_tasks;
create policy social_day_tasks_insert_own
on public.social_day_tasks
for insert
with check (
  author_user_id = auth.uid()
  and public.is_active_social_member(planner_id)
);

drop policy if exists social_day_tasks_update_own on public.social_day_tasks;
create policy social_day_tasks_update_own
on public.social_day_tasks
for update
using (
  author_user_id = auth.uid()
  and public.is_active_social_member(planner_id)
)
with check (
  author_user_id = auth.uid()
  and public.is_active_social_member(planner_id)
);

drop policy if exists social_notifications_select_own on public.social_notifications;
create policy social_notifications_select_own
on public.social_notifications
for select
using (user_id = auth.uid());

drop policy if exists social_notifications_update_own on public.social_notifications;
create policy social_notifications_update_own
on public.social_notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

commit;
