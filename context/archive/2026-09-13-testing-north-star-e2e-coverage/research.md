---
date: 2026-09-13T16:14:13+02:00
researcher: Pawel Goralik
git_commit: d8ce3408e6d0b69bcaea8768d80804e1ea632b7a
branch: main
repository: 10x-devs-project
topic: "North-star e2e coverage — a group member sees another member's committed goal and progress via the shared group view, end-to-end"
tags: [research, codebase, e2e, playwright, groups, goals, visibility]
status: complete
last_updated: 2026-09-13
last_updated_by: Pawel Goralik
---

# Research: North-star e2e coverage (test-plan Phase 4)

**Date**: 2026-09-13T16:14:13+02:00
**Researcher**: Pawel Goralik
**Git Commit**: d8ce3408e6d0b69bcaea8768d80804e1ea632b7a
**Branch**: main
**Repository**: 10x-devs-project

## Research Question

Ground `context/changes/testing-north-star-e2e-coverage/` (rollout Phase 4 of
`context/foundation/test-plan.md`): what does it take to write one Playwright
E2E spec that proves — through the real UI, with two real signed-in browser
sessions — that a group member's committed goal and its current progress are
delivered to another real member on the shared group view? Risk #1
(cross-cutting, positive case): "a group member ... sees a goal/progress
belonging to someone outside every group they share" — here inverted to prove
the *positive* delivery path actually works end-to-end, not just that the
negative case is blocked (Phase 1 already covers the negative case at the
integration layer).

## Summary

The feature (roadmap S-03, "witness the circle's goals") is fully built and
shipped — `context/archive/2026-09-06-witness-the-circles-goals/`. Its own
verification was manual SQL (`SET ROLE authenticated`), explicitly flagged as
"not captured as a repeatable automated test" — exactly the gap this phase
closes. `tests/integration/goals-visibility.test.ts` already proves the
query/RLS layer (own/shared/non-member/post-leave) directly against the
service functions, with no browser and no rendered UI. The new E2E test's job
is narrower and different in kind: drive two real signed-in Playwright
browser contexts through the actual pages (`/goals`, `/groups/[id]`), and
prove the rendered `GoalCard` on the *viewer's* screen shows the *author's*
current progress value — closing the gap between "the query returns the
right rows" and "a real second human, in a real browser, actually sees it."

One hard constraint shapes the whole test: `listGroupMemberGoals`
(`src/lib/services/goals.ts:87-118`) only returns goals whose `created_at` is
already ≥24h old (the lock window) — a goal created moments ago through the
real UI will not appear on the group view for 24 real hours. The project's
own integration test works around this by backdating `created_at` via the
service-role client (`createGoalAt`); the E2E test should do the same for the
*goal's existence*, then drive the *progress bump* itself through the real
UI (since `recordProgress` has no lock-window check — it works on locked
goals too), and drive the *viewing* itself through the real UI as well. That
keeps the parts that matter for this risk (real second browser session, real
navigation, real rendered progress value) genuinely end-to-end, while
sidestepping a fixture problem (waiting 24h) that has nothing to do with the
risk being tested.

All infra this test needs already exists and needs no new plumbing:
`signInContextAsNewUser` for the second real user, `createGroupWithMembers` +
`createGoalAt` + `cleanupFixtures` for fixture setup/teardown via the
service-role client, and `getGoalCard` for the shared `data-testid` locator
pattern. This is a pure test-authoring phase, not an infra phase.

## Detailed Findings

### The feature under test: `src/pages/groups/[id].astro`

- Full file read at `src/pages/groups/[id].astro`. Server-side frontmatter
  (lines 9-33) fetches `group` via `getGroupDetail`, computes
  `otherMembers = group.members.filter(m => m.userId !== user?.id)` (line
  26), and calls `listGroupMemberGoals(supabase, otherMembers.map(m =>
  m.userId))` (lines 29-32) — a direct server-side data fetch during SSR, not
  an API route.
- Section heading: `<h2>Cele członków grupy</h2>` (line 72). Per-member
  sub-heading: `<h3>{member.email}</h3>` (line 82). Empty states:
  `Nie masz jeszcze innych członków w tej grupie.` (line 75, whole-section)
  and `Brak celów.` (line 84, per-member).
- Each goal renders as `<GoalCard client:load goal={goal} editable={false}
  remainingLabel={null} readOnly={true} />` (line 89) — the **same**
  `GoalCard` component used on the owner's own `/goals` page, just with
  different props.
- Invite link is always visible on this page (not a separate "generate"
  step): `inviteLink = new URL(\`/groups/join/${group.inviteToken}\`,
  Astro.url.origin).toString()` (line 21), rendered as a readonly `<input
  type="text" readonly value={inviteLink} ... />` with **no label/aria-label**
  (lines 46-52) — locate via `page.locator('input[readonly]')` or read the
  `value` attribute, not `getByLabel`.
- Leave-group form at the bottom: `<button>Opuść grupę</button>` (lines
  102-107) — not needed for this test but confirms the page's full shape.

### `GoalCard` read-only rendering: `src/components/goals/GoalCard.tsx`

- Full file read. Props type (line 28): `{editable: false; readOnly?:
  boolean} | {editable: true; readOnly?: false}` — a discriminated union
  (post-review tightening, see Historical Context) that only allows
  `readOnly` on the non-editable branch, matching how the group page uses it.
- `progressTrigger` is computed as `readOnly ? null : ...` (line 97) — so
  when the group page passes `readOnly={true}`, no "Dodaj postęp"/"Oznacz
  jako wykonane" button renders for the viewer (lines 154-164, the
  `!editable` render branch). A viewer can see the value but has no control
  to change it — this is the exact UI-level guarantee worth asserting, on
  top of what the integration test already proved at the query layer.
- `data-testid={\`goal-card-${goal.description}\`}` appears identically on
  both the editable branch (line 169) and the non-editable/read-only branch
  (line 157) — the same `getGoalCard` helper (`tests/e2e/support/locators.ts`)
  works on both `/goals` and `/groups/[id]`.
- Progress display the viewer will see, inside `progressSection` (lines
  62-95):
  - Numeric: `{isReached(goal) && "✓ "}{goal.currentValue}` followed by
    `/ {goal.targetValue}` (lines 66-71, 86) — plain text, no
    label/`aria-label`; assert via text content scoped inside the card's
    testid locator.
  - Boolean: `{goal.isDone ? "✓ Wykonano" : "Nieukończone"}` (lines 90-92).
- `celSection` (non-editable, lines 56-60): a plain `<p>{goal.description}</p>`
  under a `<p>Cel</p>` label-like heading — not a real `<label>`, so this is
  read via text content, not `getByLabel`.

### Owner-side progress recording (the action the author performs first, on `/goals`)

- Numeric goal: `<Button>` with text `Dodaj postęp` (lines 99-103) opens a
  shadcn `Dialog` (`DialogTitle`: `Dodaj postęp`, lines 105-109); the dialog
  form posts to `/api/goals/progress` with a real `<FormField
  label="Wartość do dodania" ...>` (lines 111-120, `FormField` renders an
  actual `<label htmlFor>`, so `getByLabel("Wartość do dodania")` works) and
  a submit button `Potwierdź` (line 122-124, via `SubmitButton`).
- Boolean goal: trigger button `Oznacz jako wykonane` (lines 130-135),
  dialog with the same title, a hidden input
  `progress.${goal.id}.done="on"` (line 143), same `Potwierdź` submit.
- `src/lib/services/goals.ts:195-251` (`recordProgress`, full function
  read): **no 24h/lock-window check anywhere** — it matches by
  `id`+`user_id`(+`measure_type`) only. This confirms progress can be bumped
  on an already-backdated/locked goal through the real UI, which is exactly
  what the test needs (seed the goal locked, then bump it live).
- On success: `context.redirect("/goals?progress=1")` →
  `src/pages/goals/index.astro:54-60` renders banner text `Postęp zapisany.`
  (useful as a wait-condition after the owner's real-UI progress action,
  e.g. `expect(page.getByText("Postęp zapisany.")).toBeVisible()` before
  switching to the viewer's context).

### The visibility gate under test: `src/lib/services/goals.ts:87-118` (`listGroupMemberGoals`)

- Full function read. `EDIT_WINDOW_MS = 24 * 60 * 60 * 1000` (line 4).
  Query: `.from("goals").select("*").in("user_id", memberIds).lte("created_at",
  cutoff)` where `cutoff = now - EDIT_WINDOW_MS` (lines 95-101) — **only
  fully-locked goals are ever returned to the group view.** A goal created
  seconds ago via the real UI will not appear here for 24 real hours; this
  is a hard constraint on how the E2E test must seed data (see Summary).
- Relies on RLS policy `goals_select_shared_group`
  (`supabase/migrations/20260906221830_widen_goals_visibility_to_group.sql`,
  per the archived plan) for the cross-member grant; this function adds only
  the lock-window filter on top. RLS itself does not know about the 24h
  window — this duplication is exactly test-plan Risk #2's documented
  concern, not something this E2E phase needs to re-verify (that's Phase 1's
  job, already `complete`).

### Group creation, invite, and join flow (setup path if driven through the UI — optional; fixtures can substitute)

- `src/pages/groups/index.astro:38-54` — create-group form: `<input
  name="name" type="text" placeholder="Nazwa grupy" required>` (**no
  `<label>`** — use `getByPlaceholder("Nazwa grupy")`) and `<button
  type="submit">Utwórz</button>`. `POST /api/groups`
  (`src/pages/api/groups/index.ts:11-32`) redirects to
  `/groups/${result.groupId}` on success (no separate confirmation banner).
- `src/pages/groups/join/[token].astro` — accept-invite page at
  `/groups/join/[token]` (token validated as a UUID, line 11). Heading:
  `Zaproszenie do dołączenia do grupy {preview.groupName}, utworzonej przez
  {preview.creatorEmail}` (lines 26-28). Not-yet-member state: form `POST
  /api/groups/join` with a `Dołącz` submit button (lines 44-53).
  `src/pages/api/groups/join.ts:14-38` redirects to `/groups/${groupId}` on
  success.
- **For this test, seeding the group via the service-role client
  (`createGroupWithMembers`) is preferable to driving the UI invite/join
  flow** — the invite/join UI path is its own risk surface (arguably a
  separate, lower-priority e2e candidate later), and this phase's scope is
  specifically the goal/progress-visibility flow, not group formation. The
  fixture approach is also what keeps the test's runtime and flakiness
  surface small (test-plan §1 principle #1: cheapest test that gives real
  signal wins).

### Existing e2e infra (all reusable, no new plumbing needed)

- `tests/e2e/support/auth.ts:19-44` (full file read) —
  `signInContextAsNewUser(context, baseURL)`: creates a fresh Supabase user
  via the service-role client, signs in, sets the
  `sb-<project-ref>-auth-token` cookie directly (no UI login), returns
  `{...user, cleanup}`. **This is the documented path for this exact
  scenario** — `tests/e2e/CLAUDE.md` explicitly calls out: "This
  single-identity assumption doesn't hold for a multi-user test. For that
  case, opt out of the project's default storageState." The shared
  `storageState` fixture (`auth.setup.ts`) covers only one identity and
  should be used for at most one of the two members (or neither, for
  symmetry/clarity — see Open Questions).
- `tests/support/fixtures.ts` (full file read):
  - `createGroupWithMembers(serviceClient, memberIds, name?)` (lines 5-34) —
    first id in `memberIds` becomes `created_by`; inserts all ids into
    `group_members`. Returns the group id.
  - `createGoalAt(serviceClient, {userId, description, measureType,
    createdAt, targetValue?})` (lines 43-72) — backdates `created_at`,
    inserting `current_value: 0` for numeric or `is_done: false` for
    boolean.
  - `cleanupFixtures(serviceClient, {goalIds?, groupIds?, userIds?})` (lines
    81-106) — deletes in FK-safe order: goals → group_members → groups →
    each user (via `deleteTestUser`).
- `tests/support/test-users.ts` (full file read) — `createTestUser`,
  `signInAsTestUser`, `deleteTestUser`; `deleteTestUser` (lines 64-86)
  already cleans up a user's own goals/memberships/created-groups before
  deleting the auth user, so per-user cleanup is safe even if group/goal
  fixture cleanup runs first or is skipped.
- `tests/support/service-role-client.ts` (full file read) —
  `createServiceRoleClient()`, bypasses RLS, requires
  `SUPABASE_SERVICE_ROLE_KEY` (test-harness-only, never used by application
  code).
- `tests/e2e/support/locators.ts:14-16` — `getGoalCard(page, description)` →
  `page.getByTestId(\`goal-card-${description}\`)`. Works identically for
  the owner's `/goals` view and a viewer's `/groups/[id]` view since both
  render the same component/testid.
- `tests/e2e/seed.spec.ts` (full file read) — the exemplar: module-level
  timestamped identifier, `afterEach` cleanup that checks existence first,
  role/label-based locators, waiting on visible text instead of
  `waitForTimeout`.

### Playwright config: `playwright.config.ts` / `package.json`

- `testDir: "./tests/e2e"`, `fullyParallel: true`, `baseURL:
  "http://localhost:4321"`.
- `webServer: { command: "npm run dev", url: baseURL, reuseExistingServer:
  !process.env.CI, timeout: 120_000 }` — Playwright auto-starts (or reuses)
  the dev server; no need to have it already running locally.
- Two projects: `"setup"` (`testMatch: /auth\.setup\.ts/`) and `"chromium"`
  (`storageState: E2E_STORAGE_STATE`, `dependencies: ["setup"]`).
- Run command: `npm run test:e2e` → `"node scripts/check-local-supabase.mjs
  && playwright test"` (no `supabase db reset` — unlike
  `test:integration`, local data persists across e2e runs by design, since
  the shared fixture account model already assumes non-empty state).
- Required env: `SUPABASE_URL`, `SUPABASE_KEY` (anon — app/runtime + the
  password-based sign-in helpers), `SUPABASE_SERVICE_ROLE_KEY`
  (test-harness-only fixture setup/teardown).

## Code References

- `src/pages/groups/[id].astro:9-33` - server-side fetch of group + other-member goals (SSR, not an API route)
- `src/pages/groups/[id].astro:71-100` - "Cele członków grupy" section, per-member grouping, empty states
- `src/components/goals/GoalCard.tsx:28` - discriminated `editable`/`readOnly` prop union
- `src/components/goals/GoalCard.tsx:56-95` - read-only `celSection`/`progressSection` markup (no labels, plain text)
- `src/components/goals/GoalCard.tsx:97,154-164` - `progressTrigger` suppressed when `readOnly`; non-editable render branch and its `data-testid`
- `src/lib/services/goals.ts:87-118` - `listGroupMemberGoals`, the 24h lock-window visibility filter
- `src/lib/services/goals.ts:195-251` - `recordProgress`, confirmed no lock-window check
- `src/pages/goals/index.astro:54-60` - "Postęp zapisany." confirmation banner after a progress POST
- `tests/e2e/support/auth.ts:19-44` - `signInContextAsNewUser`, the documented multi-user test path
- `tests/support/fixtures.ts:5-34,43-72,81-106` - `createGroupWithMembers`, `createGoalAt`, `cleanupFixtures`
- `tests/e2e/support/locators.ts:14-16` - `getGoalCard`
- `tests/e2e/CLAUDE.md` - e2e rules, incl. the explicit multi-user/storageState opt-out guidance
- `tests/integration/goals-visibility.test.ts` - existing query-layer coverage this E2E test must not duplicate
- `playwright.config.ts` - `webServer`, `baseURL`, `setup`/`chromium` projects
- `package.json` - `test:e2e` script and its env requirements

## Architecture Insights

- **Two-layer visibility enforcement, one duplication risk already flagged
  (test-plan Risk #2), already covered (Phase 1) — not this phase's job.**
  RLS grants row access the instant a shared-group relationship exists;
  `listGroupMemberGoals` adds the 24h lock filter on top, in application
  code, not in the database. This phase's E2E test should treat that
  boundary as a given (seed already-locked goals) rather than re-prove it.
- **`GoalCard` is one component serving two audiences** (owner-editable vs.
  member-viewing) via a prop-driven discriminated union, not two
  components. The E2E test's assertions about "no progress-recording
  control visible to the viewer" are really asserting that `readOnly` wiring
  stays correct — a real regression risk if a future refactor loosens the
  type back to two independent booleans (a past PR review already tightened
  this, see Historical Context).
- **The lock window is a hard seam between "real-time UI test" and
  "reality"**: nothing in this app lets a goal become group-visible in less
  than 24 real hours. Every existing test at every layer (unit, integration)
  already backdates `created_at` rather than waiting or mocking the system
  clock; this E2E test should follow the same convention for the *goal's
  age*, while still driving the *progress update* and the *cross-user
  viewing* steps for real, since those are exactly what no other test layer
  currently exercises.
- **Progress recording has no lock-window check by design** (`recordProgress`,
  `src/lib/services/goals.ts:195-251`) — a locked goal's progress can still
  be bumped by its owner. This is what makes seeding a backdated goal, then
  bumping it live through the UI, both realistic and necessary (a goal that
  can never be edited again can still be marked further along).

## Historical Context (from prior changes)

- `context/archive/2026-09-06-witness-the-circles-goals/plan.md` (roadmap
  S-03, three phases: RLS policy → `listGroupMemberGoals` → `GoalCard`
  `readOnly` prop + `[id].astro` section) — this is the feature this test
  covers. Its own verification was manual SQL role-switching, explicitly
  noted as not a repeatable automated test. Documents the lock-window
  duplication as a trap for future callers (e.g. the not-yet-built quarterly
  digest, roadmap S-05) — informs why this E2E test should NOT try to
  re-verify that duplication (already Phase 1's job) and should instead
  focus on the browser-delivery gap.
- `context/archive/2026-09-06-witness-the-circles-goals/reviews/impl-review.md`
  — post-review finding (F2) tightened `GoalCard`'s props to the
  discriminated union now in place (`GoalCard.tsx:28`), and (F1) flagged the
  opportunistic null-narrowing fix in `[id].astro` as scope creep, both
  already resolved before archiving; nothing outstanding for this phase.
- `context/foundation/test-plan.md` §3 Phase 1 (`testing-critical-path-coverage`,
  complete) already delivered `tests/integration/goals-visibility.test.ts`
  covering the query/RLS boundary this E2E test builds on top of, not
  duplicates.
- `context/foundation/test-plan.md` §8 Freshness Ledger flags (2026-09-13)
  that the real magic-link auth flow itself has zero test coverage anywhere
  — every harness identity (integration and E2E alike) bypasses it. Not in
  scope for this phase; noted only so the new spec doesn't accidentally
  claim to test auth delivery.

## Related Research

- No prior `research.md` exists for this change (first research pass).
- `context/changes/testing-critical-path-coverage/` (Phase 1, archived under
  its own change folder once complete — check `context/archive/` if a full
  history is needed) is the closest sibling artifact; its plan/tests are the
  integration-layer baseline this E2E test builds on.

## Open Questions

- **Which member gets the shared `storageState` fixture, if either?** Two
  viable shapes: (a) both members via `signInContextAsNewUser` (fully
  symmetric, no dependency on the shared fixture account's current state),
  or (b) the shared fixture account as the *viewer* and a fresh
  `signInContextAsNewUser` account as the *author* (fewer users to
  provision/clean up, but couples this test to the shared fixture account
  not having stale state from other parallel specs). Given `fullyParallel:
  true` and the shared account's mutable nature (per `tests/e2e/CLAUDE.md`),
  (a) — two fully isolated fresh users — is the safer default and avoids
  any interaction with other specs; leave the final call to `/10x-plan`.
- **Group membership order dependency**: the archived plan noted member
  ordering must come from `group.members` (by `joined_at`), not from
  `listGroupMemberGoals`'s unordered `Map` return. Not directly relevant to
  a single-other-member test case, but worth a one-line awareness note in
  the plan in case the test scenario grows to 3+ members later.
- **Whether to also assert the "no progress control visible to the viewer"
  negative UI assertion** (i.e., `Dodaj postęp`/`Oznacz jako wykonane` is
  absent inside the viewer's card) as part of this same test, or leave it
  implicit. It's a one-line `expect(...).not.toBeVisible()` and directly
  protects the `readOnly` wiring regression risk noted above — recommend
  including it, but `/10x-plan` should make the final call on test scope
  (test-plan §1 principle #1: don't over-invest beyond what the risk needs).
