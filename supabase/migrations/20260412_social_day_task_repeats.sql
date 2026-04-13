-- Social planner tasks: recurrence fields + per-occurrence completions (Page 2 parity).

begin;

alter table public.social_day_tasks
  add column if not exists start_date date,
  add column if not exists repeat_mode text not null default 'none',
  add column if not exists repeat_interval integer not null default 1,
  add column if not exists repeat_until date,
  add column if not exists repeat_sinedays integer[] not null default '{}';

update public.social_day_tasks
set start_date = coalesce(start_date, task_date)
where start_date is null;

alter table public.social_day_tasks
  alter column start_date set not null;

alter table public.social_day_tasks
  drop constraint if exists social_day_tasks_repeat_mode_check;

alter table public.social_day_tasks
  add constraint social_day_tasks_repeat_mode_check
  check (repeat_mode in ('none', 'daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'sineday'));

create table if not exists public.social_day_task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.social_day_tasks(id) on delete cascade,
  planner_id uuid not null references public.social_planners(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint social_day_task_completions_unique unique (task_id, occurrence_date)
);

create index if not exists social_day_task_completions_planner_date_idx
  on public.social_day_task_completions (planner_id, occurrence_date, author_user_id);

insert into public.social_day_task_completions (task_id, planner_id, author_user_id, occurrence_date)
select id, planner_id, author_user_id, task_date
from public.social_day_tasks
where is_completed = true
on conflict (task_id, occurrence_date) do nothing;

alter table public.social_day_task_completions enable row level security;

drop policy if exists social_day_task_completions_select_for_members on public.social_day_task_completions;
create policy social_day_task_completions_select_for_members
on public.social_day_task_completions
for select
using (
  exists (
    select 1
    from public.social_planner_members m
    where m.planner_id = social_day_task_completions.planner_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
);

drop policy if exists social_day_task_completions_insert_own on public.social_day_task_completions;
create policy social_day_task_completions_insert_own
on public.social_day_task_completions
for insert
with check (
  author_user_id = auth.uid()
  and public.is_active_social_member(planner_id)
);

drop policy if exists social_day_task_completions_delete_own on public.social_day_task_completions;
create policy social_day_task_completions_delete_own
on public.social_day_task_completions
for delete
using (author_user_id = auth.uid());

commit;
