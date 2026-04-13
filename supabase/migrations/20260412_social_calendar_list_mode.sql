-- Social Planner: multiple calendars per owner; friend requests no longer tied to a planner.

begin;

alter table public.social_planners
  drop constraint if exists social_planners_owner_user_id_key;

create index if not exists social_planners_owner_active_idx
  on public.social_planners (owner_user_id, is_archived, created_at desc);

create index if not exists social_planner_members_planner_status_idx
  on public.social_planner_members (planner_id, status, created_at desc);

alter table public.social_friend_requests
  alter column planner_id drop not null;

drop index if exists social_friend_requests_pending_uq;

create unique index if not exists social_friend_requests_pending_uq
  on public.social_friend_requests (requester_user_id, recipient_email)
  where status = 'pending';

commit;
