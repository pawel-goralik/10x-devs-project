---
date: 2026-09-12T18:55:00+02:00
researcher: Pawel Goralik
git_commit: 6dcef882202a01384a4b1f6850617eaa2940ad88
branch: main
repository: 10x-devs-project
topic: "Phase 1 test-rollout: cross-group goal visibility (#1) & 24h immutability lock boundary (#2)"
tags: [research, codebase, testing, rls, authorization, immutability, goals, groups, vitest]
status: complete
last_updated: 2026-09-12
last_updated_by: Pawel Goralik
---

# Research: Phase 1 test-rollout — cross-group goal visibility & 24h immutability lock boundary

**Date**: 2026-09-12T18:55:00+02:00
**Researcher**: Pawel Goralik
**Git Commit**: 6dcef882202a01384a4b1f6850617eaa2940ad88
**Branch**: main
**Repository**: 10x-devs-project

## Research Question

For `context/foundation/test-plan.md` §3 Phase 1 ("Critical-path authorization & immutability coverage", risks #1 and #2), ground the two guardrail behaviors in the actual codebase before writing any test:

1. **Risk #1** — how is cross-group goal/progress visibility actually gated (RLS vs. service-layer vs. both), and what happens to visibility the instant a user leaves a group?
2. **Risk #2** — where is the 24h immutability window computed/duplicated, what clock source is used, and is it timezone-safe?

Also assess the current test-runner state (none exists yet — this phase bootstraps it) and pull forward any relevant history from prior archived slices.

## Summary

Both guardrails are **enforced correctly today, but by different mechanisms than a naive test would assume**:

- **Risk #1 (cross-group visibility)** is enforced almost entirely at the **RLS layer** — two OR'd permissive `select` policies on `goals` (`goals_select_own`, `goals_select_shared_group`), the second doing a live `group_members` self-join. The service layer (`listGroupMemberGoals`) does **not** re-check membership itself — it trusts RLS completely and only adds the 24h-lock filter on top. This means **a test that mocks/stubs the Supabase client would prove nothing about this risk** — the only way to catch a regression here is an integration test against a real Postgres instance with RLS active, using two distinct authenticated sessions.
- **Risk #2 (24h lock)** is enforced at the **query-WHERE-clause layer**, not RLS, not a DB trigger — deliberately, per two independent design notes in archived plans. The cutoff arithmetic (`Date.now() - EDIT_WINDOW_MS`) is duplicated across three call sites in one file (not extracted to a shared helper), all using the server clock only, all timezone-safe (`timestamptz` + UTC epoch math throughout, no local-time conversion anywhere). `recordProgress` deliberately has **no** cutoff check at all — that absence is itself a regression a test must protect.
- **No test runner exists yet** (0 test files, no Vitest config, no `test` script). This genuinely is the first test in the repo. Vitest will need explicit handling for the `astro:env/server` virtual module import in `src/lib/supabase.ts`, and integration tests will need both a service-role client (setup/teardown, bypassing RLS) and two independent anon-key sessions (to assert what RLS actually permits per-user) — neither helper exists today.

## Detailed Findings

### Risk #1 — Cross-group visibility authorization

**RLS is the actual enforcement boundary, not application code.**

- `goals_select_own` — `supabase/migrations/20260829164522_create_goals.sql:50-53` — `using (auth.uid() = user_id)`.
- `goals_select_shared_group` — `supabase/migrations/20260906221830_widen_goals_visibility_to_group.sql:22-32` — additive (OR'd) policy:
  ```sql
  using (
    exists (
      select 1
      from public.group_members gm_self
      join public.group_members gm_other on gm_other.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid() and gm_other.user_id = goals.user_id
    )
  )
  ```
  No migration since has altered or dropped either policy (confirmed: only 3 migrations touch `goals`, in order, all read).
- Same join shape is reused verbatim by `profiles_select_self_or_shared_group` (`supabase/migrations/20260831123440_create_groups.sql:137-148`) — the widening migration's own comment says it deliberately mirrors that policy.
- `listGroupMemberGoals(supabase, memberIds)` — `src/lib/services/goals.ts:87-118` — takes a plain `memberIds: string[]`, queries `.in("user_id", memberIds).lte("created_at", cutoff)`, and **relies entirely on `goals_select_shared_group` RLS** to actually exclude non-shared-group ids (its own comment at `goals.ts:80-86` says this explicitly). If a caller passed a non-shared-group id into `memberIds`, RLS — not the function — is what silently drops that row.
- The only caller, `src/pages/groups/[id].astro:26-32`, filters `otherMembers` from `group.members` purely for UI purposes (exclude viewer's own card) — this is not an authorization boundary either; `group.members` itself is already RLS-scoped via `group_members_select_fellow_members`.
- **Complete inventory of every raw `.from("goals")` call site in `src/`** (8 total, all in `src/lib/services/goals.ts`): `listGoals` (own), `listGroupMemberGoals` (RLS-gated cross-user), `createGoals`/`updateGoals`/`deleteGoal`/`recordProgress` (all `.eq("user_id", userId)`-scoped). No page, component, or API route queries `goals` directly.

**Membership changes take effect immediately — no caching anywhere.**

- `leaveGroup` (`src/lib/services/groups.ts:175-184`) is a plain `.from("group_members").delete()...`.
- Supabase client is constructed fresh per request (`src/lib/supabase.ts:5-24`, `@supabase/ssr`, cookie-based) — no module-level singleton, no session/membership cache.
- `is_member_of()` and the inline joins are plain SQL evaluated live by Postgres on every query — next request after a `leave` sees the new state immediately.
- One accepted, narrow, non-data-leaking exception: `groups_select_own_created` (`supabase/migrations/20260831123440_create_groups.sql:110-113`) lets a group's *creator* still see the bare `groups` row (name only) after leaving — documented in `groups.ts:60-70` and in `context/archive/2026-08-30-form-and-manage-a-group/reviews/plan-review.md` (F5, accepted) as UX-only, not a security gap, since member list and goals still return empty/nothing.
- **Ordering hazard already documented**: `src/pages/api/groups/leave.ts` must call `getGroupDetail` *before* `leaveGroup` — reversing this order would silently return empty data post-delete (RLS, not an error). This is Risk #5 (Phase 2), not Phase 1, but the *pattern* (RLS makes wrong-order bugs silent, not loud) applies to how Phase 1 tests should assert results (assert actual returned rows/DB state, not just "no error").

### Risk #2 — 24h immutability lock boundary

**Single constant, single file, three duplicated call sites, no RLS/trigger involvement.**

- `EDIT_WINDOW_MS = 24 * 60 * 60 * 1000` — `src/lib/services/goals.ts:4` — module-private, not exported, defined exactly once in the whole repo.
- Cutoff is recomputed independently (not via a shared helper) at three call sites, all `new Date(Date.now() - EDIT_WINDOW_MS).toISOString()`:
  - `updateGoals` — `goals.ts:153`, applied as `.gt("created_at", cutoff)` at `goals.ts:171` (editable = created after cutoff).
  - `deleteGoal` — `goals.ts:255`, applied as `.gt("created_at", cutoff)` at `goals.ts:261`.
  - `listGroupMemberGoals` — `goals.ts:95`, applied **inverted** as `.lte("created_at", cutoff)` at `goals.ts:100` (locked = created at/before cutoff) — correct by design (group view shows only already-locked goals), but confirms the "same formula, opposite operator" duplication a test should pin down explicitly rather than assume symmetric.
  - `isEditable`/`editWindowRemainingMs` (`goals.ts:57-65`) are pure, display-only helpers (used only by `src/pages/goals/index.astro`) — **not authoritative**, never consulted by any API route to gate a mutation.
- **`recordProgress` has zero cutoff logic** (`goals.ts:195-251`, explicitly commented at 190-193: "No 24h cutoff — progress can be recorded on any owned goal, locked or not") — intentional per FR-007 scope, confirmed independently by two archived plans (`record-goal-progress`, `goals-page-ux-consolidation`). **This absence is itself the thing Phase 1 must protect** — a regression that adds a cutoff to `recordProgress` would violate FR-007 as much as omitting one from `updateGoals`/`deleteGoal` would violate FR-006.
- **Clock source**: exclusively `Date.now()` (server) and `goal.createdAt`/`created_at` (DB-assigned via `default now()`, never client-supplied — confirmed no date/time field in any zod schema in `manage.ts`/`progress.ts`).
- **Timezone safety**: `created_at`/`updated_at` are `timestamptz` (`supabase/migrations/20260829164522_create_goals.sql:20-21`), all comparisons happen in UTC epoch-ms space, no local-time conversion exists anywhere in the codebase for this feature (grep-confirmed).
- **No RLS/trigger enforcement of the window** — deliberate, documented design decision, stated explicitly in the migration's own comment (`supabase/migrations/20260829164522_create_goals.sql:3-9, 61-62`): the window is "enforced in the application service layer... per the PRD's Access Control section" (product-surface enforcement, not cryptographic/operator-proof — matches PRD's explicit Non-Goal). Practical implication: any future code path that mutates `goals` without going through `updateGoals`/`deleteGoal`'s WHERE-clause filter would bypass the window entirely — RLS alone permits it.
- **Client UI hides the affordance, server independently re-validates** — defense in depth at two layers (UI cosmetic, query-layer authoritative), zero layers where the server trusts a client-supplied "is editable" flag. Confirmed for both edit and delete branches of `src/pages/api/goals/manage.ts`.
- **Failure signal is ambiguous by design**: a locked-goal mutation and a wrong-owner mutation both surface as "0 rows affected" → generic "the 24h window has closed" message (confirmed in `context/archive/2026-08-29-commit-a-goal/reviews/impl-review.md`, F2/F3, accepted). **Tests must assert against DB state** (row unchanged / row still present), not against the HTTP response copy, to distinguish what's actually being tested.

### Test infrastructure — current state (Phase 1 also bootstraps this)

- Zero test files anywhere (`*.test.ts`, `*.spec.ts`, `vitest.config.*` all absent); zero test-related packages in `package.json` (no vitest, msw, @testing-library/*, jest).
- Pinned versions relevant to Vitest compatibility: `astro ^6.3.1`, `react ^19.2.6`, `@supabase/supabase-js ^2.99.1`, `@supabase/ssr ^0.10.3`, `vite` pinned via `overrides.vite ^7.3.2`; `supabase` CLI `^2.23.4` already a devDependency (no new tooling install needed for local Postgres).
- **CI** (`.github/workflows/ci.yml`, 25 lines) currently: checkout → setup-node@22 → `npm ci` → `astro sync` → `npm run lint` → `npm run build` (with `SUPABASE_URL`/`SUPABASE_KEY` secrets already wired at the build step). No test step, no Postgres/DB service container defined — adding one is this phase's job, not yet done.
- **Local Supabase**: `supabase/config.toml` has migrations + seed enabled (`db` port 54322, `api` port 54321); `.dev.vars` already has local demo anon key. `supabase start` / `supabase db reset` is the intended mechanism for an ephemeral integration-test Postgres instance.
- **Known environment gotcha** (already in `context/foundation/lessons.md`): under Colima, `supabase start` can fail on the analytics/vector sidecar mount; workaround is temporarily `[analytics] enabled = false`, well-documented already, no new discovery needed.
- **Gap**: `astro:env/server` (used by `src/lib/supabase.ts` for `SUPABASE_URL`/`SUPABASE_KEY`) is an Astro/Vite virtual module — a plain Vitest config will not resolve it. Needs `getViteConfig` from `astro/config` or an equivalent alias/mock in Phase 1's Vitest bootstrap.
- **Gap**: no service-role client and no multi-session (two-simultaneous-authenticated-users) client helper exists in `src/lib/` today. Testing RLS-gated cross-group visibility (Risk #1) requires both: a service-role client for setup/teardown (bypasses RLS), and two separate anon-key sessions signed in as different users (via `supabase-js` `signInWithPassword`/session tokens directly — not through Astro's cookie-based SSR client, which isn't reusable in a plain Vitest test).

## Code References

- `supabase/migrations/20260829164522_create_goals.sql:50-53` — `goals_select_own` RLS policy
- `supabase/migrations/20260829164522_create_goals.sql:63-74` — `goals_update_own`/`goals_delete_own` RLS (ownership-only, no timing predicate)
- `supabase/migrations/20260906221830_widen_goals_visibility_to_group.sql:22-32` — `goals_select_shared_group` RLS policy
- `supabase/migrations/20260831123440_create_groups.sql:137-148` — `profiles_select_self_or_shared_group` (same join shape)
- `supabase/migrations/20260831123440_create_groups.sql:78-120` — `is_member_of()`, `groups_select_member`, `groups_select_own_created`, `group_members_select_fellow_members`
- `src/lib/services/goals.ts:4` — `EDIT_WINDOW_MS` constant (sole definition)
- `src/lib/services/goals.ts:57-65` — `isEditable`/`editWindowRemainingMs` (display-only, non-authoritative)
- `src/lib/services/goals.ts:87-118` — `listGroupMemberGoals` (RLS-dependent, cutoff-inverted)
- `src/lib/services/goals.ts:148-182` — `updateGoals` (query-level cutoff enforcement)
- `src/lib/services/goals.ts:190-265` — `recordProgress` (no cutoff, by design), `deleteGoal` (query-level cutoff)
- `src/lib/services/groups.ts:60-70` — documented `groups_select_own_created` edge case
- `src/lib/services/groups.ts:175-184` — `leaveGroup`
- `src/pages/groups/[id].astro:9-33` — group detail page composing `getGroupDetail` + `listGroupMemberGoals`
- `src/pages/api/groups/leave.ts` — fetch-before-delete ordering (Risk #5, Phase 2, but same RLS-silence pattern)
- `src/pages/api/goals/manage.ts:32-72` — edit/delete route, defers cutoff entirely to service functions
- `src/lib/supabase.ts:5-24` — cookie-based SSR client construction (anon-key + session, not reusable as-is in tests)
- `.github/workflows/ci.yml` — current CI (lint + build only, no test step)
- `supabase/config.toml` — local Supabase ports/migrations/seed config

## Architecture Insights

- **RLS-first authorization, application-layer time-windows**: this codebase has a consistent convention — identity/membership boundaries (who can see what) live in RLS; time-based state (is this goal locked) lives in application query WHERE clauses. Neither guardrail is duplicated into the other layer. A test suite must match this split: authorization tests need real RLS (integration, real Postgres), lock-boundary tests need to hit the actual service functions' query construction (also effectively integration, since the WHERE-clause-as-check pattern can't be verified against a mock without reimplementing the mock's filtering logic — which would be a mirror test).
- **Zero-rows-affected is an overloaded success/failure signal**: both `updateGoals` and `deleteGoal` collapse "wrong owner" and "window closed" into the same "0 rows" outcome, surfaced identically to the user. This is an accepted, documented design choice (not a bug) — tests should assert on DB state, not on this ambiguous signal, to actually distinguish which boundary is under test.
- **Two independent design notes converge on the same lock-boundary contract**: `commit-a-goal`'s original plan and `record-goal-progress`'s plan both independently state progress-recording must have zero window checks — this is now cross-confirmed by three archived plans plus current code, making it a very stable oracle fact (not implementation-mirroring) for a test's expected behavior.

## Historical Context (from prior changes)

- `context/archive/2026-08-29-commit-a-goal/plan.md` — original 24h-window design: enforced via query WHERE clause, never RLS/trigger; explicitly warns any future progress-update function must be a separate call path with no window check (this warning is what `record-goal-progress` later followed).
- `context/archive/2026-08-29-commit-a-goal/reviews/impl-review.md` (F2/F3, accepted) — confirms "0 rows affected" is an intentionally ambiguous signal covering both wrong-owner and window-closed cases.
- `context/archive/2026-08-30-record-goal-progress/plan.md` — confirms FR-007 has no time window by design; also flags a known, accepted non-atomicity gap in `recordProgress`'s read-then-write (two concurrent submits could lose an update) — explicitly "do not fix without checking with the user first," relevant if a future concurrency test surfaces it.
- `context/archive/2026-08-30-form-and-manage-a-group/plan.md` — original group RLS model: `is_member_of()` SECURITY DEFINER helper (recursion avoidance), `groups_select_own_created` as a second permissive policy, `SECURITY DEFINER` RPCs (`get_group_preview`, `join_group_by_token`) scoped to exact-token lookups only.
- `context/archive/2026-08-30-form-and-manage-a-group/plan.md` + `reviews/plan-review.md` (F5) — the fetch-before-delete ordering hazard in `leave.ts`, and the accepted non-member-access-returns-null edge case on the group detail page.
- `context/archive/2026-08-30-record-goal-progress/reviews/impl-review.md` (F1, fixed) — the origin of test-plan.md's Risk #4 bundle-endpoint bug (blank-string field silently dropping sibling-row edits); now confirmed by this research to be latent-only post-S-08 (per-card forms), not currently reachable through the shipped UI — Phase 2's concern, not Phase 1's.
- `context/archive/2026-09-06-witness-the-circles-goals/plan.md` (already read in full before spawning agents) — the S-03 slice that added `goals_select_shared_group` and `listGroupMemberGoals`; both this research and that plan agree on the RLS-does-authorization / query-does-locking split.
- `context/foundation/roadmap.md` — S-05 (quarterly digest) and S-06 (anonymize-on-deletion) are both still `proposed`, not built — confirms no additional risk surface exists yet for either guardrail beyond what's captured here.
- `context/changes/bootstrap-verification/` and `context/changes/deployment/` — neither touches test infrastructure; CI currently only runs lint + build, confirmed independently by this research's own read of `ci.yml`.

## Related Research

- `context/archive/2026-09-06-witness-the-circles-goals/plan.md` — implementation plan for the feature whose RLS/service split this research is now grounding tests against.
- `context/foundation/test-plan.md` §2–§3 — the risk map and phased rollout this research directly serves (Phase 1).

## Open Questions

- **Test-runner Vitest/Astro integration**: exact mechanism to make `astro:env/server` resolvable in Vitest (`getViteConfig` vs. manual mock) is not yet decided — a `/10x-plan` decision, not a research gap (the constraint itself is now documented above).
- **CI wiring for integration tests**: whether to add a `postgres:` services block or run the `supabase` CLI (`supabase start`) inside the GitHub Actions job is an open implementation choice for `/10x-plan`, not resolved here — both are technically viable given `ubuntu-latest`'s default Docker availability, but neither has been tried in this repo yet.
- **Service-role / multi-session test client helper**: does not exist yet; `/10x-plan` should decide whether it lives in a test-only helper module or a new `src/lib/` file reused elsewhere.
