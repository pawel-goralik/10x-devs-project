-- widen goals visibility to shared-group members
--
-- purpose: implements the widening anticipated by create_goals.sql's own comment on
-- goals_select_own — a group member can now see a fellow member's goal (roadmap s-03,
-- witness-the-circles-goals). additive only: multiple permissive select policies for
-- the same command combine with OR (same pattern already used for
-- groups_select_own_created alongside groups_select_member), so goals_select_own is
-- left untouched.
--
-- no new grant needed — select is already granted to authenticated on public.goals.
-- no new security definer helper function either: unlike group_members' self-reference
-- (which needed is_member_of to dodge postgres's recursion detection), goals isn't
-- self-referential, so a plain policy can join group_members directly. this mirrors
-- profiles_select_self_or_shared_group's exact join shape (create_groups.sql:137-148).
--
-- note: this policy does not gate on the 24-hour edit window — rls here only ever
-- checks group membership, never timing (matching goals_update_own/goals_delete_own's
-- own convention). the decision to only ever display fully-locked goals to the group is
-- enforced at the application query layer (src/lib/services/goals.ts's
-- listGroupMemberGoals), not here.

create policy "goals_select_shared_group" on public.goals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.group_members gm_self
      join public.group_members gm_other on gm_other.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid() and gm_other.user_id = goals.user_id
    )
  );
