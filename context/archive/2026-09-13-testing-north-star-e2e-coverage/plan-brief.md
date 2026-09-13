# North-Star E2E Coverage — Plan Brief

> Full plan: `context/changes/testing-north-star-e2e-coverage/plan.md`
> Research: `context/changes/testing-north-star-e2e-coverage/research.md`

## What & Why

Add one Playwright E2E test proving that a group member's committed goal and
its current progress are actually delivered to another real member on the
shared group view — driven end-to-end through two real, independently
signed-in browser sessions. This closes rollout Phase 4 of
`context/foundation/test-plan.md`: the feature (roadmap S-03) is fully
built, and its query/RLS boundary is already proven at the integration
layer, but nothing today drives it through a real browser with a real
second user.

## Starting Point

`src/pages/groups/[id].astro` already fetches and renders every other
member's fully-locked goals via `listGroupMemberGoals` + `GoalCard`
(`readOnly={true}`). Its only prior verification was manual SQL
role-switching during the original slice — not a repeatable automated test.
`tests/integration/goals-visibility.test.ts` covers the query/RLS layer
directly; this plan adds the missing browser-level proof on top of it.

## Desired End State

Running `npm run test:e2e` includes a passing spec that: seeds a group +
an already-locked numeric goal for one member (the author), has the author
bump its progress through the real `/goals` UI, then has a second,
independent member (the viewer) load `/groups/[id]` and see that goal with
its updated progress rendered — and confirms no progress-recording control
is exposed to the viewer. No application code changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Goal seeding | Direct DB insert via service-role client (`createGoalAt`), backdated `created_at` | The 24h lock window makes it the only way to get an already-locked goal without waiting; every existing test layer already does this | Plan (user-confirmed) |
| 24h window configurability | Not made configurable | It's a production guardrail (FR-006), not test plumbing — configuring it would widen this change's blast radius far beyond one test | Plan (user-confirmed) |
| Group/membership setup | Seeded via service-role fixtures (`createGroupWithMembers`), not the real invite/join UI | Keeps the test scoped to the goal/progress-visibility risk; invite/join UI is a separate, out-of-scope risk surface | Plan (user-confirmed) |
| Identity model | Two fully isolated fresh users via `signInContextAsNewUser`, each in their own `BrowserContext` | Symmetric, no dependency on the shared `storageState` fixture account's state, safe under `fullyParallel: true` — the documented path for multi-user specs | Plan (user-confirmed) |
| Goal measure type | Numeric | Proves an actually-changing progress value is delivered, the more informative rendering path | Plan (user-confirmed) |
| Negative UI assertion | Included: assert no progress-recording control is visible to the viewer | One-line assertion that directly protects the `readOnly` wiring's regression risk | Plan |
| Service-role RLS concern | Confirmed safe: service-role only seeds rows; every read/assertion goes through a real authenticated session, so RLS is genuinely exercised | Discussed with user — RLS evaluates row `user_id` vs. querying session, not "who inserted the row" | Plan (user-confirmed) |

## Scope

**In scope:**
- One new Playwright spec file (`tests/e2e/group-goal-visibility.spec.ts`)
- Two-user, real-UI progress-recording + cross-member viewing flow
- Fixture-based setup/teardown via the existing service-role helpers

**Out of scope:**
- Group creation / invite-link / accept-invite UI
- Boolean-goal rendering
- Re-testing the query/RLS visibility boundary (already covered, Phase 1)
- Making the 24h edit window configurable
- CI wiring for this spec (rollout Phase 5)
- The magic-link auth flow itself (already-flagged, separate gap)

## Architecture / Approach

Two independent `BrowserContext`s, each authenticated as a fresh test user
via `signInContextAsNewUser` (not the shared `storageState` fixture). A
service-role client seeds a group containing both users and an
already-locked numeric goal owned by the "author." The author's real
session bumps progress via `/goals`'s real dialog UI; the "viewer's" real
session then loads `/groups/[id]` and the test asserts the rendered card and
its updated value. Cleanup runs in `afterEach` via `cleanupFixtures`, the
same helper the integration tests already use for identical fixtures.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Author the cross-member goal/progress-visibility E2E spec | One passing Playwright spec, verified to actually fail when the guarantee is broken | Dialog-portal locator scoping and multi-user fixture cleanup ordering are the two easiest ways to get this subtly wrong |

**Prerequisites:** Local Supabase running (`npx supabase start`); existing
Playwright E2E infra (`auth.setup.ts`, `tests/e2e/support/*`) already
bootstrapped — no new infra needed.
**Estimated effort:** One focused session — a single new test file, no
application code changes.

## Open Risks & Assumptions

- Radix/shadcn `Dialog` content portals outside the goal card's DOM
  subtree — locators for the dialog's field/submit button must be scoped to
  `page`, not the card, or they won't be found.
- The two-user, server-generated-id fixture pattern needs module-level
  mutable state assigned inside the test and read in `afterEach`, unlike
  `seed.spec.ts`'s stateless convention — documented explicitly in the plan
  so an implementer doesn't copy the wrong pattern.

## Success Criteria (Summary)

- `npm run test:e2e` passes, including the new spec
- The new spec provably fails when the group-view visibility or
  progress-recording-control guarantee is broken (checked once during
  authoring, then reverted)
- No application code changes; no orphaned fixture rows/users after a run
