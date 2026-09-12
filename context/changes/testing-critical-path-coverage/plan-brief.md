# Testing Critical-Path Coverage — Plan Brief

> Full plan: `context/changes/testing-critical-path-coverage/plan.md`
> Research: `context/changes/testing-critical-path-coverage/research.md`

## What & Why

Bootstrap Vitest — this project has never had a test runner — and write the first tests, targeting the two highest-risk guarantees on `test-plan.md`'s Risk Map: cross-group goal/progress visibility (Risk #1) and the 24-hour immutability lock boundary (Risk #2). This is test-plan.md §3 Phase 1.

## Starting Point

Zero test files, zero test packages, no `test` script. Risk #1 is enforced almost entirely by two RLS policies on `goals` doing a live `group_members` self-join — the service layer trusts RLS completely. Risk #2 is enforced in three duplicated query-WHERE-clause cutoff checks (never RLS/trigger), with `recordProgress` deliberately having no cutoff at all. No service-role or multi-session test client exists yet.

## Desired End State

`npm run test` runs fast unit tests (no external dependencies) proving the 24h-window helpers are boundary-correct. `npm run test:integration` (against local Supabase) proves cross-group visibility is genuinely RLS-enforced — including rejection cases and immediate revocation on leaving a group — and proves the lock boundary is gap-free and consistent across all three call sites. The cookbook (`test-plan.md` §6.1/§6.2) is filled in and Phase 1's rollout status moves to `planned`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Test-user auth | Service-role creates password-based test users, sign in via `signInWithPassword` | Simplest standard pattern; app itself stays magic-link-only, this path is test-harness-only | Plan (interview) |
| DB isolation | One `supabase db reset` per integration run + per-test fixtures via service-role | Deterministic; Supabase's HTTP client can't do transactional rollback anyway | Plan (interview) |
| Test scripts | Separate `test` (unit, no deps) and `test:integration` (needs local Supabase) | Matches the documented Colima Docker friction; keeps the ad-hoc integration gate genuinely ad hoc | Plan (interview) |
| Test-only helper location | New `tests/support/` directory | Physically separated from `src/`, so obviously excluded from the Cloudflare Worker bundle | Plan (interview) |
| Fixture source | Created/torn down per test file via service-role, not `seed.sql` | Avoids shared, mutable, order-dependent fixtures polluting local dev seed data | Plan (interview) |
| Local Supabase startup | `test:integration` preflight-checks and fails fast; never auto-starts Supabase | Avoids repeatedly triggering the documented Colima `supabase start` vector-sidecar flakiness on every run | Plan (interview) |
| CI wiring | Explicitly out of scope for this phase | `test-plan.md` §3 Phase 4 owns CI wiring; this phase's scripts are already CI-compatible unchanged | Research |

## Scope

**In scope:**
- Vitest bootstrap + `astro:env/server`/`@/*` resolution
- Service-role + multi-session test client helpers, fixture helpers (including backdated `created_at`)
- Integration tests for Risk #1 (visibility) and Risk #2 (lock boundary), plus one unit suite for the pure boundary helpers
- Cookbook (§6.1/§6.2) and rollout-status update in `test-plan.md`

**Out of scope:**
- CI wiring (test-plan.md Phase 4)
- Stryker/mutation testing, coverage reporting
- Risks #3–#6 (test-plan.md Phases 2–4)
- Any new Supabase migration or `seed.sql` change

## Architecture / Approach

`tests/support/` provides three building blocks — a service-role client (bypasses RLS for setup/teardown), a test-user lifecycle helper (password-based, sign-in-as-user), and fixture helpers (groups, backdated goals). Risk #1 tests use two independently authenticated sessions against real Postgres to assert what RLS actually permits. Risk #2 tests split into cheap unit tests (pure helpers, fake clock) and integration tests that assert the exact-cutoff boundary across all three duplicated call sites, plus one consistency assertion tying `updateGoals`'s lock and `listGroupMemberGoals`'s visibility together at the same instant.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Bootstrap Vitest | `vitest.config.ts`, `test`/`test:integration` scripts, preflight-check script | `astro:env/server` resolution inside Vitest is non-obvious |
| 2. Test-only Supabase helpers | Service-role client, test-user lifecycle, fixture helpers | FK ordering on teardown (`NO ACTION` on `auth.users` deletes) |
| 3. Risk #1 integration tests | Cross-group visibility + cross-user write rejection, assert on real RLS | A stubbed/mocked test would prove nothing here — must stay real-Postgres |
| 4. Risk #2 boundary tests | Unit + integration tests pinning the exact-cutoff, gap-free boundary | Off-by-one at the boundary is exactly what test-plan.md warns is likely |
| 5. Cookbook + status sync | `test-plan.md` §6.1/§6.2 filled in, Phase 1 status → `planned` | None |

**Prerequisites:** Local Docker (Colima acceptable, with the documented `[analytics] enabled = false` workaround) and `npx supabase start` for Phases 2–4's manual verification.
**Estimated effort:** ~3-4 sessions across 5 phases.

## Open Risks & Assumptions

- The exact Vitest version compatible with the existing `vite ^7.3.2` override isn't pinned in the plan — resolve at install time.
- `NO ACTION` FK behavior on `auth.users` deletes is asserted from a prior archived plan-brief's context, not re-verified against the live schema in this planning session — Phase 2's manual verification step will surface it immediately if wrong.

## Success Criteria (Summary)

- `npm run test` and `npm run test:integration` both exist and pass.
- A developer can prove to themselves (by intentionally breaking an assertion) that both risk suites have real signal, not vacuous passes.
- `test-plan.md`'s cookbook and Phase 1 status reflect this work.
