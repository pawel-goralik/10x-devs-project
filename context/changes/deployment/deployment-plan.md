---
change: cloudflare-first-deployment
status: in-progress
created: 2026-07-20
project: Resolution Circle
depends_on: context/foundation/infrastructure.md
---

# Cloudflare Workers — First Deployment Plan (Resolution Circle)

## Context

`context/foundation/infrastructure.md` already picked Cloudflare Workers (+ Brevo for email) as the MVP platform, and the repo (`@astrojs/cloudflare` v13, `wrangler.jsonc`) is already wired for Workers, not Pages. But nothing has actually been deployed yet: `wrangler`/`gh` aren't authenticated locally, no cloud Supabase project exists, and the app itself currently only has the auth scaffold (signup/signin/confirm-email/dashboard/signout) — no goals/groups/digest features exist in code yet. Brevo requires no sending domain (single sender email verification is enough), so real magic-link email can be wired from the start — no domain-acquisition workaround needed.

This plan covers **getting the current auth-only app safely live on Cloudflare Workers now**, with real magic-link email wired through Brevo from the start. Only the quarterly-digest Cron wiring is explicitly **deferred** to a follow-up phase, since no goals/groups/digest logic exists in code yet. It also fixes two pre-existing repo bugs discovered during research: the CI workflow's branch mismatch (`master` vs. the actual `main`), and the leftover `10x-astro-starter` Worker name.

Steps are grouped into phases with checkboxes. Each step is tagged **[Agent]** (run/editable by the agent), **[Human]** (needs a browser/dashboard/CLI login action), or **[Agent, needs your value]** (agent runs the command, human supplies a secret out of band rather than pasting it into chat).

This file is the canonical, git-tracked, checkbox-driven progress tracker for this deployment (supersedes `CLAUDE.md`'s default `context/deployment/deploy-plan.md` path — relocated per project owner's instruction). Checkboxes are ticked here as each step completes. Phase 6 finalizes it with the deployment summary once live.

---

## Prerequisites — accounts to create and values to have on hand

Do this section before starting Phase 1. It's account creation + gathering values only — no repo changes happen here.

### Accounts to create (all free tier is enough for MVP)

| Account | URL | Needed for | Notes |
| --- | --- | --- | --- |
| Cloudflare | dash.cloudflare.com | Phases 1a, 2, 3, 5 | Email/password or GitHub SSO. No credit card required for Workers free tier. |
| GitHub | github.com (you likely already have one — the repo lives there) | Phase 1a, 5 | Needed so `gh` can manage repo secrets/variables. |
| Supabase | supabase.com | Phases 1b, 2, 4 | Sign in with GitHub is the fastest path and matches how the repo is already hosted. |
| Brevo | brevo.com | Phases 1c, 4 | Free plan: 300 emails/day, no sending domain required for MVP volume. |

### Values to have ready before you start (or generate as you go)

- **A database password for the new Supabase project** — pick a strong password now; you'll pass it to `supabase projects create --db-password <...>` in Phase 1b. Store it in a password manager — it's the Postgres superuser password, not something the CLI will show again.
- **A region choice for the Supabase project** — pick whichever `supabase projects create --region` value is geographically closest to your users (e.g. `eu-central-1` for Central Europe). Affects latency, not correctness.
- **A sender email address you control** — used in Brevo's single-sender verification (Phase 1c); Brevo emails a 6-digit code to it, so it must be an inbox you can check during setup.

### What each Human step in Phases 1–5 actually requires you to click

- **Phase 1a — `gh auth login`**: run this yourself in a terminal (it's interactive — arrow-key menus don't work well when the agent drives it). Choose `GitHub.com` → `HTTPS` → `Login with a web browser`, then paste the one-time code into the browser tab it opens.
- **Phase 1b — Supabase project creation**: if you'd rather not hand the agent your `--db-password` on the command line, use the dashboard fallback (supabase.com → New Project) and give the agent the resulting `--project-ref` so it can run `supabase link` for you.
- **Phase 1c — Brevo sender verification**: Senders, Domains & Dedicated IPs → Senders → Add a sender → enter the email from above → check that inbox for the 6-digit code → enter it back in Brevo.
- **Phase 1c — Brevo SMTP key**: Settings (top-right gear icon) → SMTP & API → SMTP tab → copy the key shown (or generate a new one). This is what goes into Supabase's Custom SMTP password field in Phase 4 — not the same as the REST API key used later in Phase 7.
- **Phase 4 — Supabase SMTP settings**: Supabase dashboard → your project → Authentication → Emails → SMTP Settings → toggle **Enable Custom SMTP** on, then fill host/port/user/password as the plan specifies.
- **Phase 2 — secrets**: when `wrangler secret put SUPABASE_URL`/`SUPABASE_KEY` prompts, paste the value and press enter — it's not echoed and isn't stored in shell history.
- **Phase 5 — Cloudflare API token**: dash.cloudflare.com → click your profile icon (top-right) → My Profile → API Tokens → Create Token → start from the "Edit Cloudflare Workers" template → scope it to this one account and (if offered) this one Worker → skip DNS/billing permissions → Continue to summary → Create Token → copy it once (Cloudflare won't show it again).
- **Phase 5 — GitHub repo secret/variable**: Settings tab of the GitHub repo → Secrets and variables → Actions → New repository secret for `CLOUDFLARE_API_TOKEN`, New repository variable for `CLOUDFLARE_ACCOUNT_ID`. (Or let the agent run `gh secret set` / `gh variable set` once `gh auth login` is done — same effect, fewer clicks.)

## Phase 0 — Repo fixes (no external dependencies, run first/parallel) ✅ done

- [x] **[Agent]** Rename the Worker in `wrangler.jsonc` from the leftover `"10x-astro-starter"` to the real project name (e.g. `"resolution-circle"`). Must happen **before** the first `wrangler deploy` — renaming afterward changes the live `*.workers.dev` URL.
- [x] **[Agent]** Fix `.github/workflows/ci.yml`: change `branches: [master]` → `branches: [main]` on both `push` and `pull_request` triggers. CI has never actually run because of this mismatch.
- [x] **[Agent]** Verify `wrangler.jsonc`'s `compatibility_flags` still contains both `nodejs_compat` and `disable_nodejs_process_v2` (already present — this is the fix for the known astro#15434 `[object Object]` SSR bug). No change expected, just a pre-flight check.

## Phase 1 — External accounts + CLI configuration (can run in parallel with Phase 0)

### 1a. Authenticate the CLIs

- [x] **[Human]** Create a Cloudflare account if you don't already have one (dash.cloudflare.com). Done — account `pawel.goralik@gmail.com`, account ID `77a333f5244f51709ec35393fac1c9b5`.
- [x] **[Agent runs, human completes browser step]** `npx wrangler login` — opens a browser OAuth flow; you approve it. Verify with `npx wrangler whoami`. Done, verified.
- [x] **[Human]** `gh auth login` — interactive; pick GitHub.com → HTTPS → browser login. Needed for Phase 5's `gh secret set` / `gh variable set`. Verify with `gh auth status`. Done — logged in as `pawel-goralik`, HTTPS protocol, verified via `gh auth status`.
- [x] **[Agent runs, human completes browser step]** `npx supabase login` — opens a browser flow, stores an access token under `~/.config/supabase` (or platform equivalent). Do this even if you plan to create the project via the dashboard — the CLI needs it for `config push` in Phase 4. Done — required a real terminal (this sandbox's non-TTY shell couldn't drive the OAuth flow), verified via `supabase projects list`.

### 1b. Create the cloud Supabase project (CLI-first, dashboard fallback) ✅ done

- [x] **[Agent runs, human supplies choices]** `npx supabase orgs list` to find your `org-id`, then `npx supabase projects create resolution-circle --org-id <org-id> --region <closest-region> --db-password <a-strong-password-you-choose>`. (Dashboard alternative: supabase.com → New Project — functionally identical, just more clicks.) Done via **dashboard fallback**, not CLI — project `resolution-circle`, ref `onmirtudxfjmdjwebeio`, org `kdhfzvblzgjhzdgupxlx` (`pawel.goralik@gmail.com's Org`), region `eu-central-1`. DB password chosen and stored by the human, not shared with the agent.
- [x] **[Agent runs]** `npx supabase link --project-ref <ref>` from the repo root — links this local repo to the new project so `config push` (Phase 4) and future `db push` migrations target it. `<ref>` is printed by the `projects create` output, or via `npx supabase projects list`. Done — linked to `onmirtudxfjmdjwebeio`.
- [x] **[Agent runs, human copies value]** `npx supabase projects api-keys --project-ref <ref>` prints the **Project URL** (`https://<ref>.supabase.co`) and the `anon` public key. Don't paste the actual key into chat — the human runs the `wrangler secret put` command themselves in Phase 2, or supplies it via a local env var the agent reads. Done — **Project URL**: `https://onmirtudxfjmdjwebeio.supabase.co`; key to use for `SUPABASE_KEY` in Phase 2: the `sb_publishable_...` key (confirmed compatible with `createServerClient` in `src/lib/supabase.ts`). ⚠️ This command's output also printed the legacy `service_role` key into the chat transcript — more than intended; consider rotating it from the dashboard (Settings → API) if that exposure is a concern. Actual key values are not recorded in this file.

### 1c. Set up Brevo (no domain required) ✅ done

- [x] **[Human]** Create a free Brevo account (brevo.com) if you don't already have one.
- [x] **[Human]** In the Brevo dashboard, verify a single sender email address (Senders, Domains & Dedicated IPs → Senders → Add a sender → 6-digit code, no DNS needed).
- [x] **[Human]** Grab an SMTP key (Settings → SMTP & API → SMTP tab) for Phase 4's Supabase Auth SMTP config. The separate REST API key (same page, API Keys tab) is only needed once the digest feature is built (Phase 7) — no need to generate it yet. Key generated and held by the human, ready to enter into Supabase's SMTP config in Phase 4.

Note from `infrastructure.md`'s risk register: without an authenticated domain, Brevo substitutes the visible sender address as a deliverability workaround — cosmetic only, doesn't block sending.

## Phase 2 — Production secrets ✅ done

- [x] **[Agent, human supplies values]** `npx wrangler secret put SUPABASE_URL` then `npx wrangler secret put SUPABASE_KEY` — each prompts interactively for the value; the human pastes the real project URL/anon key when prompted (not stored in shell history or chat). Done — human ran both interactively, verified via `npx wrangler secret list` (`SUPABASE_KEY`, `SUPABASE_URL` both present as `secret_text`).

## Phase 3 — First deploy + verification

Split into two passes because the live `*.workers.dev` URL (needed by Phase 4) only exists after the first deploy, but full auth verification only makes sense after Phase 4 points Supabase at that real URL. Reordered from the original plan so the dependency runs in one direction only, no looping back.

### 3a. Initial deploy (auth expected incomplete) ✅ done

- [x] **[Agent]** `npm run build && npx wrangler deploy` — note the resulting `*.workers.dev` URL; it's the input to Phase 4. Done — live at **https://resolution-circle.pawel-goralik.workers.dev**, version ID `af2e5648-afce-4d89-89f7-8dbfdbd20275`. A `SESSION` KV namespace was auto-provisioned on first deploy (referenced by `wrangler.jsonc`'s `env.SESSION` binding).
- [x] **[Agent]** Baseline smoke test: confirm the app loads, and explicitly check for `[object Object]` on any SSR page (the astro#15434 regression — should be clean given the flags in Phase 0, but this is the actual proof, not build success). Confirm `SUPABASE_URL`/`SUPABASE_KEY` resolve at **runtime** in production, not just at build time — `.dev.vars` behavior locally is not a guarantee that `wrangler secret put` values are wired the same way. Done — `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email` all HTTP 200 with clean HTML (no `[object Object]`); `/dashboard` correctly 302-redirects to `/auth/signin` for an unauthenticated request, confirming the middleware/Supabase client initializes without error at runtime.
- [x] **[Agent]** `npx wrangler tail` briefly to confirm no runtime errors on pages that don't depend on auth redirects. Done — all requests logged `Ok`, no exceptions.
- Full auth (signup/confirm/signin) is **expected to misbehave** at this point — Supabase's Site URL still points at `http://127.0.0.1:3000` until Phase 4 runs. Not a bug, just not tested yet.

### 3b. Full auth verification (run after Phase 4)

- [ ] **[Agent]** Smoke-test the live `*.workers.dev` URL end-to-end now that Phase 4 has pointed Supabase at the real URL: signup → confirm-email page → confirmation email arrives via Brevo (check spam folder the first time; sender address may be substituted per the no-domain-auth caveat) → signin → `/dashboard` shows the signed-in user → signout.
- [ ] **[Agent]** Confirm cookies set by `@supabase/ssr` work correctly on the `*.workers.dev` origin (it's on the Public Suffix List; host-only cookies — the current code path — are fine, just verify rather than assume).
- [ ] **[Agent]** `npx wrangler tail` again during this pass to catch any auth-specific runtime errors.

## Phase 4 — Supabase Auth production configuration

This is the step most likely to be silently skipped and cause confusing failures, so treat every box here as required, not optional. Runs after Phase 3a since it needs the live Worker URL. CLI-first (via the `config push` mechanism confirmed to sync `[auth]` settings to a linked remote project), with the dashboard as a fallback if you'd rather click through it:

- [ ] **[Agent edits, human confirms the URL]** In `supabase/config.toml`, set `[auth] site_url = "https://<your-worker-url>"` and `additional_redirect_urls = ["https://<your-worker-url>"]`, using the URL captured in Phase 3a. A fresh cloud project defaults `site_url` to `http://127.0.0.1:3000` — since `signup.ts` calls `supabase.auth.signUp()` with no explicit `emailRedirectTo`, confirmation links will point at localhost and 404 for real users if this is skipped.
- [ ] **[Agent runs]** `npx supabase config push` to apply `config.toml` to the linked remote project. Caveat confirmed from Supabase's own CLI issue tracker: `config push` **overwrites** the remote URL config to exactly match `config.toml` — if a staging/preview URL is later added by hand in the dashboard, it'll be silently reverted on the next `config push`. Keep `config.toml` as the single source of truth going forward.
  - Dashboard fallback: Authentication → URL Configuration → set Site URL + add to Redirect URLs manually.
- [ ] **[Human]** In the Supabase dashboard, Authentication → Emails → SMTP Settings: enable **Custom SMTP**, host `smtp-relay.brevo.com`, port `587`, user = your Brevo account email, password = the Brevo SMTP key from Phase 1c. This makes Supabase send real magic-link/confirmation emails through Brevo instead of its rate-limited (~2/hour) built-in service.
- [ ] **[Human, optional for faster iteration]** To smoke-test signup/signin without waiting on any email at all, Authentication → Email → toggle **Confirm email** off temporarily (the README already documents this for local dev; same toggle applies to the cloud project). Now that Brevo is wired, this is optional — only useful to skip waiting on email during rapid testing. Turn it back on (if used) before inviting real users.
- Once this phase is done, go back and run Phase 3b to verify the full auth flow end-to-end.

## Phase 5 — GitHub Actions auto-deploy

- [ ] **[Human]** Create a scoped Cloudflare API token (dash.cloudflare.com → My Profile → API Tokens → "Edit Cloudflare Workers" template, scoped to this one account, no DNS/billing). Note: Cloudflare has no permission granular enough to allow `wrangler deploy` while forbidding `wrangler secret put` — both fall under the same "Workers Scripts:Edit" permission. So secret rotation being human-only (per `infrastructure.md`'s stated posture) is a **procedural rule for this repo's workflows**, not something token scoping enforces — the new `deploy.yml` below must never call `wrangler secret put`.
- [ ] **[Human]** Add repo secret `CLOUDFLARE_API_TOKEN` (Settings → Secrets and variables → Actions) — either via GitHub web UI or `gh secret set CLOUDFLARE_API_TOKEN` once `gh auth login` is done.
- [ ] **[Human]** Add repo **variable** (not secret — not sensitive) `CLOUDFLARE_ACCOUNT_ID`, found via `wrangler whoami` or the Cloudflare dashboard sidebar.
- [ ] **[Agent]** Add `.github/workflows/deploy.yml`: triggers on push to `main`, runs `npm ci`, `npx astro sync`, `npm run build` (mirroring `ci.yml`'s existing env-var pattern for `SUPABASE_URL`/`SUPABASE_KEY`), then deploys via `cloudflare/wrangler-action@v3` with `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}` and `accountId: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}`. Pin `wranglerVersion` to match the installed `wrangler@^4.90.0` to avoid CI/local drift.
- [ ] **[Agent]** Push a trivial change (or the fixes from this plan) to confirm the workflow fires and deploys successfully.

## Phase 6 — Finalize the deploy artifact

- [ ] **[Agent]** Update this file with a closing summary: what got deployed, the live URL, which Worker secrets are wired (`SUPABASE_URL`, `SUPABASE_KEY`), that Brevo SMTP is configured in Supabase for magic-link email (not a Worker secret), that the digest feature (and its `BREVO_API_KEY` Worker secret) is explicitly deferred (Phase 7), and the rollback command (`npx wrangler deployments list` → `npx wrangler rollback [version-id]`). Flip the frontmatter `status` to `deployed`.

## Phase 7 — Deferred follow-up (digest feature, not built now — tracked for later)

Magic-link email is already production-ready via Brevo (Phase 1c/4) — no domain-acquisition workaround needed. What's left is purely the quarterly-digest feature, which depends on goals/groups/progress data models that don't exist yet:

- [ ] **[Agent, human supplies value]** Once digest logic is being built, generate a Brevo REST API key (Settings → SMTP & API → API Keys tab) and store it as a Worker secret: `npx wrangler secret put BREVO_API_KEY`.
- [ ] **[Agent]** Wire the quarterly digest as a Cron Trigger (`triggers.crons` in `wrangler.jsonc`) with a single synchronous `scheduled` handler that queries active members from Supabase and sends each email directly via Brevo's REST API (`POST https://api.brevo.com/v3/smtp/email`) using `fetch` — no Cloudflare Queues needed at the current group size (<45 recipients), well under the free plan's 50-external-subrequest-per-invocation cap. Gate the send on a per-quarter idempotency row in Supabase, and expose a protected manual re-fire route in case a transient error kills the invocation partway through (no automatic retry without Queues).
- [ ] Add Cloudflare Queues only once recipient count approaches ~45 (the free-tier subrequest ceiling, not the CPU limit — see `infrastructure.md`'s Unknown Unknowns).
- [ ] Watch Brevo's free-tier **300 emails/day** cap if the user base grows; Resend remains a documented fallback (see `infrastructure.md`'s risk register).

---

## Critical files

- `wrangler.jsonc` — Worker name fix (Phase 0), already has the SSR compatibility flags.
- `.github/workflows/ci.yml` — branch trigger fix (Phase 0).
- `.github/workflows/deploy.yml` — new file (Phase 5).
- `supabase/config.toml` — `[auth]` Site URL / redirect URLs (Phase 4).
- `src/lib/supabase.ts`, `src/pages/api/auth/signup.ts` — no code changes needed, but this is what Phase 3/4 verify against.

## Verification

- End-to-end smoke test on the live Worker URL (Phase 3b, after Phase 4) is the real verification — not just `npm run build` succeeding locally.
- `npx wrangler tail` during the smoke test to catch runtime-only errors (e.g. secrets not resolving, cookie issues).
- After Phase 5, confirm the Actions tab shows a green run on push to `main`, and that the deployed version matches (`npx wrangler deployments list`).
