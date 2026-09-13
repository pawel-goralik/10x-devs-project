# Quality-Gates Wiring Implementation Plan

## Overview

Wire the already-shipped unit, integration, and north-star e2e test suites into `.github/workflows/ci.yml` as one sequential job running against an ephemeral local Supabase stack, and land F-03 (automated Supabase migration deploy) in `.github/workflows/deploy.yml` using a scoped `SUPABASE_ACCESS_TOKEN`. This is a deliberately narrowed slice of test-plan.md §3 Phase 5 — Phases 2 and 3 (not started) are out of scope; their future integration tests will be picked up automatically by the directory-glob test scripts wired here, with no further CI changes needed.

## Current State Analysis

- `.github/workflows/ci.yml` runs lint + build only — zero test steps exist. It triggers on `push: [main]` and `pull_request: [main]`.
- `.github/workflows/deploy.yml` runs build + `cloudflare/wrangler-action@v3` only — no Supabase step of any kind. It triggers on `push: [main]`.
- Neither workflow has ever had Supabase credentials as real GitHub secrets: `gh secret list` shows only `CLOUDFLARE_API_TOKEN` (secret) and `CLOUDFLARE_ACCOUNT_ID` (variable). The `secrets.SUPABASE_URL`/`secrets.SUPABASE_KEY` referenced in both workflows' build steps resolve to empty strings today — harmlessly, since Astro's SSR build never executes the Supabase client at build time.
- No branch protection exists on `main` (`gh api repos/.../branches/main/protection` → 404) — CI is informational only today, by design (per this change's decisions below).
- `npm run test` (unit), `npm run test:integration`, and `npm run test:e2e` all exist and pass locally, but have never run in CI.
- `test:integration` and `test:e2e` both require a running local Supabase CLI stack (`npx supabase start`) — confirmed via `scripts/check-local-supabase.mjs`'s GoTrue-health preflight check and `test:integration`'s own `npx supabase db reset` step, which is a Supabase-CLI-only command (a bare `postgres:` service container would not satisfy it).
- The project is already linked locally to its real Supabase project (`onmirtudxfjmdjwebeio`, per `context/changes/deployment/deployment-plan.md` Phase 1b) — but that link happened once, manually, on a human's workstation, and is not reproduced anywhere in CI.
- A live drift instance exists right now: `supabase db push --linked --dry-run` (run locally during planning) shows `20260912183151_grant_service_role_groups_delete.sql` is not yet applied to production. Per this change's scope decision, this is left for F-03's first real run to pick up — not fixed manually here.

### Key Discoveries:

- `supabase db push --linked` needs **no DB password** — verified empirically (`npx supabase db push --linked --dry-run` succeeded using only the CLI's stored access-token identity plus the project-ref, no password prompt). Only `SUPABASE_ACCESS_TOKEN` is needed as a CI secret.
- `npx supabase status -o env` (run locally during planning) prints local-stack credentials under CLI-native names — `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL`, etc. — not the app's expected `SUPABASE_URL`/`SUPABASE_KEY`/`SUPABASE_SERVICE_ROLE_KEY`. The CI step must map between these names (see Critical Implementation Details).
- `tests/support/service-role-client.ts:8-22` and `tests/support/test-users.ts:33-51` read `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` directly from `process.env` — none of these go through Astro's `env.schema`, so a CI step can export them as plain env vars without touching `astro.config.mjs`.
- `playwright.config.ts:35-40`'s `webServer` block always cold-starts `npm run dev` in CI (`reuseExistingServer: !process.env.CI`) — no separate "start the app" step is needed for e2e, but the dev server needs the same local Supabase env vars present in its process environment to boot with working auth.
- No Playwright-browser-install step exists anywhere in the repo today — must be added for the e2e step to have a Chromium binary.
- Two pre-existing, accepted (SKIPPED) cleanup-robustness gaps in the e2e helpers (`context/changes/testing-north-star-e2e-coverage/reviews/impl-review.md` F1/F2) are more likely to surface under CI's parallel/retried conditions than locally — per this change's scope decision, left as documented residual risk, not fixed here.

## Desired End State

`ci.yml` runs lint, build, unit, integration, and e2e on every push to `main` and every PR, entirely against a fresh local Supabase stack it starts and tears down itself — no secrets required. `deploy.yml` pushes any pending Supabase migrations to production immediately before deploying the Worker, using a scoped access token, so a migration merged to `main` can never again silently fail to reach production. Both gates are informational (no branch protection) per this change's decisions — a human still merges/pushes at their own discretion, but red CI is now visible for all five checks, and prod schema drift is closed going forward.

**Verification**: open a PR touching a trivial file, confirm all five `ci.yml` steps (lint, build, unit, integration, e2e) run and pass; merge to `main` and confirm `deploy.yml`'s new migration-push step runs before `wrangler-action` and (once the pending migration is provisioned per Phase 2) applies `20260912183151_grant_service_role_groups_delete.sql` to production.

## What We're NOT Doing

- Not wiring Phase 2 (side-effect ordering) or Phase 3 (abuse-surface hardening) tests — they don't exist yet; `test:integration`'s directory glob will pick up their future test files automatically with zero CI changes.
- Not enabling branch protection / required status checks on `main` — decided explicitly; CI stays informational for now.
- Not manually pushing the currently-pending migration (`20260912183151_grant_service_role_groups_delete.sql`) ahead of this change — decided explicitly; F-03's first real run in Phase 2 will pick it up along with everything else going forward.
- Not adding a pre-merge migration dry-run check to `ci.yml` — decided explicitly; only `deploy.yml`'s real push exists, keeping the production access token confined to one workflow file.
- Not fixing the two accepted e2e cleanup-robustness gaps (F1/F2 from the Phase 4 impl-review) — decided explicitly; documented as an open risk instead, since fixing them means touching already-shipped, reviewed test code from a different change.
- Not touching `astro.config.mjs`'s `env.schema` — the test-harness env vars (`SUPABASE_SERVICE_ROLE_KEY` in particular) are deliberately kept outside it.
- Not upgrading the pinned `supabase` CLI devDependency version (currently resolves to 2.109.1 via the `^2.23.4` range) as part of this change.

## Implementation Approach

Two independent workflow-file changes, no shared infrastructure between them:

1. `ci.yml` gains one job (extending the existing `ci` job) that boots a throwaway local Supabase stack via the CLI already pinned in `package.json` (`npx supabase` — no separate `supabase/setup-cli` action, keeping one source of version truth), derives env vars from it, and runs the three existing npm test scripts in sequence after lint/build. This never touches production and needs no secrets.
2. `deploy.yml` gains two steps — `supabase link` then `supabase db push --linked` — inserted before the existing `wrangler-action` step, so a broken migration fails the deploy job before the Worker ships (fail-closed). This needs one new secret (`SUPABASE_ACCESS_TOKEN`) and one new variable (`SUPABASE_PROJECT_REF`).

## Critical Implementation Details

**Env var name mapping for the local Supabase stack**: `npx supabase status -o env` prints `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` (among others), but the app's test harness and dev server expect `SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The CI step must read the CLI's output and re-export under the app's names, e.g.:

```bash
npx supabase start
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
{
  echo "SUPABASE_URL=$API_URL"
  echo "SUPABASE_KEY=$ANON_KEY"
  echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY"
} >> "$GITHUB_ENV"
```

Every subsequent step in the job (unit — unaffected, integration, e2e's dev server) inherits these via `$GITHUB_ENV`.

**Ordering in `deploy.yml`**: the migration-push step must run *before* `cloudflare/wrangler-action@v3`, not after — this makes the deploy fail-closed (a broken migration blocks the Worker deploy entirely) and ensures the new Worker code never runs against stale schema.

## Phase 1: Wire test suites into CI

### Overview

Add unit, integration, and e2e test execution to the existing `ci` job in `.github/workflows/ci.yml`, after the current lint/build steps, against a local Supabase stack the job starts itself.

### Changes Required:

#### 1. `.github/workflows/ci.yml`

**Intent**: Extend the single existing `ci` job so that, after `npm run lint` and `npm run build`, it runs the unit suite (no dependencies), then starts a local Supabase stack and runs the integration and e2e suites against it, installing Playwright's Chromium browser first.

**Contract**: Append these steps to the existing job, in order: `npm run test` → `npx supabase start` → derive-and-export env vars (per Critical Implementation Details) → `npm run test:integration` → `npx playwright install --with-deps chromium` → `npm run test:e2e`. No changes to the job's existing `push`/`pull_request` triggers (both already fire on `main`) and no new secrets — this job needs none.

#### 2. `.github/workflows/deploy.yml` — gate deploy on CI success

**Intent**: Before this addition, `deploy.yml` triggered independently on `push: [main]`, with zero dependency on `ci.yml`'s outcome — a failing lint/build/unit/integration/e2e run would not stop a deploy. Once `ci.yml` carries real test gates, that gap becomes a live risk rather than a theoretical one, so this change closes it as part of Phase 1's scope (spotted during manual verification, not in the original research/plan).

**Contract**: Change `deploy.yml`'s trigger from `on: push: branches: [main]` to `on: workflow_run: { workflows: ["CI"], types: [completed], branches: [main] }`, add `if: github.event.workflow_run.conclusion == 'success'` on the `deploy` job (so it's skipped, not failed, when CI didn't succeed), and pin `actions/checkout@v4`'s `ref` to `${{ github.event.workflow_run.head_sha }}` so deploy always builds the exact commit CI validated rather than whatever `main` happens to be at trigger time. `workflow_run`'s `branches` filter matches the branch the *triggering* workflow ran on — for a push-triggered CI run that's `main`; for a PR-triggered CI run it's the PR's head branch — so this preserves the existing behavior of never deploying from a PR run, only from a push to `main`.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes in CI: unit suite green
- `npm run test:integration` passes in CI: integration suite green against the freshly started local stack
- `npm run test:e2e` passes in CI: north-star e2e spec green, including its own `auth.setup.ts` project

#### Manual Verification:

- Open a PR with a trivial change and confirm all five CI steps (lint, build, unit, integration, e2e) show green in the GitHub Actions UI
- Confirm total job wall-clock time is reasonable (a first run may be slower due to cold Docker image pulls for the Supabase stack) and note the actual duration for future reference
- Confirm no orphaned Supabase rows/containers linger after the job completes (spot-check by re-running the job twice in a row and watching for cumulative slowdown or `db reset` failures)
- Confirm a push to `main` triggers `deploy.yml` via `workflow_run` only after `ci.yml` completes (not immediately on push), and only when `ci.yml`'s conclusion is `success`

---

## Phase 2: F-03 — automated Supabase migration deploy

### Overview

Add a migration-push step to `.github/workflows/deploy.yml`, run before the existing `wrangler-action` deploy step, so migrations merged to `main` reach production automatically.

### Changes Required:

#### 1. Provision credentials (human action, before the workflow change lands)

**Intent**: Generate a Supabase access token scoped for CI use and record the project's ref as a non-secret repo variable, so `deploy.yml` can authenticate non-interactively.

**Contract**: Human generates a personal/service access token from the Supabase dashboard (Account → Access Tokens), then runs `gh secret set SUPABASE_ACCESS_TOKEN` (pastes the token when prompted) and `gh variable set SUPABASE_PROJECT_REF --body onmirtudxfjmdjwebeio` (the ref already used by this project's local link, per `context/changes/deployment/deployment-plan.md` Phase 1b — not sensitive, just an identifier).

#### 2. `.github/workflows/deploy.yml`

**Intent**: Before deploying the Worker, link to the production Supabase project and push any pending migrations, so the deploy fails closed if a migration is broken.

**Contract**: Insert two steps immediately after `npm run build` and before the `cloudflare/wrangler-action@v3` step: `npx supabase link --project-ref "$SUPABASE_PROJECT_REF"` then `npx supabase db push --linked`, both with `SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}` in their `env:`. No DB password needed (verified empirically during planning).

### Success Criteria:

#### Automated Verification:

- `gh secret list` shows `SUPABASE_ACCESS_TOKEN` present
- `gh variable list` shows `SUPABASE_PROJECT_REF` present
- Deploy job's migration-push step exits 0 on a merge to `main` with no pending migrations (no-op success)

#### Manual Verification:

- Merge a trivial change to `main` and confirm the deploy job's new steps run before `wrangler-action`, and that the previously-pending `20260912183151_grant_service_role_groups_delete.sql` migration is now applied — confirm via `npx supabase migration list --linked` showing it present remotely
- Confirm the Worker still deploys successfully immediately after (no regression to the existing deploy step)
- Deliberately verify fail-closed behavior once: temporarily point at a bad ref or token (locally, not by breaking the real workflow) to confirm `db push` failing would stop the job before `wrangler-action` runs — or reason through the step ordering as sufficient proof if a live failure test isn't practical

---

## Phase 3: Documentation sync

### Overview

Update `test-plan.md` to reflect that the unit/integration/e2e gates are now actually wired into CI (informationally, not merge-blocking), and that F-03 has landed.

### Changes Required:

#### 1. `context/foundation/test-plan.md`

**Intent**: Bring §5's Quality Gates table and the Freshness Ledger in line with reality now that CI enforces these checks.

**Contract**: In the §5 table, update the "Required?" column for the `unit + integration` and `e2e on north-star flow` rows to note they run in CI on every push/PR but are informational only (no branch protection) rather than merge-blocking; update the `automated Supabase migration deploy` row to reflect F-03 as landed rather than "not yet wired". Add a Freshness Ledger entry dated with this change's completion noting Phase 5 (as scoped by `quality-gates-wiring`) shipped, and that Phases 2/3 remain not-started with no CI follow-up needed when they do land.

### Success Criteria:

#### Automated Verification:

- `git diff context/foundation/test-plan.md` shows only the intended §5/Freshness-Ledger edits, no unrelated changes

#### Manual Verification:

- Read the updated §5 table and Freshness Ledger and confirm they accurately describe the post-Phase-1/2 state (informational gates, F-03 landed, Phases 2/3 still pending with no CI action needed)

---

## Testing Strategy

### Unit Tests:

- No new unit tests — this change wires existing suites into CI, it doesn't add test coverage.

### Integration Tests:

- No new integration tests — same rationale.

### Manual Testing Steps:

1. Open a PR with a trivial change (e.g. a comment tweak) and watch all five `ci.yml` steps go green.
2. Merge that PR and watch `deploy.yml` run the new migration-push steps before `wrangler-action`, confirming the pending migration lands in production.
3. Re-run the CI job a second time (e.g. an empty commit) to confirm no cumulative state leaks from the first run (fresh Supabase stack each time, no orphaned containers).

## Performance Considerations

- `supabase start`'s first run per job pulls several Docker images cold — expect the integration/e2e portion of the CI job to be meaningfully slower than lint/build/unit. No caching strategy is being added in this change; revisit only if CI time becomes a real friction point.
- `playwright.config.ts` already caps CI to 2 workers with 2 retries — no changes needed here, but e2e will be the single longest step in the job.

## Migration Notes

- Not applicable in the schema-migration sense beyond F-03 itself (Phase 2) — no data migration is needed for this change.

## References

- Roadmap: F-03 (`automated-migration-deploy`, Foundations section) — `context/foundation/roadmap.md`. Its `Change ID` now points at `quality-gates-wiring`, bundled as this plan's Phase 2, so the roadmap's status auto-syncs to `done` when this change is archived.
- Related research: `context/changes/quality-gates-wiring/research.md`
- Prior CI/deploy setup: `context/changes/deployment/deployment-plan.md`
- Phase 1 test suites: `context/changes/testing-critical-path-coverage/plan.md`
- Phase 4 e2e suite: `context/changes/testing-north-star-e2e-coverage/plan.md`, `context/changes/testing-north-star-e2e-coverage/reviews/impl-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wire test suites into CI

#### Automated

- [x] 1.1 `npm run test` passes in CI — b5fb8ba
- [x] 1.2 `npm run test:integration` passes in CI — b5fb8ba
- [x] 1.3 `npm run test:e2e` passes in CI — b5fb8ba

#### Manual

- [x] 1.4 PR shows all five CI steps green — b5fb8ba
- [x] 1.5 Job wall-clock time confirmed reasonable, duration noted — b5fb8ba
- [x] 1.6 No orphaned Supabase rows/containers after repeated runs — b5fb8ba
- [x] 1.7 Deploy triggers via `workflow_run` only after CI completes, only on success — b5fb8ba

### Phase 2: F-03 — automated Supabase migration deploy

#### Automated

- [x] 2.1 `gh secret list` shows `SUPABASE_ACCESS_TOKEN` — ce85059
- [x] 2.2 `gh variable list` shows `SUPABASE_PROJECT_REF` — ce85059
- [x] 2.3 Deploy job's migration-push step exits 0 with no pending migrations — 1ee7c32

#### Manual

- [x] 2.4 Merge to `main` applies the pending migration to production, confirmed via `supabase migration list --linked` — 1ee7c32
- [x] 2.5 Worker still deploys successfully after the new steps — 1ee7c32
- [x] 2.6 Fail-closed behavior verified or reasoned through — 1ee7c32

### Phase 3: Documentation sync

#### Automated

- [x] 3.1 `git diff context/foundation/test-plan.md` shows only intended edits

#### Manual

- [x] 3.2 Updated §5 table and Freshness Ledger read back as accurate
