---
date: 2026-09-13T17:51:39+02:00
researcher: Pawel Goralik
git_commit: 982732d18133019930797e6ae9f85c41e648bc0a
branch: main
repository: 10x-devs-project
topic: "Wire Phases 1 & 4 test suites into CI, land F-03 migration-deploy automation (test-plan.md §3 Phase 5, scoped)"
tags: [research, codebase, ci, github-actions, supabase, playwright, vitest, deploy]
status: complete
last_updated: 2026-09-13
last_updated_by: Pawel Goralik
---

# Research: Wire Phases 1 & 4 into CI + F-03 migration-deploy automation

**Date**: 2026-09-13T17:51:39+02:00
**Researcher**: Pawel Goralik
**Git Commit**: 982732d18133019930797e6ae9f85c41e648bc0a
**Branch**: main
**Repository**: 10x-devs-project

## Research Question

`test-plan.md` §3 Phase 5 ("Quality-gates wiring") calls for wiring Phases 1–4 into CI and landing F-03. This change narrows that scope (per user decision, see `change.md`) to: wire the already-shipped unit suite, integration suite, and Phase 4 north-star e2e test into `.github/workflows/ci.yml`, and land F-03 (automated Supabase migration deploy) in `.github/workflows/deploy.yml`. Phases 2 and 3 (not started) are deliberately excluded — they will only add more files under `tests/integration/`, which `npm run test:integration`'s directory glob already picks up with no CI changes needed.

What does the codebase actually require to make that wiring work?

## Summary

- **CI today runs zero tests.** `.github/workflows/ci.yml` is lint + build only (25 lines). No `services:` block, no Supabase, no Playwright anywhere in either workflow.
- **Unit tests need nothing external** — `npm run test` (`vitest run tests/unit --passWithNoTests`) has no Supabase dependency at all. This is the easy win.
- **Integration and e2e both need a full local Supabase CLI stack running in the CI job**, not just a bare Postgres service container — `test:integration` calls `npx supabase db reset` (a Supabase-CLI-only command) and both suites' preflight check (`scripts/check-local-supabase.mjs`) specifically probes GoTrue's `/auth/v1/health`, and `tests/support/test-users.ts`/`service-role-client.ts` depend on GoTrue-backed auth. **This exact CLI-vs-services-block decision was already flagged as unresolved by the Phase 1 plan/research** (`testing-critical-path-coverage/research.md:145`) and anticipated using `supabase/setup-cli` plus a `supabase start` step (`testing-critical-path-coverage/plan.md:31`) — but nothing has verified this actually works in GitHub Actions yet.
- **Integration tests need three env vars pointed at the local Supabase stack**: `SUPABASE_URL`, `SUPABASE_KEY` (anon), `SUPABASE_SERVICE_ROLE_KEY` (test-harness-only, deliberately outside Astro's `env.schema`). E2e needs the same three, consumed both by the test harness and by the dev server Playwright auto-starts.
- **E2e also needs Playwright browsers installed** (`playwright install` / `--with-deps`) — no such step exists anywhere today — and will cold-start `npm run dev` itself every CI run (`webServer.reuseExistingServer: !process.env.CI`), inside a 120s timeout.
- **E2e auth bypasses the real magic-link flow entirely** (session-cookie injection) — no Inbucket/Mailpit/email service is needed for CI.
- **Two pre-existing, accepted (SKIPPED) cleanup-robustness gaps** in the e2e spec/helpers (non-`try/finally` cleanup, and a user-creation-order bug) mean transient failures under CI's constrained/parallel/retried environment could leave orphaned Supabase rows across runs — worth flagging to the plan, not necessarily fixing here (this change's job is wiring, not fixing shipped test code).
- **F-03 is entirely unimplemented and has real open unknowns.** No workflow, script, or doc anywhere references `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, `supabase link`, or `supabase db push`. The project *was* linked to a real Supabase project once — but manually, locally, by a human (`deployment-plan.md:68-72`: `supabase login` + `supabase link --project-ref <ref>`), never in CI. `roadmap.md:108` already flags the exact unknown this research needs to close before planning: what secrets does `supabase db push --linked` need in CI, beyond what `wrangler-action` already has (`CLOUDFLARE_API_TOKEN` secret, `CLOUDFLARE_ACCOUNT_ID` var — confirmed, no other secrets feed the Worker deploy). This remains open — needs a user decision/provisioning step, not something inferable from the repo.
- There is direct precedent for caution around Supabase config pushes: `deployment-plan.md`'s config-drift lesson (also captured in memory) found that `supabase config push` overwrites the *entire* remote `[auth]` block, not just the touched fields — relevant if F-03's `db push` step (or any future `config push`) needs care in CI.

## Detailed Findings

### CI/CD current state

- `.github/workflows/ci.yml:1-25` — checkout → setup-node@v4 (node 22) → `npm ci` → `npx astro sync` → `npm run lint` → `npm run build` (env: `SUPABASE_URL`, `SUPABASE_KEY` secrets). No test step, no `services:` block.
- `.github/workflows/deploy.yml:1-27` — checkout → setup-node@v4 → `npm ci` → `npx astro sync` → `npm run build` (same two secrets) → `cloudflare/wrangler-action@v3` (`CLOUDFLARE_API_TOKEN` secret, `CLOUDFLARE_ACCOUNT_ID` var, `wranglerVersion: "4.112.0"`). No Supabase step of any kind.
- Confirmed via full-repo grep: no existing reference anywhere (workflows, scripts, README, CLAUDE.md, context/**) to `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, or `SUPABASE_PROJECT_REF`. `supabase link`/`supabase db push` only appear in planning prose (`deployment-plan.md:45,71`; `roadmap.md:108`; `test-plan.md:55`; this change's own `change.md:20`), never in actual code.

### Test suite requirements

**Unit** (`npm run test` → `vitest run tests/unit --passWithNoTests`, `package.json:13`)
- No Supabase dependency. `vitest.config.ts:1-17` is a plain `defineConfig` with a `@/*` alias and `loadEnv` — notably it does **not** use `getViteConfig`/`astro:env/server` the way `testing-critical-path-coverage/plan.md:81-94` originally described; the shipped config is simpler. Non-issue for CI.

**Integration** (`npm run test:integration` → `package.json:14`: `check-local-supabase.mjs && npx supabase db reset && vitest run tests/integration --passWithNoTests`)
- Needs `SUPABASE_URL`, `SUPABASE_KEY` (anon), `SUPABASE_SERVICE_ROLE_KEY` — read by `tests/support/service-role-client.ts:8-22` (throws a clear error if the service-role var is missing) and `tests/support/test-users.ts:33-51`. All three must point at the **local Supabase CLI stack** (fixed local ports from `supabase/config.toml`: API 54321, db 54322, studio 54323, inbucket 54324), not the deployed project, since `supabase db reset` operates on local Postgres.
- `check-local-supabase.mjs:1-38` is preflight-only — it **never starts Supabase itself** (a deliberate decision, `testing-critical-path-coverage/plan.md:37`, to avoid repeatedly triggering the Colima vector-sidecar flakiness during local dev — see `lessons.md:5-9`). A CI job must explicitly run `supabase start` before this script's health check will pass.
- The Colima-specific `[analytics] enabled = false` workaround (`lessons.md:5-9`) is scoped to Colima's virtiofs/docker.sock bind-mount limitation on macOS — GitHub's `ubuntu-latest` runners have native Docker, so this specific issue likely doesn't apply, but nothing in the repo has verified `supabase start` succeeding in Actions before.

**E2e** (`npm run test:e2e` → `package.json:15`: `check-local-supabase.mjs && playwright test`)
- Same three env vars, loaded into `process.env` by `playwright.config.ts:8` via `loadEnv`, then consumed by the test harness (`service-role-client.ts`, `test-users.ts`), by `tests/e2e/support/session-cookie.ts:12-16` (derives the `sb-<project-ref>-auth-token` cookie name from `SUPABASE_URL`), and by the dev server itself (needs real Supabase creds to boot with actual auth, not the graceful-null-client dev fallback).
- No `supabase db reset` before e2e (deliberate — `testing-north-star-e2e-coverage/research.md:237-240`; e2e assumes a persistent shared fixture account).
- `playwright.config.ts:35-40`'s `webServer` block always cold-starts `npm run dev` in CI (`reuseExistingServer: !process.env.CI`), 120s timeout — no separate "start the app" step needed, but no Playwright-browser-install step exists anywhere either; must be added.
- Auth is done via direct session-cookie injection (`tests/e2e/support/auth.ts`, `session-cookie.ts`) — the real magic-link/email flow is never exercised, so no Inbucket/Mailpit/email-capture service is needed for CI. (Both Phase 1/4 plans separately flag that the real magic-link flow itself has zero test coverage at any layer — out of scope for this change.)
- `playwright.config.ts:16-18` already auto-configures `forbidOnly`/`retries: 2`/`workers: 2` when `process.env.CI` is set — Playwright's CI mode is already anticipated in the config, just never invoked by a workflow yet.
- Two pre-existing, accepted (SKIPPED) findings from `testing-north-star-e2e-coverage/reviews/impl-review.md:23-59` are worth carrying into the plan as risk, not as this change's fix scope:
  - F1 (`impl-review.md:23-35`): `group-goal-visibility.spec.ts`'s `afterEach` calls `cleanupFixtures` without `try/finally` — a transient failure leaks browser contexts and orphans DB rows.
  - F2 (`impl-review.md:37-49`): `signInContextAsNewUser` (`tests/e2e/support/auth.ts:19-44`) creates the `auth.users` row before later steps that can throw, silently orphaning that user if they do.
  - Both are more likely to surface under CI's constrained/parallel/retried conditions than in a single local run.

### Supabase-in-CI approach (open implementation choice, not yet resolved)

- `testing-critical-path-coverage/research.md:145` already frames this exact question as open: services-block (`postgres:` image) vs. full `supabase start` CLI stack. Given `test:integration`'s hard dependency on the Supabase-CLI-only `db reset` command and GoTrue's health endpoint, **a bare Postgres service container would not satisfy the existing test scripts as written** without rewriting them — this research treats "run the full CLI stack via `supabase start`" as the only option that doesn't require touching already-shipped test code, consistent with `testing-critical-path-coverage/plan.md:31`'s anticipation of `supabase/setup-cli`.
- No existing workflow anywhere in this repo has a `services:` key or attempts either approach — this must be authored from scratch.

### F-03: automated Supabase migration deploy

- `roadmap.md:98-110` (Foundation F-03 entry) is the authoritative scope statement: apply migrations to the linked production project automatically as part of the CI deploy job, alongside the existing `wrangler-action` step. Explicitly flags the same open unknown this research surfaces: **does `supabase db push --linked` need additional secrets beyond what `wrangler-action` already has, and is that resolved?** — `roadmap.md:108` assigns this to the user, not to be guessed.
- `deployment-plan.md:68-72` (Phase 1b) is the only place a Supabase link has ever happened: a human ran `npx supabase login` (stores an access token locally under `~/.config/supabase`, never in CI) then `npx supabase link --project-ref onmirtudxfjmdjwebeio` once, from a local workstation. That produced the `supabase/.temp/project-ref` / `linked-project.json` files already present on disk locally — these are untracked/local-only (not in git), so CI's checkout would not have them; CI needs its own non-interactive auth path.
- Per general Supabase CLI knowledge (not confirmed in this repo — flagged as an open question by `roadmap.md:108` itself): `supabase db push --linked` in CI would need `SUPABASE_ACCESS_TOKEN` (replacing the interactive `login` step) and either an explicit `--project-ref <ref>` flag (avoiding a link step entirely) or a fresh `supabase link` in the CI job. Whether a DB password is additionally required depends on the linked project's connection mode (pooler vs. direct) — genuinely unresolved, needs a user decision/secret-provisioning step before planning can finalize this.
- Precedent worth carrying into the plan: `deployment-plan.md`'s documented lesson that `supabase config push` overwrites the *entire* remote `[auth]` block, not just touched fields (also captured in this session's memory as `supabase-config-push-full-overwrite`) — relevant caution if F-03's step is broadened beyond `db push` (migrations only) to also touch `config push` (auth/settings).
- `deployment-plan.md:147` (Phase 6 rollback note) independently confirms the current rollback path only reverts the Worker, never `supabase/config.toml`/Auth settings/migrations — the exact gap F-03 exists to close, from the deploy-forward side rather than rollback side.

## Code References

- `.github/workflows/ci.yml:1-25` — current CI: lint + build only, no tests.
- `.github/workflows/deploy.yml:1-27` — current deploy: build + `wrangler-action` only, no Supabase step.
- `package.json:13-15` — `test`, `test:integration`, `test:e2e` script definitions.
- `vitest.config.ts:1-17` — actual (simpler than originally planned) Vitest config.
- `playwright.config.ts:1-41` — `webServer` auto-start, CI-conditional retries/workers, `setup`→`chromium` project dependency.
- `scripts/check-local-supabase.mjs:1-38` — GoTrue-health preflight check; never starts Supabase.
- `tests/support/service-role-client.ts:8-22` — `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` reads, throws if missing.
- `tests/support/test-users.ts:33-51` — `SUPABASE_URL`/`SUPABASE_KEY` reads for throwaway password-auth test users.
- `tests/e2e/support/session-cookie.ts:12-16` — derives auth cookie name from `SUPABASE_URL`.
- `.env.example:1-6` — all Supabase test/app env vars documented (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, plus unrelated `BREVO_*`).
- `supabase/config.toml:1-10,150-160` — `project_id`, local ports, `site_url` pointed at the deployed Worker.
- `wrangler.jsonc:1-15` — Worker config (no Supabase-related bindings).

## Architecture Insights

- The project deliberately keeps `SUPABASE_SERVICE_ROLE_KEY` out of Astro's `env.schema`/`astro:env/server` system — it's a test-harness-only credential, read as a plain env var, never validated or exposed through the app's own config layer. Any CI wiring must supply it as a bare env var / GitHub secret, not by extending `astro.config.mjs`.
- Test scripts (`test`, `test:integration`, `test:e2e`) are deliberately layered by cost: unit has zero external deps, integration requires local Supabase + a DB reset (full isolation per run), e2e requires local Supabase + a live dev server but no DB reset (persistent fixture-account model). CI wiring should preserve this layering rather than collapsing all three into one job/step.
- `check-local-supabase.mjs`'s design (preflight-check-only, never auto-start) reflects a considered decision to keep "start Supabase" as an explicit, visible step a human (or CI job) controls — consistent with the project's stated aversion to hidden/implicit side effects around Supabase state.

## Historical Context (from prior changes)

- `context/changes/testing-critical-path-coverage/plan.md` and `research.md` (Phase 1, `complete`) — shipped the unit + integration suites and explicitly named this change (quality-gates-wiring / Phase 5) as the consumer that will wrap them in CI, anticipating `supabase/setup-cli`; left the CLI-vs-services-block choice open.
- `context/changes/testing-north-star-e2e-coverage/plan.md`, `research.md`, `reviews/impl-review.md` (Phase 4, `complete`) — shipped the north-star e2e spec, explicitly deferred CI wiring to "Phase 5, a separate change" (i.e., this one), and left two cleanup-robustness findings accepted/SKIPPED.
- `context/changes/deployment/deployment-plan.md` (`deployment`, done through Phase 6 per memory) — origin of the current `wrangler-action`-only deploy pipeline, the one-time manual Supabase link, and the `config push`-overwrites-`[auth]`-block lesson; Phase 6's rollback note independently confirms the migration-deploy gap F-03 addresses.
- `context/foundation/roadmap.md:98-110` — F-03's canonical scope statement and its own flagged unknown about CI secrets, still open.
- `context/foundation/lessons.md:5-9` — Colima-specific `supabase start` workaround; scoped to local macOS/Colima, likely not applicable to `ubuntu-latest` but unverified either way in this repo.

## Related Research

- `context/changes/testing-critical-path-coverage/research.md`
- `context/changes/testing-north-star-e2e-coverage/research.md`

## Open Questions

1. **CLI-vs-services-block for Supabase in CI** (already flagged by Phase 1's own research, never resolved): run the full `supabase start` CLI stack (via `supabase/setup-cli` + `supabase start`), or rewrite test scripts against a bare `postgres:` service container? Given `db reset`'s CLI dependency and the GoTrue health check, the CLI-stack approach is the only one that doesn't require touching already-shipped test code — but it's unverified in GitHub Actions specifically.
2. **F-03 secrets**: does `supabase db push --linked` in CI need `SUPABASE_ACCESS_TOKEN` only, or also a DB password / explicit `--project-ref`? This is a provisioning decision for the user, not inferable from the repo — `roadmap.md:108` already flags it as unresolved.
3. **Playwright browser install strategy in CI**: `playwright install --with-deps` (full OS deps) vs. a lighter cached install — no precedent in this repo to draw from.
4. **Job topology**: one CI job running lint→build→unit→integration→e2e sequentially, or split into parallel jobs (e.g., unit+lint in one, integration in another with its own Supabase service, e2e in a third)? Affects total CI wall-clock time and failure isolation; a planning-stage decision, not something research should preempt.
5. **Whether to address the two accepted e2e cleanup gaps (F1/F2 from `impl-review.md`) as part of this change** — they're pre-existing/accepted in the shipped test code, but CI's constrained/parallel/retried environment is more likely to trigger them than local dev ever has. Worth a call from `/10x-plan` on whether to fix, monitor, or explicitly accept the residual risk.
