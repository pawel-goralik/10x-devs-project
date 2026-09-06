# Witness the circle's goals — Plan Brief

> Full plan: `context/changes/witness-the-circles-goals/plan.md`

## What & Why

Group member can see every other member's committed goals and current progress on a shared view. This is roadmap slice S-03 — the product's north star: the moment a locked-in promise actually gets witnessed by someone the user cares about, which is the whole product's bet. Right now goal visibility is single-user only; nobody's goal is visible to anyone but themselves.

## Starting Point

`/goals` (S-01) and `/groups/[id]` (S-02) already exist and work independently. `/groups/[id]` already fetches and renders an ordered member list (`getGroupDetail`). `goals` RLS already carries a comment planted by the S-01 implementer anticipating exactly this widening. `GoalCard.tsx` (from the recent goals-page-ux-consolidation slice) already has an `editable` prop but no way to hide the progress-recording action, which someone else's goal must never expose.

## Desired End State

Visiting a group's page, a member sees a new section listing every other current member's fully-locked goals and progress, read-only, in the same order as the existing member list. Their own goals aren't repeated there. Leaving the group (by either side) removes that visibility immediately.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Page structure | Extend existing `/groups/[id]` with a new section | Reuses the page that already fetches group + ordered members; avoids building and navigating to a separate aggregated route | Plan |
| Card reuse | Add a `readOnly` prop to existing `GoalCard` | Single source of truth for card rendering; matches its existing `editable`/`remainingLabel` prop pattern | Plan |
| Own goals | Excluded from the new section | `/goals` already owns "my commitments"; the circle view is "our circle's," per PRD's explicit framing | Plan |
| Navigation | No new Topbar link | Consistent with the per-group (not aggregated) page choice — reached only via a specific group's page | Plan |
| Member ordering | Reuse the existing member list's order (`joined_at` ascending) | Visual consistency with the member list right above the new section on the same page | Plan |
| RLS approach | Plain additive policy, inline self-join on `group_members` | `goals` isn't self-referential like `group_members` was — no recursion risk requiring a `security definer` helper; avoids a new DB object with a single caller | Plan |
| Lock-window visibility | Only fully-locked goals (past 24h) are shown | Deliberate product choice made in this session, trading a stricter reading against FR-012's literal "every goal" wording | Plan |

## Scope

**In scope:**
- New additive RLS policy widening `goals` SELECT to shared-group members
- New `listGroupMemberGoals` service function (locked-only, grouped by member)
- `GoalCard` read-only mode
- New section on `/groups/[id].astro`

**Out of scope:**
- Aggregated cross-group "all my circles" page
- Quarterly digest (S-05) — will reuse `listGroupMemberGoals` later, not built here
- Account-deletion anonymization (S-06)
- Per-goal privacy flags
- New Topbar navigation entry

## Architecture / Approach

Database → service → UI. A new permissive RLS policy grants row visibility based on shared group membership (additive to the existing own-goal policy — Postgres ORs permissive policies together). A new service function layers the 24h lock-window filter on top (RLS itself doesn't know about time). The UI phase adds a read-only card mode and a new page section that reuses the group page's already-fetched, already-ordered member list.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Widen goal visibility (RLS) | New migration granting SELECT to shared-group members | A too-broad or too-narrow `exists` join silently over- or under-shares goals — verify with three accounts, not two |
| 2. Cross-member goal roll-up | `listGroupMemberGoals(supabase, memberIds)` in `goals.ts` | Lock-window filter must be re-derived correctly (`<=` cutoff, not `>`) — inverse of the edit-window checks elsewhere in the same file |
| 3. Read-only card + page section | New "Cele członków grupy" section on `/groups/[id]` | `GoalCard`'s `progressTrigger` must be fully suppressed, not just visually hidden, since it posts to a real endpoint |

**Prerequisites:** S-01 (commit-a-goal) and S-02 (form-and-manage-a-group), both already shipped.
**Estimated effort:** ~1 session across 3 phases (small, well-bounded read surface; no schema changes).

## Open Risks & Assumptions

- The lock-window-only visibility choice narrows FR-012's literal "every goal" wording — worth confirming this reads correctly against the PRD before archiving, since it's a scope interpretation made during planning rather than an explicit PRD revision.
- `profiles.email` has no verified-freshness guarantee if a user changes their email in Supabase auth (pre-existing gap noted in S-02, not introduced here) — a stale email could appear next to a group member's goals.

## Success Criteria (Summary)

- A group member can see every other current member's locked goals and progress on that group's page, and nothing else's.
- Leaving a group (by either party) immediately and correctly removes visibility, with no manual cache/refresh trick needed.
- No UI affordance lets a viewer edit, delete, or record progress on anyone else's goal.
