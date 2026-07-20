---
change: cloudflare-first-deployment
status: in-progress
created: 2026-07-20
project: Resolution Circle
depends_on: context/foundation/infrastructure.md
---

# Cloudflare Workers — First Deployment Plan (Resolution Circle)

## Context

`context/foundation/infrastructure.md` already picked Cloudflare Workers (+ Resend for email) as the MVP platform, and the repo (`@astrojs/cloudflare` v13, `wrangler.jsonc`) is already wired for Workers, not Pages. But nothing has actually been deployed yet: `wrangler`/`gh` aren't authenticated locally, no cloud Supabase project exists, no domain exists for Resend, and the app itself currently only has the auth scaffold (signup/signin/confirm-email/dashboard/signout) — no goals/groups/digest features exist in code yet.

This plan covers **getting the current auth-only app safely live on Cloudflare Workers now**, with Resend + the quarterly-digest Cron/Queue wiring explicitly **deferred** to a follow-up phase (no domain yet, and no digest logic to trigger regardless). It also fixes two pre-existing repo bugs discovered during research: the CI workflow's branch mismatch (`master` vs. the actual `main`), and the leftover `10x-astro-starter` Worker name.

Steps are grouped into phases with checkboxes. Each step is tagged **[Agent]** (run/editable by the agent), **[Human]** (needs a browser/dashboard/CLI login action), or **[Agent, needs your value]** (agent runs the command, human supplies a secret out of band rather than pasting it into chat).

This file is the canonical, git-tracked, checkbox-driven progress tracker for this deployment (supersedes `CLAUDE.md`'s default `context/deployment/deploy-plan.md` path — relocated per project owner's instruction). Checkboxes are ticked here as each step completes. Phase 6 finalizes it with the deployment summary once live.

---

## Phase 0 — Repo fixes (no external dependencies, run first/parallel) ✅ done

- [x] **[Agent]** Rename the Worker in `wrangler.jsonc` from the leftover `"10x-astro-starter"` to the real project name (e.g. `"resolution-circle"`). Must happen **before** the first `wrangler deploy` — renaming afterward changes the live `*.workers.dev` URL.
- [x] **[Agent]** Fix `.github/workflows/ci.yml`: change `branches: [master]` → `branches: [main]` on both `push` and `pull_request` triggers. CI has never actually run because of this mismatch.
- [x] **[Agent]** Verify `wrangler.jsonc`'s `compatibility_flags` still contains both `nodejs_compat` and `disable_nodejs_process_v2` (already present — this is the fix for the known astro#15434 `[object Object]` SSR bug). No change expected, just a pre-flight check.

## Phase 1 — External accounts + CLI configuration (can run in parallel with Phase 0)

### 1a. Authenticate the CLIs

- [ ] **[Human]** Create a Cloudflare account if you don't already have one (dash.cloudflare.com).
- [ ] **[Agent runs, human completes browser step]** `npx wrangler login` — opens a browser OAuth flow; you approve it. Verify with `npx wrangler whoami`.
- [ ] **[Human]** `gh auth login` — interactive; pick GitHub.com → HTTPS → browser login. Needed for Phase 5's `gh secret set` / `gh variable set`. Verify with `gh auth status`.
- [ ] **[Agent runs, human completes browser step]** `npx supabase login` — opens a browser flow, stores an access token under `~/.config/supabase` (or platform equivalent). Do this even if you plan to create the project via the dashboard — the CLI needs it for `config push` in Phase 2.

### 1b. Create the cloud Supabase project (CLI-first, dashboard fallback)

- [ ] **[Agent runs, human supplies choices]** `npx supabase orgs list` to find your `org-id`, then `npx supabase projects create resolution-circle --org-id <org-id> --region <closest-region> --db-password <a-strong-password-you-choose>`. (Dashboard alternative: supabase.com → New Project — functionally identical, just more clicks.)
- [ ] **[Agent runs]** `npx supabase link --project-ref <ref>` from the repo root — links this local repo to the new project so `config push` (Phase 2) and future `db push` migrations target it. `<ref>` is printed by the `projects create` output, or via `npx supabase projects list`.
- [ ] **[Agent runs, human copies value]** `npx supabase projects api-keys --project-ref <ref>` prints the **Project URL** (`https://<ref>.supabase.co`) and the `anon` public key. Don't paste the actual key into chat — the human runs the `wrangler secret put` command themselves in Phase 3, or supplies it via a local env var the agent reads.

### Edge case: no domain yet for Resend
Resend needs a verified sending domain to email *arbitrary* recipients — without one it can only send test emails to your own account address. Since no domain exists yet, this deploy uses **Supabase's built-in default email service** instead (works with zero setup, no domain required). Caveat: it's rate-limited to **~2 emails/hour** and is explicitly documented by Supabase as best-effort/non-production only — fine for solo smoke-testing and a small early user base, not a long-term production answer. See Phase 7 for the follow-up.

## Phase 2 — Supabase Auth production configuration

This is the step most likely to be silently skipped and cause confusing failures, so treat every box here as required, not optional. CLI-first (via the `config push` mechanism confirmed to sync `[auth]` settings to a linked remote project), with the dashboard as a fallback if you'd rather click through it:

- [ ] **[Agent edits, human confirms the URL]** In `supabase/config.toml`, set `[auth] site_url = "https://<your-worker-url>"` and `additional_redirect_urls = ["https://<your-worker-url>"]` (the actual `*.workers.dev` URL is only known after Phase 4's first deploy — see sequencing note below). A fresh cloud project defaults `site_url` to `http://127.0.0.1:3000` — since `signup.ts` calls `supabase.auth.signUp()` with no explicit `emailRedirectTo`, confirmation links will point at localhost and 404 for real users if this is skipped.
- [ ] **[Agent runs]** `npx supabase config push` to apply `config.toml` to the linked remote project. Caveat confirmed from Supabase's own CLI issue tracker: `config push` **overwrites** the remote URL config to exactly match `config.toml` — if a staging/preview URL is later added by hand in the dashboard, it'll be silently reverted on the next `config push`. Keep `config.toml` as the single source of truth going forward.
  - Dashboard fallback: Authentication → URL Configuration → set Site URL + add to Redirect URLs manually.
- [ ] **[Human, optional for first smoke test]** To smoke-test signup/signin without waiting on any email at all, Authentication → Email → toggle **Confirm email** off temporarily (the README already documents this for local dev; same toggle applies to the cloud project). Turn it back on before inviting real users.

**Sequencing note:** this phase needs the live Worker URL, which only exists after Phase 4's first `wrangler deploy`. Practical order: do Phase 4's deploy once first with a placeholder/localhost Site URL (auth will be broken, but the deploy itself + non-auth pages can be smoke-tested), then immediately loop back and run Phase 2 with the real URL, then re-verify the full auth flow.

## Phase 3 — Production secrets

- [ ] **[Agent, human supplies values]** `npx wrangler secret put SUPABASE_URL` then `npx wrangler secret put SUPABASE_KEY` — each prompts interactively for the value; the human pastes the real project URL/anon key when prompted (not stored in shell history or chat).

## Phase 4 — First deploy + verification

- [ ] **[Agent]** `npm run build && npx wrangler deploy`
- [ ] **[Agent]** Smoke-test the live `*.workers.dev` URL end-to-end: signup → confirm-email page → (real email or confirm-email-off) → signin → `/dashboard` shows the signed-in user → signout.
  - Explicitly check for `[object Object]` on any SSR page (the astro#15434 regression) — should be clean given the flags in Phase 0, but this is the actual proof, not build success.
  - Confirm `SUPABASE_URL`/`SUPABASE_KEY` resolve at **runtime** in production, not just at build time — `.dev.vars` behavior locally is not a guarantee that `wrangler secret put` values are wired the same way.
  - Confirm cookies set by `@supabase/ssr` work correctly on the `*.workers.dev` origin (it's on the Public Suffix List; host-only cookies — the current code path — are fine, just verify rather than assume).
- [ ] **[Agent]** `npx wrangler tail` briefly while smoke-testing to confirm no runtime errors.

## Phase 5 — GitHub Actions auto-deploy

- [ ] **[Human]** Create a scoped Cloudflare API token (dash.cloudflare.com → My Profile → API Tokens → "Edit Cloudflare Workers" template, scoped to this one account, no DNS/billing). Note: Cloudflare has no permission granular enough to allow `wrangler deploy` while forbidding `wrangler secret put` — both fall under the same "Workers Scripts:Edit" permission. So secret rotation being human-only (per `infrastructure.md`'s stated posture) is a **procedural rule for this repo's workflows**, not something token scoping enforces — the new `deploy.yml` below must never call `wrangler secret put`.
- [ ] **[Human]** Add repo secret `CLOUDFLARE_API_TOKEN` (Settings → Secrets and variables → Actions) — either via GitHub web UI or `gh secret set CLOUDFLARE_API_TOKEN` once `gh auth login` is done.
- [ ] **[Human]** Add repo **variable** (not secret — not sensitive) `CLOUDFLARE_ACCOUNT_ID`, found via `wrangler whoami` or the Cloudflare dashboard sidebar.
- [ ] **[Agent]** Add `.github/workflows/deploy.yml`: triggers on push to `main`, runs `npm ci`, `npx astro sync`, `npm run build` (mirroring `ci.yml`'s existing env-var pattern for `SUPABASE_URL`/`SUPABASE_KEY`), then deploys via `cloudflare/wrangler-action@v3` with `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}` and `accountId: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}`. Pin `wranglerVersion` to match the installed `wrangler@^4.90.0` to avoid CI/local drift.
- [ ] **[Agent]** Push a trivial change (or the fixes from this plan) to confirm the workflow fires and deploys successfully.

## Phase 6 — Finalize the deploy artifact

- [ ] **[Agent]** Update this file with a closing summary: what got deployed, the live URL, which secrets are wired (`SUPABASE_URL`, `SUPABASE_KEY`), that Resend/digest are explicitly deferred (Phase 7), and the rollback command (`npx wrangler deployments list` → `npx wrangler rollback [version-id]`). Flip the frontmatter `status` to `deployed`.

## Phase 7 — Deferred follow-up (not built now — tracked for later)

No paid domain required — pick one of two genuinely free paths when ready to move off Supabase's built-in email:

- [ ] **Option A — Stay on Supabase's built-in email indefinitely.** Zero extra setup, zero cost. The ~2 emails/hour cap is a real limit for a high-volume product, but for a personal/friend-group goal tracker it may simply never be hit. Revisit only if it's outgrown, or deliverability control Supabase's shared service doesn't give is needed.
- [ ] **Option B — Get a free subdomain via [is-a.dev](https://is-a.dev)** (e.g. `resolution-circle.is-a.dev`), a free GitHub-PR-based subdomain registry for dev projects. Confirmed requirements and mechanics (from their docs, current as of this research):
  - **Eligibility (checked before starting):** the linked site must already be live and "somewhat complete," and be either a personal site or a **non-commercial, software-development-related project** — a personal goals-tracker app for a friend group fits. Do this step **after** Phase 4's first deploy, not before — a live URL is needed to link and a screenshot to attach to the PR.
  - **Registration mechanics:** fork `github.com/is-a-dev/register`; each subdomain (root + each Resend-required record host) is its **own JSON file** under `domains/`, named after the subdomain (dots for nested labels, e.g. `send.resolution-circle.json`; underscore labels like `resend._domainkey.resolution-circle.json` are explicitly valid). One PR can add multiple files together:
    - `domains/resolution-circle.json` → `{"owner": {"username": "<gh-username>", "email": "<email>"}, "records": {"CNAME": "<worker>.<subdomain>.workers.dev"}, "proxied": true}`
    - `domains/send.resolution-circle.json` and `domains/resend._domainkey.resolution-circle.json` → filled in with the **exact** MX/TXT values Resend's dashboard gives once the domain is added there (don't invent these — copy them verbatim from Resend).
    - Optionally `domains/_dmarc.resolution-circle.json` with a `TXT` DMARC policy.
  - **[Human]** Open the PR personally following their template exactly, with a link + screenshot of the live site in the description — is-a.dev explicitly reserves the right to close PRs that look AI-generated or incomplete, so this is a step to own directly even if the JSON file contents are agent-drafted. Review isn't instant (can take hours); DNS goes live within minutes of merge.
  - (`eu.org` is a similar free-domain alternative with a slower manual-review process; only worth it if is-a.dev's dev-project restriction is a blocker.)
  - [ ] Once merged, verify the domain in Resend's dashboard (it re-checks these exact DNS records).
  - [ ] In Supabase dashboard, flip **Enable Custom SMTP** on (a separate toggle from domain verification) and enter Resend's SMTP host/port + API key, replacing the interim built-in email service.
- [ ] Once goals/groups/progress data models exist: design the quarterly digest as a Cron Trigger (`triggers.crons` in `wrangler.jsonc`) fanning out to a Cloudflare Queue consumer that sends via the Resend HTTP API (not SMTP — unusable inside workerd), gated by a per-quarter idempotency row in Supabase. Watch Resend's free-tier 100 emails/day cap if the user base grows.

---

## Critical files

- `wrangler.jsonc` — Worker name fix (Phase 0), already has the SSR compatibility flags.
- `.github/workflows/ci.yml` — branch trigger fix (Phase 0).
- `.github/workflows/deploy.yml` — new file (Phase 5).
- `supabase/config.toml` — `[auth]` Site URL / redirect URLs (Phase 2).
- `src/lib/supabase.ts`, `src/pages/api/auth/signup.ts` — no code changes needed, but this is what Phase 2/4 verify against.

## Verification

- End-to-end smoke test on the live Worker URL (Phase 4) is the real verification — not just `npm run build` succeeding locally.
- `npx wrangler tail` during the smoke test to catch runtime-only errors (e.g. secrets not resolving, cookie issues).
- After Phase 5, confirm the Actions tab shows a green run on push to `main`, and that the deployed version matches (`npx wrangler deployments list`).
