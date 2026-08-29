-- create goals table
--
-- purpose: store user-committed goals for the "commit-a-goal" feature (roadmap S-01).
-- a goal has a one-line description and exactly one measure: a numeric target or a
-- yes/no (boolean) outcome. the discriminated shape is enforced by goals_measure_shape
-- below. the 24-hour edit/delete window (fr-006) is deliberately NOT enforced here —
-- it's enforced in the application service layer (src/lib/services/goals.ts), per the
-- prd's access control section ("enforced at the product surface... not cryptographic
-- tamper-proofing"). rls below only ever checks row ownership.
--
-- note: user_id has no "on delete" action (defaults to "no action"). this is deliberate:
-- fr-014 requires a deleted user's goals to persist, anonymized to "former member," not
-- be removed. the default will block supabase's user-deletion with a foreign-key
-- violation while the user still has goals, forcing a future account-deletion feature
-- to explicitly detach user_id first rather than silently cascading a destructive delete.

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  description varchar(255) not null,
  measure_type text not null check (measure_type in ('numeric', 'boolean')),
  target_value numeric,
  current_value numeric,
  is_done boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_description_not_blank check (char_length(trim(description)) > 0),
  constraint goals_measure_shape check (
    (measure_type = 'numeric' and target_value > 0 and current_value is not null and current_value >= 0 and is_done is null)
    or
    (measure_type = 'boolean' and target_value is null and current_value is null and is_done is not null)
  )
);

create index goals_user_id_idx on public.goals (user_id);

alter table public.goals enable row level security;

-- supabase's default privileges only cover truncate/references/trigger on new public
-- schema tables — select/insert/update/delete must be granted explicitly, independent
-- of the rls policies below (grants and rls are separate authorization layers; without
-- these, postgres denies access before rls policies are even evaluated).
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.goals to service_role;

-- select: an authenticated user can see only their own goals.
-- note for a future s-03 (witness-the-circles-goals) implementer: this policy will need
-- to widen to also allow access when the goal's author shares a group with the
-- requester, once group_members exists. that widening is s-03's responsibility.
create policy "goals_select_own" on public.goals
  for select
  to authenticated
  using (auth.uid() = user_id);

-- insert: an authenticated user can only insert goals they own.
create policy "goals_insert_own" on public.goals
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- update: an authenticated user can only update their own goals. the 24-hour window is
-- enforced by the application query's own WHERE clause (created_at > cutoff), not here.
create policy "goals_update_own" on public.goals
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- delete: an authenticated user can only delete their own goals. same note as update.
create policy "goals_delete_own" on public.goals
  for delete
  to authenticated
  using (auth.uid() = user_id);
