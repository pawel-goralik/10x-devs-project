-- create groups, group_members, profiles
--
-- purpose: schema for the "form-and-manage-a-group" feature (roadmap s-02): a user
-- creates a named group, invites others via a shareable link (a standing, reusable
-- invite_token — no per-invite tracking/expiry/revocation for this mvp), accepts an
-- invite (even as a brand-new user with no account yet), and leaves a group.
--
-- profiles is introduced here as shared cross-user identity infrastructure: auth.users
-- is not exposed via supabase's data api, and s-03 (witness-the-circles-goals) will need
-- the identical capability to show another member's email, so it's built once now
-- rather than solved twice.
--
-- security model: this app's supabase key is the browsable `authenticated`-role key, not
-- a server-only service key, so rls is the only real access gate. a permissive
-- `using (true)` select policy on groups would let any authenticated user enumerate
-- every group's invite_token via the client sdk. invite preview/join therefore go
-- through narrow `security definer` rpc functions (get_group_preview,
-- join_group_by_token) that look up the one row matching an exact token argument,
-- rather than through a general-purpose select policy.
--
-- note: created_by/user_id have no "on delete" action (matching goals.user_id's
-- precedent) — fr-014 (account deletion) must explicitly detach identities rather than
-- silently cascading a destructive delete.

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null,
  invite_token uuid not null default gen_random_uuid() unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint groups_name_not_blank check (char_length(trim(name)) > 0)
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_id_idx on public.group_members (user_id);

-- standard supabase profile-sync pattern: a thin, rls-friendly mirror of auth.users'
-- email so other users' identities can be displayed (auth.users itself isn't queryable
-- via the data api). accepted limitation: handle_new_user only fires on insert, not on
-- an email change, so profiles.email would go stale if a user ever changes their auth
-- email. no email-change feature exists anywhere in this app today — this is a
-- deliberate, accepted gap, not an oversight; revisit if such a feature is ever built.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.profiles enable row level security;

-- supabase's default privileges only cover truncate/references/trigger on new public
-- schema tables — select/insert/update/delete must be granted explicitly, independent
-- of the rls policies below (grants and rls are separate authorization layers).
grant select, insert on public.groups to authenticated;
grant select, insert on public.groups to service_role;

grant select, insert, delete on public.group_members to authenticated;
grant select, insert, delete on public.group_members to service_role;

grant select on public.profiles to authenticated;
grant select, insert on public.profiles to service_role;

-- rls-recursion-avoidance helper: group_members' "a member can see the membership rows
-- of every group they belong to" policy cannot be written as a raw subquery against
-- group_members itself — postgres detects the self-reference and raises "infinite
-- recursion detected in policy for relation group_members" at query time. running this
-- check as security definer means its internal query bypasses rls instead of
-- re-triggering the same policy. reused by groups' select policy for consistency, even
-- though that one isn't self-referential.
create function public.is_member_of(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  );
$$;

-- select: a member can see the groups they belong to.
create policy "groups_select_member" on public.groups
  for select
  to authenticated
  using (public.is_member_of(id, auth.uid()));

-- insert: a user can only create a group they themselves are the creator of.
create policy "groups_insert_own" on public.groups
  for insert
  to authenticated
  with check (auth.uid() = created_by);

-- select: a creator can always see a group they created, independent of current
-- membership. required for create_group's `insert ... returning id` to succeed —
-- postgres re-checks the select policy on a returned row, and at that exact point the
-- creator's own group_members row doesn't exist yet (it's the function's second
-- statement), so groups_select_member alone would reject the insert's own RETURNING.
-- multiple permissive policies for the same command combine with OR.
create policy "groups_select_own_created" on public.groups
  for select
  to authenticated
  using (auth.uid() = created_by);

-- select: a member can see the membership rows of every group they belong to
-- (via is_member_of, to avoid the self-reference recursion described above).
create policy "group_members_select_fellow_members" on public.group_members
  for select
  to authenticated
  using (public.is_member_of(group_id, auth.uid()));

-- insert: a user can only insert their own membership row (used by create_group's
-- self-membership insert and join_group_by_token's join insert).
create policy "group_members_insert_own" on public.group_members
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- delete: a user can only remove their own membership row — the leave action.
create policy "group_members_delete_own" on public.group_members
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- select: a user can see their own profile, or the profile of anyone they share a
-- group with (needed to display fellow members' emails on the group detail page).
create policy "profiles_select_self_or_shared_group" on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.group_members gm_self
      join public.group_members gm_other on gm_other.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid() and gm_other.user_id = profiles.id
    )
  );

-- keeps profiles in sync with auth.users on sign-up. security definer is required
-- because this trigger fires on auth.users, a schema the invoking role can't write to
-- directly.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- wraps the group-creation + self-membership inserts in one transaction so a failure
-- partway through can't leave an orphaned group with no members. no security definer
-- needed — both statements are actions the caller is already allowed to perform under
-- the rls policies above.
create function public.create_group(p_name text)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  insert into public.groups (name, created_by)
  values (p_name, auth.uid())
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id)
  values (v_group_id, auth.uid());

  return v_group_id;
end;
$$;

-- lets a visitor preview an invite (group name + creator email + whether they're
-- already a member) before joining, without needing a permissive groups select policy
-- that would expose every invite_token to any authenticated user.
create function public.get_group_preview(p_invite_token uuid)
returns table (
  group_id uuid,
  group_name text,
  creator_email text,
  already_member boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    g.id as group_id,
    g.name as group_name,
    p.email as creator_email,
    exists (
      select 1
      from public.group_members gm
      where gm.group_id = g.id and gm.user_id = auth.uid()
    ) as already_member
  from public.groups g
  join public.profiles p on p.id = g.created_by
  where g.invite_token = p_invite_token;
$$;

-- resolves the group from the token server-side and joins the caller. on conflict do
-- nothing makes re-clicking an already-used invite link a harmless no-op, not an error.
create function public.join_group_by_token(p_invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  select id into v_group_id
  from public.groups
  where invite_token = p_invite_token;

  if v_group_id is null then
    return null;
  end if;

  insert into public.group_members (group_id, user_id)
  values (v_group_id, auth.uid())
  on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

-- postgres grants execute to PUBLIC by default on function creation — revoke it
-- explicitly before the authenticated-only grants below, otherwise the anon role
-- (part of PUBLIC) retains callable access to these security definer functions
-- regardless of the grants that follow.
revoke execute on function public.is_member_of(uuid, uuid) from public;
revoke execute on function public.create_group(text) from public;
revoke execute on function public.get_group_preview(uuid) from public;
revoke execute on function public.join_group_by_token(uuid) from public;

-- is_member_of is invoked from inside the groups/group_members RLS policies above,
-- which run under the querying (authenticated) role — it needs its own execute grant
-- for those policies to succeed, distinct from the tables' own select grants.
grant execute on function public.is_member_of(uuid, uuid) to authenticated;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group_by_token(uuid) to authenticated;

-- get_group_preview is deliberately callable by anon as well as authenticated
-- (revised 2026-08-31): the invite-confirm screen must show the group name and
-- creator's email to whoever holds the exact token *before* asking them to sign in —
-- signing up blind, with no idea what they're agreeing to, is worse UX for a brand-new
-- invitee. This is safe: the function only ever returns a row for the one group whose
-- invite_token exactly matches the argument (never a scan/enumeration), and
-- already_member simply evaluates to false for anon (auth.uid() is null), which is
-- always correct for a visitor with no account.
grant execute on function public.get_group_preview(uuid) to authenticated, anon;
