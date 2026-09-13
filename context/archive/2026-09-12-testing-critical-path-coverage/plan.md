# Testing Critical-Path Coverage — Implementation Plan

## Overview

This project has never had a test runner or a single test file. This plan bootstraps Vitest and writes the first tests, targeting the two highest-risk guarantees identified in `context/foundation/test-plan.md` §2 (Risk Map): **cross-group goal/progress visibility** (Risk #1, enforced by RLS) and the **24-hour immutability lock boundary** (Risk #2, enforced in application query WHERE clauses). This is test-plan.md §3 Phase 1.

## Current State Analysis

- Zero test files, zero test-related packages, no `test` script in `package.json`. `vitest`, `@vitest/*`, `msw`, `jest`, `@testing-library/*` are all absent.
- CI (`.github/workflows/ci.yml`) runs lint + build only. Per test-plan.md §3 Phase 4 ("Quality-gates wiring"), wiring any test step into CI is explicitly **out of scope for this phase** — Phase 4's job, not Phase 1's.
- `supabase` CLI is already a devDependency (`^2.23.4`); `supabase/config.toml` has migrations + seed enabled, local ports 54321 (API) / 54322 (DB).
- Risk #1 is enforced almost entirely by two OR'd RLS `select` policies on `goals` (`goals_select_own` at `supabase/migrations/20260829164522_create_goals.sql:50-53`, `goals_select_shared_group` at `supabase/migrations/20260906221830_widen_goals_visibility_to_group.sql:22-32`, a live `group_members` self-join). `listGroupMemberGoals` (`src/lib/services/goals.ts:87-118`) does not re-check membership itself — it trusts RLS completely. A test that stubs/mocks the Supabase client would prove nothing here; this requires a real Postgres instance with RLS active and two distinct authenticated sessions.
- Risk #2's cutoff arithmetic (`new Date(Date.now() - EDIT_WINDOW_MS).toISOString()`) is duplicated at three call sites in one file, never in RLS or a trigger: `updateGoals` (`goals.ts:153`, applied via `.gt("created_at", cutoff)` at `:171`), `deleteGoal` (`goals.ts:255`, `.gt(...)` at `:261`), and `listGroupMemberGoals` (`goals.ts:95`, applied **inverted** via `.lte("created_at", cutoff)` at `:100`). `recordProgress` (`goals.ts:195-251`) deliberately has no cutoff check at all.
- `src/lib/supabase.ts` only builds a cookie-based, anon-key SSR client — unsuitable for direct reuse in tests. No service-role client or multi-session test helper exists anywhere in the repo today.
- `tsconfig.json`'s `include` is already `["**/*"]` — a new `tests/` directory needs no tsconfig change to be type-checked.
- `auth.users` → `goals.user_id` and → `group_members.user_id` foreign keys use `NO ACTION` on delete (confirmed in `context/archive/2026-08-29-commit-a-goal/plan-brief.md:73` context, deferred to future S-06 anonymization) — deleting a test user via `auth.admin.deleteUser` will fail with a foreign-key violation unless dependent `goals`/`group_members` rows are deleted first.

## Desired End State

A developer can run `npm run test` (fast, zero external dependencies) and get passing unit tests proving the pure 24h-window helpers (`isEditable`, `editWindowRemainingMs`) are correct at the boundary. A developer with local Supabase running (`npx supabase start`) can run `npm run test:integration` and get passing integration tests proving: (a) cross-group goal/progress visibility is genuinely RLS-enforced — own goals, shared-group goals, and rejection of non-group and cross-user writes are all asserted against real Postgres, membership revocation on leave takes effect immediately — and (b) the 24h lock boundary is consistent and gap-free across `updateGoals`, `deleteGoal`, and `listGroupMemberGoals`, with `recordProgress`'s deliberate absence of a cutoff pinned as a regression test. `test-plan.md` §6.1/§6.2 cookbook sections are filled in with the patterns this phase establishes, and §3 Phase 1's status reflects that tests now exist.

### Key Discoveries:

- `supabase/migrations/20260829164522_create_goals.sql:3-9,61-62` — the 24h window's non-enforcement in RLS is a *documented, deliberate* design decision, not an oversight; tests must exercise the query-layer WHERE clause, not RLS.
- `context/archive/2026-08-29-commit-a-goal/reviews/impl-review.md` (F2/F3) — "0 rows affected" is an intentionally ambiguous signal covering both wrong-owner and window-closed cases; tests must assert against DB state (row read back), never against the HTTP response copy alone.
- Postgres allows overriding a column's `default now()` at `INSERT` time by supplying an explicit value — this is how boundary-exact `created_at` fixtures get created (no need to wait 24h or mutate the clock).
- `EDIT_WINDOW_MS`'s two operators meet at the same instant with no gap: `updateGoals`/`deleteGoal` use `.gt(created_at, cutoff)` (locked when `created_at <= cutoff`) and `listGroupMemberGoals` uses `.lte(created_at, cutoff)` (visible-in-group when `created_at <= cutoff`) — a goal created at exactly `cutoff` is simultaneously locked (not editable) **and** visible to the group, with no third state and no overlap where it's both editable and group-visible. This is the specific off-by-one class test-plan.md's Risk #2 guidance warns about, and it is the central assertion Phase 4 of this plan must make.

## What We're NOT Doing

- No CI wiring — deferred to test-plan.md §3 Phase 4, which will wrap the exact same `npm run test`/`npm run test:integration` scripts this phase produces in a GitHub Actions job (via the official `supabase/setup-cli` action for the integration leg).
- No Stryker/mutation testing — a separate, later, selective gate per `CLAUDE.md`'s Module 3 Lesson 2 guidance, not part of this phase.
- No coverage reporting or coverage thresholds.
- No tests for Risks #3, #4, #5, #6 — those belong to test-plan.md §3 Phases 2–4.
- No new Supabase migrations — no schema changes are needed for this phase.
- No addition of the service-role key to `astro.config.mjs`'s `env.schema` / `astro:env/server` — that virtual module is app-runtime-facing; the service-role key is test-only and must never be reachable from application code (see Critical Implementation Details).
- No auto-starting Supabase from `npm run test:integration` — confirmed decision; the script preflight-checks and fails fast with instructions instead, to avoid repeatedly triggering the documented Colima `supabase start` vector-sidecar flakiness (`context/foundation/lessons.md`) on every test run.
- No changes to `supabase/seed.sql` — fixtures are created and torn down per test file via the service-role client instead of shared seed data.

## Implementation Approach

Five phases, environment → helpers → risk #1 → risk #2 → cookbook, each independently verifiable: bootstrap the test runner first (nothing else can run without it), then build the shared test-only Supabase helpers both risk phases depend on, then write the two risk-specific test suites in the Risk Map's own priority order (#1 is High/High, #2 is High/Medium), then close out by updating the cookbook and rollout status that `test-plan.md` expects every phase to leave behind.

## Critical Implementation Details

**Service-role key stays out of the app's env boundary.** `SUPABASE_SERVICE_ROLE_KEY` must be read directly via `process.env.SUPABASE_SERVICE_ROLE_KEY` inside `tests/support/`, never added to `astro.config.mjs`'s `env.schema`. That schema feeds `astro:env/server`, which application code imports (`src/lib/supabase.ts:3`); adding the service-role key there would make it reachable — even accidentally — from a request-handling code path that bypasses RLS entirely. Local developers add it to their own `.env` (not committed) by running `npx supabase status` and copying the `service_role key` value; `.env.example` gets a placeholder line documenting this.

**Fixture teardown must respect FK ordering.** `goals.user_id`, `group_members.user_id`, and `groups.created_by` all reference `auth.users` with `NO ACTION` on delete (no cascade) — confirmed directly against `supabase/migrations/20260831123440_create_groups.sql:29,36` and `supabase/migrations/20260829164522_create_goals.sql:19`. A test's cleanup must delete in this order: `goals` rows → `group_members` rows → `groups` rows (if created) → `auth.admin.deleteUser(userId)`. Deleting a user before its dependent rows will fail with a foreign-key violation, silently leaving orphaned test users in the local database across runs.

**`profiles` cleans itself up — no teardown step needed.** `on_auth_user_created` (`supabase/migrations/20260831123440_create_groups.sql:166-168`) is a plain `AFTER INSERT ON auth.users` trigger calling the `SECURITY DEFINER` function `handle_new_user()`, which inserts a matching row into `public.profiles`. It fires identically for `auth.admin.createUser()` as for a real magic-link sign-up (it's a table-level trigger, not a GoTrue-flow-specific hook), so every test user created via `createTestUser` automatically gets a `profiles` row with no extra fixture step. `profiles.id references auth.users (id) on delete cascade` (`supabase/migrations/20260831123440_create_groups.sql:50`), so `deleteTestUser`'s `auth.admin.deleteUser` call automatically removes it too — `cleanupFixtures` must not (and does not need to) touch `profiles` explicitly.

**Boundary fixtures backdate `created_at` at insert time**, not by waiting or mocking the system clock: `INSERT INTO goals (..., created_at) VALUES (..., '<explicit timestamp>')` via the service-role client overrides the column's `default now()`. Each boundary test computes its target `created_at` relative to the *actual* current time at fixture-creation (e.g., `new Date(Date.now() - EDIT_WINDOW_MS - 1000)`), not a hardcoded date, so the test remains correct regardless of when it runs.

## Phase 1: Bootstrap Vitest

### Overview

Add Vitest, wire it to resolve `astro:env/server` and the `@/*` alias identically to the app, and split test execution into a dependency-free `test` script and a Supabase-dependent `test:integration` script that fails fast (no auto-start) when local Supabase isn't reachable.

### Changes Required:

#### 1. Add Vitest dependency and scripts

**File**: `package.json`

**Intent**: Install Vitest and give the project two entry points: fast unit tests with zero external dependencies, and integration tests that require a running local Supabase instance.

**Contract**: Add `vitest` to `devDependencies` (install the latest version compatible with the existing `vite` override, `^7.3.2` — Vitest resolves its own Vite peer dependency, so confirm compatibility at install time rather than assuming a specific version now). Add two scripts:
```
"test": "vitest run tests/unit",
"test:integration": "node scripts/check-local-supabase.mjs && npx supabase db reset && vitest run tests/integration"
```
`test:integration` runs `supabase db reset` unconditionally before the suite (per the Isolation decision: one reset per integration run, then per-test fixtures) — it assumes `supabase start` has already been run by the developer (or, in test-plan.md's future Phase 4, by a CI step); it never calls `supabase start` itself.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Reuse Astro's own Vite config (so `astro:env/server` and the `@/*` path alias resolve exactly as they do for the app) and load `.env` into `process.env` so both app secrets and the new test-only `SUPABASE_SERVICE_ROLE_KEY` are visible to test files.

**Contract**: Built with `getViteConfig` from `astro/config`, merged with `defineConfig` from `vitest/config`. Non-obvious part — Vite's own env loading exposes variables via `import.meta.env`, not `process.env`, but `astro:env/server` and `tests/support/` both expect `process.env`, so the config must explicitly bridge them:
```ts
import { getViteConfig } from "astro/config";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(
  getViteConfig({
    test: {
      env: loadEnv("", process.cwd(), ""),
    },
  }),
);
```

#### 3. Local-Supabase preflight check

**File**: `scripts/check-local-supabase.mjs` (new)

**Intent**: Fail `test:integration` fast and legibly when local Supabase isn't running, instead of letting every test in the suite time out against an unreachable host.

**Contract**: A short Node script (uses the built-in `fetch`, Node 22) that attempts a request to the configured `SUPABASE_URL` (default `http://127.0.0.1:54321`) with a ~2s timeout. On failure, prints `Local Supabase not reachable at <url> — run \`npx supabase start\` first (see context/foundation/lessons.md for the Colima workaround if it fails).` to stderr and exits with a non-zero code. On success, exits 0.

#### 4. Document the new test-only env var

**File**: `.env.example`

**Intent**: Make the new service-role requirement discoverable without exposing a real key.

**Contract**: Add one line, `SUPABASE_SERVICE_ROLE_KEY=###`, with a short comment above it noting it's test-only (obtained via `npx supabase status` for local dev) and must never be read by application code.

### Success Criteria:

#### Automated Verification:

- `npm run test` runs (with zero test files yet, an empty passing run is acceptable at this phase)
- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- With local Supabase stopped, `npm run test:integration` fails fast with the preflight message and does not hang
- With local Supabase running (`npx supabase start`), `npm run test:integration` runs `supabase db reset` and then Vitest (with zero test files yet, an empty passing run is acceptable at this phase)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Test-only Supabase helpers

### Overview

Add the shared, test-only building blocks both risk-specific test suites need: a service-role client, a way to create and sign in as independent test users, and fixture helpers for groups/goals (including backdated `created_at`).

### Changes Required:

#### 1. Service-role client

**File**: `tests/support/service-role-client.ts` (new)

**Intent**: Give tests a Supabase client that bypasses RLS, for fixture setup/teardown and for backdating `created_at`.

**Contract**: `export function createServiceRoleClient(): SupabaseClient` — plain `createClient` from `@supabase/supabase-js` (not `@supabase/ssr`, no cookies involved) using `process.env.SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY`, with `{ auth: { autoRefreshToken: false, persistSession: false } }`. Throws a clear error if either env var is missing.

#### 2. Test user lifecycle helper

**File**: `tests/support/test-users.ts` (new)

**Intent**: Create disposable, password-authenticated test users (the app itself is magic-link-only in production; this password path exists purely for test harness convenience) and sign in as each independently, so tests can assert what RLS permits per-user.

**Contract**:
- `createTestUser(serviceClient, email?: string): Promise<{ id: string; email: string; password: string }>` — generates a random email (if not given) and password, calls `serviceClient.auth.admin.createUser({ email, password, email_confirm: true })`.
- `signInAsTestUser(email: string, password: string): Promise<SupabaseClient>` — a fresh anon-key `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` (i.e. the existing `SUPABASE_KEY` env var, not service-role), then `.auth.signInWithPassword({ email, password })`; returns the now-authenticated client, which is what tests use as "user A's session" / "user B's session" to probe RLS.
- `deleteTestUser(serviceClient, userId: string): Promise<void>` — `serviceClient.auth.admin.deleteUser(userId)`. Callers must have already deleted that user's `goals`/`group_members` rows (see Critical Implementation Details — FK ordering).

#### 3. Group/goal fixture helpers

**File**: `tests/support/fixtures.ts` (new)

**Intent**: Give tests one-line ways to set up the exact scenarios Risk #1 and #2 need — a shared group, and a goal with a precisely controlled `created_at`.

**Contract**:
- `createGroupWithMembers(serviceClient, memberIds: string[], name?: string): Promise<string>` — inserts a `groups` row and one `group_members` row per member id; returns the new `groupId`.
- `createGoalAt(serviceClient, { userId, description, measureType, targetValue?, createdAt }): Promise<string>` — inserts a `goals` row with an explicit `created_at` (see Critical Implementation Details — this is how boundary-exact fixtures are made); returns the new `goalId`.
- `cleanupFixtures(serviceClient, { goalIds, groupIds, userIds }): Promise<void>` — deletes in FK-safe order: `goals` → `group_members` (via `groupIds`) → `groups` → each user via `deleteTestUser`.

### Success Criteria:

#### Automated Verification:

- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- A throwaway script (or a temporary test) confirms `createTestUser` + `signInAsTestUser` produces a client whose `auth.getUser()` returns the expected user id
- Confirm `cleanupFixtures` leaves no orphaned rows in `goals`, `group_members`, `groups`, or `auth.users` after a full create → use → cleanup cycle (check via Supabase Studio or the service-role client)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Integration tests — cross-group visibility (Risk #1)

### Overview

Prove, against real Postgres with RLS active, that goal/progress visibility matches PRD FR-012 / the "Closed-circle confinement" NFR: visible to the author and to shared-group members, invisible to everyone else, and revoked immediately on leaving a group.

### Changes Required:

#### 1. Cross-group visibility test suite

**File**: `tests/integration/goals-visibility.test.ts` (new)

**Intent**: Assert the RLS-backed visibility boundary directly — via the actual authenticated clients and actual DB responses, never by asserting only on rendered UI or HTTP status codes.

**Contract**: Using `tests/support/` helpers, each test creates its own users/group/goals and tears them down afterward. Cases:
- Own goal is returned by `listGoals` for its author.
- A goal older than the 24h window is returned by `listGroupMemberGoals` when the caller's session shares a group with the author.
- The same goal is **not** returned (empty result) when queried by a third user's session sharing no group with the author — asserted against the actual query result, not just UI omission.
- After the shared-group membership is removed (simulating `leaveGroup`), the next `listGroupMemberGoals` call (or a direct authenticated `.from("goals")` query) for that pair returns no rows for the departed relationship.
- A user's session cannot cause `recordProgress` to update another user's goal — assert `skipped` contains the goal id and the goal's `current_value`/`is_done` is unchanged when read back.
- A user's session cannot cause `updateGoals`/`deleteGoal` to affect another user's goal, even one well inside its own 24h window — assert `skipped`/`false` and that the row is unchanged/still present.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes (with local Supabase running)
- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- Intentionally break one assertion (e.g., temporarily widen a filter) and confirm the corresponding test fails — proving the test isn't vacuously passing

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: 24h immutability lock boundary tests (Risk #2)

### Overview

Prove the lock boundary is consistent and gap-free across all three call sites, exactly at the cutoff instant — the specific off-by-one class test-plan.md's Risk #2 guidance calls out — and pin `recordProgress`'s deliberate absence of a cutoff as a regression test.

### Changes Required:

#### 1. Unit tests for the pure display helpers

**File**: `tests/unit/goals-edit-window.test.ts` (new)

**Intent**: Cheaply cover `isEditable`/`editWindowRemainingMs` at the boundary without any DB dependency — these are pure functions of `createdAt` and the system clock.

**Contract**: For each of: created just now, created 24h-minus-1s ago, created exactly 24h ago, created 24h-plus-1s ago — assert `isEditable`'s boolean and `editWindowRemainingMs`'s value (0 once locked). Use `vi.setSystemTime`/`vi.useFakeTimers` to pin "now" so assertions are deterministic rather than racing the real clock.

#### 2. Integration tests for the query-layer boundary

**File**: `tests/integration/goals-lock-boundary.test.ts` (new)

**Intent**: Assert the actual query-layer enforcement in `updateGoals`, `deleteGoal`, and `listGroupMemberGoals` at the exact cutoff instant, and the consistency between them.

**Contract**: Using `createGoalAt` fixtures with `createdAt` set to (a) exactly the cutoff instant, (b) 1s inside the window (younger), (c) 1s outside the window (older):
- `updateGoals`/`deleteGoal`: (a) and (c) are both locked (`skipped`/`false`); (b) succeeds.
- `listGroupMemberGoals`: (a) and (c) are both visible to the group (locked = shown); (b) is not visible yet.
- A single goal fixture at exactly the cutoff instant is asserted, in the same test, to be simultaneously locked (`updateGoals` skips it) **and** group-visible (`listGroupMemberGoals` returns it) — the gap/overlap-free consistency check from Current State Analysis.
- `recordProgress` regression: a goal created far in the past (long locked) still accepts a progress update — `updated` contains its id and the new value is read back correctly.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes (unit tests)
- `npm run test:integration` passes (with local Supabase running)
- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- Temporarily flip one boundary operator (e.g. `.gt` to `.gte`) and confirm the corresponding boundary test fails — proving the test actually detects an off-by-one regression

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Cookbook update + rollout status sync

### Overview

Close out the phase per `test-plan.md`'s own convention: fill in the cookbook sections this phase establishes patterns for, and move Phase 1's rollout status forward.

### Changes Required:

#### 1. Cookbook: unit tests

**File**: `context/foundation/test-plan.md` (§6.1 "Adding a unit test")

**Intent**: Replace the "TBD" placeholder with the actual pattern this phase established.

**Contract**: Document: Vitest config location (`vitest.config.ts`, via `getViteConfig`), unit test location (`tests/unit/`), the `vi.setSystemTime` pattern for deterministic clock-dependent assertions, and the `npm run test` command.

#### 2. Cookbook: authorization/visibility integration tests

**File**: `context/foundation/test-plan.md` (§6.2 "Adding an integration test for an authorization/visibility boundary")

**Intent**: Replace the "TBD" placeholder with the actual pattern this phase established.

**Contract**: Document: the `tests/support/` helpers (service-role client, test user lifecycle, fixtures), the "assert against actual DB state / actual authenticated-client response, never against UI or HTTP status alone" rule, the FK-safe teardown ordering, and the `npm run test:integration` command (including the preflight-check/no-auto-start behavior and the `npx supabase start` prerequisite).

#### 3. Rollout status

**File**: `context/foundation/test-plan.md` (§3 Phased Rollout, Phase 1 row)

**Intent**: Reflect that Phase 1 now has a plan/implementation in flight, mirroring `change.md`'s own status.

**Contract**: Update the Phase 1 row's Status cell to `planned` (matching `change.md`'s `status: planned` set by this plan) — status is later advanced by whichever process (implementation, this project's own `/10x-test-plan` orchestrator) tracks execution completion.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (covers the modified Markdown via `prettier --write` through lint-staged conventions, though this file is committed directly rather than through a staged commit here)

#### Manual Verification:

- `test-plan.md` §6.1 and §6.2 no longer read "TBD — see §3 Phase 1"
- `test-plan.md` §3 Phase 1's Status cell reads `planned`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `isEditable`/`editWindowRemainingMs` at four points around the 24h boundary (now, 24h-1s, exactly 24h, 24h+1s), with the system clock pinned via `vi.setSystemTime`.

### Integration Tests:

- Cross-group visibility: own/shared-group/non-member/post-leave, plus cross-user write rejection for `recordProgress`/`updateGoals`/`deleteGoal`.
- 24h lock boundary: exact-cutoff/1s-inside/1s-outside for `updateGoals`, `deleteGoal`, `listGroupMemberGoals`, plus the same-instant gap/overlap-free consistency assertion, plus the `recordProgress`-has-no-cutoff regression.

### Manual Testing Steps:

1. Stop local Supabase; confirm `npm run test:integration` fails fast with the preflight message.
2. Start local Supabase (`npx supabase start`, applying the Colima `[analytics] enabled = false` workaround from `lessons.md` if needed); confirm `npm run test:integration` runs `supabase db reset` and then the full suite.
3. Temporarily break one assertion in each risk area (widen a visibility filter; flip a boundary operator) and confirm the corresponding test fails, proving the suite has real signal rather than being vacuously green.

## Performance Considerations

None beyond existing conventions — `target_scale` is `small`/`low` per `prd.md` frontmatter; each integration test creates and tears down a handful of rows.

## Migration Notes

No new Supabase migrations. No changes to existing migrations or `seed.sql`.

## References

- Research: `context/changes/testing-critical-path-coverage/research.md`
- Risk map & rollout: `context/foundation/test-plan.md` §2 (Risks #1, #2), §3 (Phase 1)
- PRD: `context/foundation/prd.md` FR-006, FR-012, NFR "Closed-circle confinement"
- Prior slice: `context/archive/2026-09-06-witness-the-circles-goals/plan.md` (RLS widening this phase tests)
- Prior slice: `context/archive/2026-08-29-commit-a-goal/plan.md` and its `reviews/impl-review.md` (original 24h-window design and the ambiguous-zero-rows signal)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap Vitest

#### Automated

- [x] 1.1 `npm run test` runs (empty pass acceptable) — de69e11
- [x] 1.2 `npx astro check` passes — de69e11
- [x] 1.3 `npm run lint` passes — de69e11

#### Manual

- [x] 1.4 `npm run test:integration` fails fast with preflight message when Supabase is stopped — de69e11
- [x] 1.5 `npm run test:integration` runs `supabase db reset` + Vitest when Supabase is running — de69e11

### Phase 2: Test-only Supabase helpers

#### Automated

- [x] 2.1 `npx astro check` passes — 270204f
- [x] 2.2 `npm run lint` passes — 270204f

#### Manual

- [x] 2.3 `createTestUser` + `signInAsTestUser` produces a correctly-authenticated client — 270204f
- [x] 2.4 `cleanupFixtures` leaves no orphaned rows — 270204f

### Phase 3: Integration tests — cross-group visibility (Risk #1)

#### Automated

- [x] 3.1 `npm run test:integration` passes — be74a2a
- [x] 3.2 `npx astro check` passes — be74a2a
- [x] 3.3 `npm run lint` passes — be74a2a

#### Manual

- [x] 3.4 An intentionally broken assertion causes the corresponding test to fail — be74a2a

### Phase 4: 24h immutability lock boundary tests (Risk #2)

#### Automated

- [x] 4.1 `npm run test` passes — c00b779
- [x] 4.2 `npm run test:integration` passes — c00b779
- [x] 4.3 `npx astro check` passes — c00b779
- [x] 4.4 `npm run lint` passes — c00b779

#### Manual

- [x] 4.5 A flipped boundary operator causes the corresponding test to fail — c00b779

### Phase 5: Cookbook update + rollout status sync

#### Automated

- [x] 5.1 `npm run lint` passes — 1174e83

#### Manual

- [x] 5.2 `test-plan.md` §6.1/§6.2 no longer read "TBD" — 1174e83
- [x] 5.3 `test-plan.md` §3 Phase 1 Status reads `planned` — 1174e83
