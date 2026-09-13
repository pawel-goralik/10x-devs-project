# Quality-Gates Wiring — Plan Brief

> Full plan: `context/changes/quality-gates-wiring/plan.md`
> Research: `context/changes/quality-gates-wiring/research.md`

## What & Why

Wire the already-shipped unit, integration, and north-star e2e test suites into CI, and land F-03 (automated Supabase migration deploy), closing a real production drift risk where migrations verified locally never reached prod. This is a deliberately narrowed slice of test-plan.md §3 Phase 5 — Phases 2/3 (not started) are excluded; their future tests need zero CI changes since the test scripts already glob whole directories.

## Starting Point

`ci.yml` runs lint + build only, zero tests. `deploy.yml` runs build + Worker deploy only, zero Supabase step. Neither workflow has real Supabase secrets configured (`gh secret list` shows only `CLOUDFLARE_API_TOKEN`) — harmless today since build never executes the Supabase client, but it means integration/e2e need their own local credentials, not production ones. No branch protection exists on `main`. A migration (`20260912183151_grant_service_role_groups_delete.sql`) is sitting unpushed to production right now — a live instance of the exact drift F-03 exists to fix.

## Desired End State

Every push/PR runs lint, build, unit, integration, and e2e against a fresh, self-contained local Supabase stack the CI job starts and discards — no secrets needed for that. Every merge to `main` pushes any pending migrations to production before the Worker deploys, using a scoped access token, fail-closed if a migration is broken.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| F-03 auth mechanism | `SUPABASE_ACCESS_TOKEN` + `supabase link` | Verified empirically that `--linked` needs no DB password — a scoped, revocable token is strictly better than a raw DB connection string. | Plan |
| CI job topology | One sequential job in `ci.yml` | Simplest workflow, one shared Supabase-stack lifecycle for integration+e2e; wall-clock cost accepted. | Plan |
| Branch protection | Leave informational | Matches this solo-maintainer repo's direct-push workflow; avoids a repo-settings change with real friction. | Plan |
| Pending migration | Leave for F-03 to pick up | Zero manual production actions outside the plan's normal phases. | Plan |
| Pre-merge migration dry-run | Skip — `deploy.yml` only | Keeps the production access token confined to one workflow file. | Plan |
| E2E cleanup gaps (F1/F2) | Leave as accepted risk, documented | Stays scoped to CI wiring, not fixing already-shipped/reviewed test code. | Plan |
| CI triggers for new steps | Both push-to-main and PR | Matches existing lint/build triggers; catches a bad direct push given no branch protection exists. | Plan |
| Supabase CLI tooling in CI | `npx supabase` (pinned devDependency) | One source of version truth, no extra GitHub Action needed. | Plan |

## Scope

**In scope:**
- `ci.yml`: unit + integration + e2e steps against a local Supabase stack
- `deploy.yml`: migration push before Worker deploy (F-03)
- `test-plan.md` §5 / Freshness Ledger sync

**Out of scope:**
- Phases 2/3 test authoring (separate, already-scoped rollout phases)
- Branch protection / required status checks
- Manually pushing the currently-pending migration ahead of F-03
- Fixing the two accepted e2e cleanup-robustness gaps
- Pre-merge migration dry-run checks

## Architecture / Approach

Two independent workflow-file edits with no shared infrastructure. `ci.yml`'s job boots a throwaway local Supabase stack via the CLI, maps its native env-var names onto the app's expected names via `$GITHUB_ENV`, and runs the three npm test scripts in sequence — no secrets involved. `deploy.yml` gains two steps (`supabase link`, `supabase db push --linked`) before `wrangler-action`, authenticated via one new secret and one new variable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Wire test suites into CI | Unit/integration/e2e green on every push/PR | First-run Docker image pulls may be slow; unverified pattern in this repo |
| 2. F-03 migration deploy | Migrations auto-apply to prod before Worker deploy | Requires human to provision `SUPABASE_ACCESS_TOKEN` correctly |
| 3. Documentation sync | `test-plan.md` reflects reality | Low risk, pure doc edit |

**Prerequisites:** none blocking — Phases 1 and 4 test suites already exist and pass locally; Supabase CLI already pinned in `package.json`.
**Estimated effort:** ~1 session across 3 phases (2 workflow-file edits + 1 doc sync).

## Open Risks & Assumptions

- `supabase start` inside GitHub Actions' Docker-in-Docker has never been verified in this repo — Phase 1's manual verification is the first real test of this pattern.
- The two accepted e2e cleanup gaps (F1/F2) could surface as orphaned rows under CI's parallel/retried conditions — documented, not fixed, per explicit scope decision.
- F-03's secret provisioning is a human action outside the agent's control — Phase 2 is blocked on it landing correctly.

## Success Criteria (Summary)

- Every PR/push shows five green CI checks (lint, build, unit, integration, e2e), informationally.
- A migration merged to `main` reaches production automatically, closing the exact drift incident that motivated F-03.
- Phases 2/3 of the test rollout require zero further CI changes when they eventually ship.
