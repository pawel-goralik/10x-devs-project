# North-Star E2E Coverage Implementation Plan

## Overview

Add one Playwright E2E spec that proves — through two real, independently
signed-in browser sessions — that a group member's committed (locked) goal
and its current progress are actually delivered to another real member on
the shared group view (`/groups/[id]`). This is rollout Phase 4 of
`context/foundation/test-plan.md`, closing the last gap on Risk #1's positive
path: the feature (roadmap S-03, "witness the circle's goals") is fully
built and its query/RLS layer is already proven by
`tests/integration/goals-visibility.test.ts`, but nothing today drives it
through a real browser with a real second user.

## Current State Analysis

- The feature under test — `src/pages/groups/[id].astro` fetching
  `listGroupMemberGoals` and rendering each goal via `GoalCard` with
  `readOnly={true}` — is complete and unchanged by this plan. See
  `context/changes/testing-north-star-e2e-coverage/research.md` for the full
  code trace.
- `listGroupMemberGoals` (`src/lib/services/goals.ts:87-118`) only returns
  goals whose `created_at` is already ≥24h old. There is no way to get a
  real, already-locked goal into the database in under 24 real hours except
  by inserting it directly with a backdated timestamp — every existing test
  layer already does this (`tests/support/fixtures.ts`'s `createGoalAt`,
  used by `tests/integration/goals-visibility.test.ts`).
- `recordProgress` (`src/lib/services/goals.ts:195-251`) has no lock-window
  check — a goal's progress can be bumped by its owner regardless of age.
  Combined with the previous point: seeding an already-locked goal and then
  bumping its progress through the real UI is both realistic and the
  intended way to get a "committed goal with live progress" without waiting
  24 real hours.
- On the owner's own `/goals` page (`src/pages/goals/index.astro:90-98`),
  `GoalCard` is rendered with `editable={isEditable(goal)}` and no
  `readOnly` prop — so a locked-but-owned goal still shows its
  progress-recording trigger ("Dodaj postęp"), just not the
  edit/delete form. On the group page, the same component is rendered with
  `readOnly={true}`, which nulls out that trigger entirely
  (`GoalCard.tsx:97,154-164`). This is the exact UI-level guarantee this
  test protects, on top of what the integration layer already proved at the
  query level.
- All infra this test needs already exists and requires no changes:
  `signInContextAsNewUser` (`tests/e2e/support/auth.ts`) for a second,
  fully isolated real user; `createGroupWithMembers` / `createGoalAt` /
  `cleanupFixtures` (`tests/support/fixtures.ts`) for service-role fixture
  setup/teardown; `getGoalCard` (`tests/e2e/support/locators.ts`) for the
  shared `data-testid` locator used by both `/goals` and `/groups/[id]`.

### Key Discoveries:

- `src/lib/services/goals.ts:87-101` — `listGroupMemberGoals`'s
  `.lte("created_at", cutoff)` filter, the hard 24h constraint driving the
  seeding approach.
- `src/components/goals/GoalCard.tsx:97` — `progressTrigger = readOnly ?
  null : ...`, the prop that separates the owner's view (trigger visible
  even when locked) from the group view (trigger always hidden).
- `src/pages/goals/index.astro:90-98` vs. `src/pages/groups/[id].astro:89` —
  same `GoalCard`, different props, explaining why the owner can still act
  on a locked goal while a viewer never can.
- `tests/e2e/CLAUDE.md` explicitly calls out this exact scenario: "This
  single-identity assumption doesn't hold for a multi-user test. For that
  case, opt out of the project's default storageState" — confirms
  `signInContextAsNewUser` (not the shared `storageState` fixture) is the
  intended path for both members.

## Desired End State

A new, self-contained Playwright spec exists at
`tests/e2e/group-goal-visibility.spec.ts`. Running `npm run test:e2e`
(or `npx playwright test tests/e2e/group-goal-visibility.spec.ts` in
isolation) passes, proving: a group member (author) records progress on
their own already-locked goal through the real `/goals` UI, and a second,
independently signed-in group member (viewer) sees that goal and its
updated progress value rendered on `/groups/[id]`, with no
progress-recording control available to them. No application code changes.

**Verification that the test is not decorative**: temporarily breaking the
guarantee (e.g. commenting out `readOnly={true}` on
`src/pages/groups/[id].astro:89`, or the `.lte("created_at", cutoff)` filter
in `listGroupMemberGoals`) must make this new spec fail. This check is done
once during authoring and reverted — see Manual Verification below.

## What We're NOT Doing

- Not testing group creation, the invite-link UI, or the accept-invite page
  (`/groups/join/[token]`) — the group and its membership are seeded
  directly via the service-role client (`createGroupWithMembers`). This
  keeps the test scoped to the goal/progress-visibility risk (test-plan §1:
  cheapest test with real signal); invite/join UI is a separate, not-yet
  in-scope risk surface.
- Not testing a boolean (yes/no) goal's rendering — the seeded goal is
  numeric only, since a changing numeric value is the more informative
  signal for "current progress is delivered." Boolean rendering
  (`GoalCard.tsx:89-92`) is a template-level concern outside this risk.
- Not re-testing the query/RLS visibility boundary itself (own/shared/
  non-member/post-leave cases) — that's `tests/integration/goals-visibility.
  test.ts`'s job, already shipped in rollout Phase 1. This test proves
  browser-level delivery on top of it, not the boundary itself.
- Not making the 24h edit window configurable. Considered and rejected:
  the window is a production guardrail (FR-006, PRD Success Criteria), not
  test-only plumbing; making it env-configurable would widen this change's
  blast radius far beyond "write one e2e test" and reintroduce the
  "test derives its expectation from the same config the app reads" trap
  that Phase 1 explicitly avoided for the boundary-exact case.
- Not wiring this spec into CI — that's rollout Phase 5
  ("Quality-gates wiring"), a separate change.
- Not touching the magic-link auth flow — both test identities are
  provisioned the same password-based, session-injection way every other
  test in this repo already uses (`tests/support/test-users.ts`); the real
  auth flow's lack of coverage is a separately flagged, out-of-scope gap
  (test-plan.md §8 Freshness Ledger).

## Implementation Approach

One new, single-purpose Playwright spec file, following the project's
one-test-per-file convention (`tests/e2e/CLAUDE.md`). Two independent
`BrowserContext`s (not the shared `storageState` fixture) each get a fresh,
isolated test user via `signInContextAsNewUser`. A service-role client
seeds a group containing both users and an already-locked numeric goal
owned by one of them (the "author"). The author's real, signed-in session
then records progress on that goal through `/goals`'s real UI. The other
user's ("viewer") real, signed-in session then loads `/groups/[id]` and the
test asserts the goal card is visible with the updated progress value and
with no progress-recording control. Cleanup happens in `afterEach` via
`cleanupFixtures`, mirroring the exact pattern
`tests/integration/goals-visibility.test.ts` already uses for the same
fixtures.

## Critical Implementation Details

### Dialog content is portaled outside the goal-card locator

`GoalCard`'s progress dialog (`Dialog`/`DialogContent` from
`@/components/ui/dialog`, a Radix-based shadcn component) renders its
trigger button inside the card's `data-testid` element, but `DialogContent`
itself portals to a separate DOM subtree once opened. Locate the "Dodaj
postęp" trigger scoped to `getGoalCard(page, description)`, but locate the
dialog's field (`getByLabel("Wartość do dodania")`) and submit button
(`getByRole("button", { name: "Potwierdź" })`) unscoped, directly on `page`
— scoping them to the card locator will not find them.

### Mutable per-test state is required here, unlike the seed exemplar

`tests/e2e/seed.spec.ts`'s "no mutable state needed" convention only holds
because its identifier (the goal description) is deterministic and known
before the test runs. This test's fixtures (two user ids, a group id, a
goal id) are server-generated and only known once the test body runs, but
`afterEach` needs them to call `cleanupFixtures`. Use module-level `let`
bindings assigned inside the test body and read (with guards for the
not-yet-assigned case, e.g. an early-failure run) inside `afterEach` —
`fullyParallel: true` is safe here since Playwright gives each test file its
own module state per worker.

### Do not double-delete the two test users

`signInContextAsNewUser` returns a `cleanup()` that itself calls
`deleteTestUser`. `cleanupFixtures({ userIds: [...] })` also calls
`deleteTestUser` for each id. Use exactly one of these paths — call
`cleanupFixtures` with both user ids in `afterEach` and do **not** also call
each user's own `.cleanup()` — the second `deleteTestUser` call for an
already-deleted user throws (`auth.admin.deleteUser` errors when the user no
longer exists).

## Phase 1: Author the cross-member goal/progress-visibility E2E spec

### Overview

Write and verify the single new spec described above.

### Changes Required:

#### 1. New E2E spec: shared group view delivers a member's committed goal and progress

**File**: `tests/e2e/group-goal-visibility.spec.ts` (new)

**Intent**: Prove, end-to-end through two real browser sessions, that a
group member's already-locked numeric goal and its live progress are
rendered on another real member's `/groups/[id]` view, with no
progress-recording control exposed to that viewer.

**Contract**:
- One `test(...)` block, named after the risk it protects (e.g. `"a group
  member sees another member's committed goal and its current progress on
  the shared group view"`).
- Setup (inside the test body, per the Critical Implementation Details
  mutable-state note): two `browser.newContext()` contexts; both members via
  `signInContextAsNewUser(context, baseURL)` (throw if `baseURL` is
  unset, mirroring `auth.setup.ts`'s own guard); a service-role client
  (`createServiceRoleClient()`); `createGroupWithMembers(serviceClient,
  [author.id, viewer.id])`; `createGoalAt(serviceClient, { userId:
  author.id, description: <timestamped>, measureType: "numeric",
  targetValue: <e.g. 5>, createdAt: <now - 24h - 1s, mirroring
  tests/integration/goals-visibility.test.ts's `LOCKED_CREATED_AT`
  constant> })`.
- Action (author): navigate to `/goals`, open the seeded goal's "Dodaj
  postęp" dialog (scoped via `getGoalCard`), fill "Wartość do dodania" with
  an amount, submit ("Potwierdź"), wait for the "Postęp zapisany." banner.
- Assertion (viewer): navigate to `/groups/${groupId}`, assert
  `getGoalCard(viewerPage, description)` is visible, assert its text
  contains the updated value in the `<current> / <target>` shape rendered by
  `GoalCard.tsx:66-71,86`, and assert no `getByRole("button", { name:
  "Dodaj postęp" })` exists within that card locator.
- Cleanup (`test.afterEach`): `cleanupFixtures(serviceClient, { goalIds,
  groupIds, userIds })` (guard each array for the not-yet-created case),
  then close both browser contexts. Do not call the per-user `cleanup()`
  helper (see Critical Implementation Details).

### Success Criteria:

#### Automated Verification:

- New spec passes in isolation: `npx playwright test tests/e2e/group-goal-visibility.spec.ts`
- Full E2E suite still passes: `npm run test:e2e`
- Lint passes: `npm run lint`
- Build/typecheck passes: `npm run build`

#### Manual Verification:

- Temporarily break the guarantee under test (e.g. remove `readOnly={true}`
  from `src/pages/groups/[id].astro:89`, or comment out the `.lte(
  "created_at", cutoff)` filter in `listGroupMemberGoals`) and confirm the
  new spec fails; then revert the change and confirm it passes again — this
  is the "would this fail if the risk actually materialized?" check from
  `tests/e2e/CLAUDE.md`.
- Open the Playwright HTML report / trace for a passing run and visually
  confirm the viewer's rendered card shows the exact progress value the
  author entered, and that no progress-recording button is present in that
  card.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding. This is the plan's
only phase.

---

## Testing Strategy

### Unit Tests:

- None — no application code changes.

### Integration Tests:

- None — the query/RLS boundary this test builds on is already covered by
  `tests/integration/goals-visibility.test.ts` (rollout Phase 1, complete).

### Manual Testing Steps:

1. Run `npm run test:e2e` locally with local Supabase running and confirm
   the new spec passes alongside `seed.spec.ts`.
2. Run the new spec twice in a row and confirm no leftover rows/users remain
   between runs (fixture cleanup is complete) and that the timestamped goal
   description avoids any collision.
3. Perform the mutation check described in Phase 1's Manual Verification
   (break the guarantee, confirm failure, revert).

## Performance Considerations

None beyond what `fullyParallel: true` already accounts for — this spec
creates its own two isolated users and one isolated group per run, so it
cannot collide with other specs or with itself across parallel workers.

## Migration Notes

Not applicable — no schema or data changes.

## References

- Research: `context/changes/testing-north-star-e2e-coverage/research.md`
- Feature under test: `src/pages/groups/[id].astro`,
  `src/components/goals/GoalCard.tsx`, `src/lib/services/goals.ts`
- Exemplar pattern: `tests/e2e/seed.spec.ts`
- Multi-user auth helper: `tests/e2e/support/auth.ts`
- Fixture helpers: `tests/support/fixtures.ts`
- Prior integration coverage (Risk #1, query/RLS layer):
  `tests/integration/goals-visibility.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Author the cross-member goal/progress-visibility E2E spec

#### Automated

- [x] 1.1 New spec passes in isolation: `npx playwright test tests/e2e/group-goal-visibility.spec.ts`
- [x] 1.2 Full E2E suite still passes: `npm run test:e2e`
- [x] 1.3 Lint passes: `npm run lint`
- [x] 1.4 Build/typecheck passes: `npm run build`

#### Manual

- [x] 1.5 Mutation check: breaking the guarantee fails the spec; reverting passes it again
- [x] 1.6 Visual confirmation via Playwright HTML report / trace of the rendered progress value and absent progress control
