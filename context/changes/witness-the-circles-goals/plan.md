# Witness the circle's goals — Implementation Plan

## Overview

Authenticated group member can see every other member's fully-locked committed goals and current progress, for each group they belong to, in a new section on that group's existing detail page (`/groups/[id]`) — this is roadmap slice S-03, the product's "north star" (PRD FR-012, US-01).

## Current State Analysis

- `goals` table (`supabase/migrations/20260829164522_create_goals.sql`) stores one row per goal with `user_id`, `description`, a discriminated `measure_type`/`target_value`/`current_value`/`is_done` shape, and `created_at` doubling as the immutability-window anchor (no separate `locked`/`is_locked` column). RLS currently only allows a user to see their own goals (`goals_select_own`) — with a comment placed in that migration explicitly anticipating this feature: *"this policy will need to widen... once group_members exists."*
- `groups`/`group_members` (`supabase/migrations/20260831123440_create_groups.sql`) is flat membership (`(group_id, user_id)` composite PK, no role column), plus a `profiles` table mirroring `auth.users.email`, built specifically so cross-user identity (a fellow member's email) can be queried through the Data API.
- `src/lib/services/groups.ts`'s `getGroupDetail(supabase, groupId)` already returns a `GroupDetail` with a `members: GroupMember[]` list ordered by `joined_at` ascending (two follow-up queries, since `group_members`/`profiles` share no direct FK) — `src/pages/groups/[id].astro` already calls this and renders that member list.
- `src/lib/services/goals.ts`'s `listGoals` is strictly single-user (`.eq("user_id", userId)`); no function today joins goals across group members. The `EDIT_WINDOW_MS` (24h) constant and the `cutoff`-based WHERE-clause pattern used by `updateGoals`/`deleteGoal` is the established convention for enforcing the edit window at the application/query layer, never in RLS.
- `GoalCard.tsx` renders a card in one of two modes today (`editable: boolean`) — but even in its non-editable ("locked own goal") mode it always renders a progress-recording dialog (`Dodaj postęp` / `Oznacz jako wykonane`) that posts to `POST /api/goals/progress`. There's no mode that hides this action, which is required before this component can display someone else's goal.

## Desired End State

Visiting `/groups/[id]` as a current member of that group, a new "Cele członków grupy" section appears below the existing invite-link/members-list/leave-group content. For every OTHER current member of the group (in the same order as the existing "Członkowie" list), it shows their fully-locked goals (created more than 24h ago) with description and current progress — with no way to edit, delete, or record progress on them. Members with no locked goals yet show a brief empty state per member. The viewer's own goals are not repeated here (they already have `/goals` for that). Leaving the group, or the goal's author leaving, immediately removes that visibility (enforced at the RLS layer, matching the "Closed-circle confinement" NFR).

### Key Discoveries:

- `supabase/migrations/20260829164522_create_goals.sql:46-49` — the `goals_select_own` policy already carries a comment planted for this exact feature, confirming the widen-via-additional-policy approach (Postgres ORs multiple permissive policies for the same command) rather than rewriting the existing policy.
- `supabase/migrations/20260831123440_create_groups.sql:137-148` (`profiles_select_self_or_shared_group`) is the exact same "do I share a group with this other user" join shape the new goals policy needs — copy its structure, not `is_member_of` (that helper exists only to dodge self-reference recursion on `group_members` itself, which doesn't apply to `goals`).
- `src/pages/groups/[id].astro:8-10` already documents an accepted gap (no not-found/non-member branch); this plan doesn't touch that — it only adds a new section further down the same template.
- `GoalCard.tsx`'s only editable-gated branch is the outer `if (!editable) {...}` at line 148 — everything needed for read-only rendering already lives in that branch; the only missing piece is suppressing `progressTrigger`.

## What We're NOT Doing

- No aggregated cross-group page — goals appear only within each group's own `/groups/[id]` page, per-group (not a unified "all my circles" view).
- No new top-level navigation entry (`Topbar.astro` is untouched) — the feature is reachable only by visiting a specific group's page.
- The viewer's own goals are not shown in this new section (they remain exclusive to `/goals`).
- Goals still inside their 24-hour edit window are NOT shown to other members — only fully-locked goals appear (a deliberate product decision made during this planning session, accepting a narrower reading than FR-012's plain "every goal" wording).
- No new SQL helper function (e.g. `shares_group_with()`) — the new RLS policy inlines the join directly, since `goals` has exactly one caller of this check today.
- No changes to the quarterly-digest feature (S-05) — out of scope for this slice; S-05 will later reuse `listGroupMemberGoals` (per `roadmap.md:151`) but is not built here.
- No account-deletion/anonymization handling (S-06) — goals still show the departed member's real email if they haven't deleted their account; "former member" display is a separate future slice.
- No per-goal privacy flags — visibility is membership-level only, matching FR-012's explicit non-goal.
- No pagination — target scale is `small`/`low` per `prd.md` frontmatter.

## Implementation Approach

Three phases, database → service → UI, each independently verifiable:

1. Widen `goals` row-level security with an additive permissive SELECT policy so a shared-group member's goal becomes visible via the Data API — no schema change, no new grants.
2. Add a single new service function that, given a set of member ids, returns their locked goals grouped by user id — reusable as-is by whatever later queries it (S-05).
3. Give `GoalCard` a `readOnly` mode and wire a new section into the existing group detail page, reusing the member list and its ordering that the page already fetches.

## Critical Implementation Details

**Lock-window filtering lives in the query, not RLS.** The new RLS policy grants visibility to a member's goal the moment it's created — it does not know or care about the 24h edit window (consistent with how `goals_select_own`/`_update_own`/`_delete_own` already work: RLS only ever checks ownership/membership, never timing). The decision to hide not-yet-locked goals from the group view is enforced entirely inside `listGroupMemberGoals`'s WHERE clause (`created_at <= cutoff`, mirroring `updateGoals`/`deleteGoal`'s own cutoff pattern). This matters for whoever builds S-05 (quarterly digest) later: if that feature ever queries `goals` directly instead of going through `listGroupMemberGoals`, it will see not-yet-locked goals too, since RLS itself doesn't block them — the lock-window rule has to be re-applied at that call site, not assumed to already be enforced at the database layer.

**Member ordering comes from the page's own already-fetched list.** `listGroupMemberGoals` returns an unordered lookup (a `Map<string, Goal[]>`) — it must NOT be used to determine display order. The page keeps using `group.members` (already ordered by `joined_at` ascending via `getGroupDetail`) as the iteration source, filtering out the viewer, and looking up that member's goals from the map. This avoids a second, possibly-inconsistent sort.

## Phase 1: Widen goal visibility to shared-group members

### Overview

Add a new migration that adds one additive RLS policy on `public.goals`, granting SELECT to any authenticated user who shares at least one group with the goal's `user_id`.

### Changes Required:

#### 1. New RLS policy migration

**File**: `supabase/migrations/20260906221830_widen_goals_visibility_to_group.sql`

**Intent**: Grant SELECT access on `goals` to any authenticated user who currently shares a group with the goal's author, additive to the existing own-goal policy — this is the exact widening the original `create_goals.sql` migration's comment anticipated for S-03.

**Contract**: A new `create policy "goals_select_shared_group" on public.goals for select to authenticated using (...)` — the `using` clause is an `exists` check joining `group_members` to itself (`gm_self.user_id = auth.uid()` and `gm_other.user_id = goals.user_id`, `gm_other.group_id = gm_self.group_id`), the same join shape already used by `profiles_select_self_or_shared_group` (`create_groups.sql:137-148`). No new grant statement needed (`select` is already granted to `authenticated` on `goals`). No new SQL function.

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies the new migration cleanly
- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- Using two test accounts that share a group, confirm (via Supabase Studio's SQL editor or the app once Phase 3 lands) that each can see the other's goal rows post-migration.
- Confirm a third account sharing no group with either of them still cannot see their goals.
- Confirm that after one account leaves the shared group, that account immediately loses visibility into the other's goals.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Cross-member locked-goals roll-up

### Overview

Add a reusable service function that, given a list of member user ids, returns each member's fully-locked goals — the data source the new UI section (and later, S-05's digest) will consume.

### Changes Required:

#### 1. `listGroupMemberGoals` service function

**File**: `src/lib/services/goals.ts`

**Intent**: Given a set of member ids, fetch only their locked goals (created more than 24h ago) and group the results by user id, so the calling page/feature doesn't need to know about the lock-window rule itself.

**Contract**: `export async function listGroupMemberGoals(supabase: SupabaseClient, memberIds: string[]): Promise<Map<string, Goal[]>>` — queries `goals` with `.in("user_id", memberIds).lte("created_at", cutoff)` (cutoff computed the same way `updateGoals`/`deleteGoal` already do, via the existing `EDIT_WINDOW_MS`), ordered by `created_at` descending within each member, then reduces rows into a `Map<userId, Goal[]>` via the existing `fromRow` mapper. Short-circuits (returns an empty `Map`) when `memberIds` is empty, mirroring `getGroupDetail`'s `if (userIds.length > 0)` guard.

### Success Criteria:

#### Automated Verification:

- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- Using the Supabase SQL editor or a temporary local script, confirm `listGroupMemberGoals` (or the equivalent raw query) returns only goals older than 24h for the given member ids, and an empty array for a member with none yet.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Read-only card mode + group page section

### Overview

Give `GoalCard` a `readOnly` mode that suppresses the progress-recording dialog, and add a new "Cele członków grupy" section to `/groups/[id].astro` that renders every other member's locked goals in read-only mode, in the existing member order.

### Changes Required:

#### 1. `GoalCard` read-only mode

**File**: `src/components/goals/GoalCard.tsx`

**Intent**: Let the card render someone else's goal with no way to record progress on it, while keeping the existing own-goal editable/locked behavior untouched.

**Contract**: Add an optional `readOnly?: boolean` prop (default `false`) to `Props`. The only behavior change: when `readOnly` is `true`, `progressTrigger` evaluates to `null` regardless of measure type, so neither the "Dodaj postęp" nor "Oznacz jako wykonane" dialog renders (and the card's `border-t` divider around it, gated on `progressTrigger` truthiness at line 153, disappears along with it). `celSection`/`progressSection` need no changes — the existing non-editable branch already renders them read-only whenever `editable` is `false`, which is always the case for someone else's goal.

#### 2. New "Cele członków grupy" section

**File**: `src/pages/groups/[id].astro`

**Intent**: For the signed-in viewer, show every other current member's locked goals, reusing the page's existing `group.members` order and excluding the viewer.

**Contract**: After the existing `group` fetch, compute `const otherMembers = group ? group.members.filter((m) => m.userId !== user.id) : []` and call `listGroupMemberGoals(supabase, otherMembers.map((m) => m.userId))`. Render a new section (same card styling as the existing "Członkowie" block) iterating `otherMembers` in order; for each member render their email as a sub-heading followed by one `<GoalCard client:load goal={goal} editable={false} remainingLabel={null} readOnly={true} />` per goal from the lookup map, or a short Polish empty-state line (e.g. "Brak jeszcze zablokowanych celów.") when that member has none yet. When `otherMembers` is empty (solo group), show a single Polish empty-state line for the whole section instead of an empty list.

### Success Criteria:

#### Automated Verification:

- `npx astro check` passes
- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- As a member of a group with at least one other member who has both locked and not-yet-locked goals, visit `/groups/[id]` and confirm only their locked goals appear, with no progress/edit/delete controls on any of them.
- Confirm the viewer's own goals do not appear in the new section.
- Confirm member ordering in the new section matches the existing "Członkowie" list above it.
- Confirm a member with zero locked goals shows the per-member empty state instead of being silently omitted.
- Confirm a solo group (no other members) shows the whole-section empty state instead of a broken/empty list.
- Confirm that leaving the group (or having the other member leave) removes their goals from view on next load.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

No unit test suite exists in this repo (verification is `eslint` + `astro check` + manual testing, per existing convention across all prior slices).

### Integration Tests:

N/A — same as above; verification is manual, per this repo's established convention.

### Manual Testing Steps:

1. Create two test accounts, form a shared group, have each commit a goal (one numeric, one boolean) — wait 24h or adjust `created_at` directly in Supabase Studio to simulate the locked state for one, leaving the other within-window.
2. As account A, visit the shared group's page and confirm only account B's locked goal appears, with no interactive controls.
3. As account B, confirm account A's goal appears symmetrically.
4. Have one account leave the group; confirm the departing account's goal disappears from the remaining member's view on next page load, and vice versa.
5. Create a third account with no shared group with A/B; confirm it cannot see either goal (attempt a direct API/SQL check if feasible).

## Performance Considerations

None beyond existing conventions — `target_scale` is `small`/`low` per `prd.md` frontmatter; the new query is a single indexed `.in()` lookup on `goals.user_id` (existing `goals_user_id_idx`), bounded by a single group's member count.

## Migration Notes

Additive-only migration (new policy, no altered/dropped objects); no backfill needed since no prior data depended on this visibility rule.

## References

- Roadmap: `context/foundation/roadmap.md:122-132` (S-03, the north star)
- PRD: `context/foundation/prd.md:93-94` (FR-012), `:107` (NFR "Closed-circle confinement")
- Prior slice: `context/archive/2026-08-30-form-and-manage-a-group/` (groups/group_members schema, `getGroupDetail` pattern)
- Prior slice: `context/archive/2026-09-06-goals-page-ux-consolidation/` (`GoalCard.tsx` extraction)
- Planted hook: `supabase/migrations/20260829164522_create_goals.sql:46-49`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Widen goal visibility to shared-group members

#### Automated

- [x] 1.1 `npx supabase db reset` applies the new migration cleanly — 4d94584
- [x] 1.2 `npx astro check` passes — 4d94584
- [x] 1.3 `npm run lint` passes — 4d94584

#### Manual

- [x] 1.4 Two accounts sharing a group can see each other's goal rows post-migration — 4d94584
- [x] 1.5 A third account sharing no group cannot see either account's goals — 4d94584
- [x] 1.6 Leaving the shared group immediately revokes visibility — 4d94584

### Phase 2: Cross-member locked-goals roll-up

#### Automated

- [x] 2.1 `npx astro check` passes — 578b677
- [x] 2.2 `npm run lint` passes — 578b677

#### Manual

- [x] 2.3 `listGroupMemberGoals` returns only goals older than 24h, and an empty array for a member with none — 578b677

### Phase 3: Read-only card mode + group page section

#### Automated

- [x] 3.1 `npx astro check` passes — 56f9ba2
- [x] 3.2 `npm run lint` passes — 56f9ba2
- [x] 3.3 `npm run build` succeeds — 56f9ba2

#### Manual

- [x] 3.4 Only locked goals appear for other members, with no progress/edit/delete controls — 56f9ba2
- [x] 3.5 Viewer's own goals do not appear in the new section — 56f9ba2
- [x] 3.6 Member ordering matches the existing "Członkowie" list — 56f9ba2
- [x] 3.7 A member with zero locked goals shows the per-member empty state — 56f9ba2
- [x] 3.8 A solo group shows the whole-section empty state — 56f9ba2
- [x] 3.9 Leaving the group removes goals from view on next load — 56f9ba2
