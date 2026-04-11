begin;

create table if not exists public.social_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_email text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint social_blocks_user_blocked_key unique (user_id, blocked_user_id)
);

create index if not exists social_blocks_user_idx
  on public.social_blocks (user_id, created_at desc);

alter table public.social_blocks enable row level security;

drop policy if exists social_blocks_select_own on public.social_blocks;
create policy social_blocks_select_own
on public.social_blocks
for select
using (user_id = auth.uid());

drop policy if exists social_notifications_delete_own on public.social_notifications;
create policy social_notifications_delete_own
on public.social_notifications
for delete
using (user_id = auth.uid());

commit;
