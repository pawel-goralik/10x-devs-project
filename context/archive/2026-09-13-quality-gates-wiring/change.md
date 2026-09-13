---
change_id: quality-gates-wiring
title: Wire Phases 1 & 4 test suites into CI and land F-03 migration-deploy automation
status: archived
created: 2026-09-13
updated: 2026-09-13
archived_at: 2026-09-13T18:20:57Z
---

## Notes

Test-plan §3 Phase 5 ("Quality-gates wiring"). Scope for this change is
deliberately narrower than the phase's full description:

- Wire the unit suite (`npm run test`), the integration suite
  (`npm run test:integration`), and the Phase 4 north-star e2e test
  (`npm run test:e2e`) into `.github/workflows/ci.yml`. CI currently only
  runs lint + build — no test step exists yet.
- Land the F-03 migration-deploy automation: `deploy.yml` currently only
  runs `wrangler deploy`, with no `supabase db push --linked` step, which is
  the root cause behind risk #3 (local-vs-prod schema/config drift).
- Phases 2 (`side-effect ordering & latent bundle-endpoint check`) and 3
  (`abuse-surface hardening`) are explicitly deferred — both `not started`
  in test-plan.md. They will only add more files under `tests/integration/`,
  and `npm run test:integration` already globs that whole directory
  (`vitest run tests/integration`), so no CI changes are expected to be
  needed for them later.

Known unknowns going into research: CI has no Supabase instance today (only
a local-dev reachability check via `scripts/check-local-supabase.mjs`), so
integration/e2e tests need some way to get a Supabase instance in the CI
job. F-03 will need production Supabase secrets (project ref, access token,
db password) that may not be provisioned yet as repo secrets.
