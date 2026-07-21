---
project: Resolution Circle
researched_at: 2026-07-19
recommended_platform: Cloudflare Workers
runner_up: Netlify
email_provider: Brevo (magic-link + quarterly digest)
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR, output "server")
  runtime: Cloudflare Workers (workerd) via @astrojs/cloudflare v13
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare is the only shortlisted platform that is *genuinely free* at Resolution Circle's projected scale (100,000 requests/**day** free vs. a peak nearer 3,000/day, with free Cron Triggers) and carries **no commercial-use restriction** — the decisive factor given "free tier is the top priority." It is also already the target the starter is wired for: `@astrojs/cloudflare` v13 is installed, `wrangler.jsonc` exists and points at the Workers entrypoint, `.dev.vars` holds local secrets, and observability is enabled. Every one of the five agent-friendly criteria scores Pass. The runner-up, **Netlify**, is also truly free and has GA agent tooling, and is the recommended fallback if Cloudflare's workerd runtime quirks prove too costly to work around.

## Platform Comparison

Hard filters applied first: no persistent-connection requirement (interview Q1 = No), so nothing was dropped on that axis; all six candidates run Astro 6 SSR (TypeScript), so none was dropped on runtime. The decisive interview weight was **free tier is the top priority** (Q2), which reordered the field: three candidates have no usable free tier at MVP scope and fell out of the shortlist despite strong agent-friendliness.

| Platform | CLI-first | Managed/Serverless | Agent docs | Deploy API | MCP / Integration | Free at this scale? |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass (evolving) | **Yes — effectively $0** |
| **Netlify** | Partial | Pass | Pass | Pass | Pass (GA) | Yes — credit-capped, never billed |
| **Vercel** | Pass | Pass | Pass | Pass | Partial (beta, read-only) | Only if non-commercial |
| **Render** | Pass | Pass | Pass | Pass | Pass (destructive-capable) | No — cold starts + paid cron (~$8/mo) |
| **Railway** | Pass | Pass | Pass | Pass | Pass (GA) | No — no free tier (~$5/mo) |
| **Fly.io** | Pass | Partial (Dockerfile/VM) | Pass | Pass | Partial (experimental) | No — no free tier (~$2–5/mo) |

**Per-platform notes:**

- **Cloudflare Workers** — Five clean passes. `wrangler` v4 (installed) covers deploy / rollback / log-tail. Docs are best-in-class for agents (`llms.txt`, per-page `.md`, a dedicated docs-for-agents index). Free tier is 100k req/day + free Cron Triggers. The cost of this choice is runtime, not money: workerd is not Node, which introduces a small set of specific footguns (see cross-check).
- **Netlify** — Also genuinely free (300 credits/mo, hard-capped, never billed), runs on **real Node functions** (no workerd quirks), GA `@astrojs/netlify` v7 adapter with day-one Astro 6 support, official GA MCP server, `llms.txt` docs. The one gap: **no dedicated rollback CLI command** (rollback is a UI "Publish deploy" or API call), scored Partial on CLI-first. Best fallback.
- **Vercel** — Technically excellent and all-GA (adapter, CLI, cron, docs with `llms.txt`), on real Node functions. Dropped to third on a **policy** risk, not a technical one: the Hobby free tier is **non-commercial only** (donations count), so any monetization forces Pro at ~$20/mo. MCP is public-beta and read-only.
- **Render** — Clean Astro SSR via `@astrojs/node`, GA CLI, `llms.txt`. Free tier exists but spins down after 15 min (~1-min cold start — bad for magic-link auth latency) and **Cron Jobs are a paid feature**, so realistic MVP cost is ~$8/mo (Starter + cron). Its MCP is GA but destructive-capable with coarse key scope.
- **Railway** — Strong agent story (CLI + `.md` docs + GA MCP) but **no free tier** (~$5/mo floor), and scale-to-zero is defeated by a live Supabase connection, so budget for near-always-on cost.
- **Fly.io** — Solid `flyctl`, but **no free tier** (card required), a **Dockerfile is mandatory** (extra surface for a solo 3-week build), and native scheduling has **no quarterly option** (needs Cron Manager / Supercronic / external cron). MCP is experimental.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on the user's stated top priority — free — without the asterisks the others carry (no commercial clause like Vercel, no cold-start/paid-cron tax like Render, no missing free tier like Railway/Fly). It is also the path of least resistance: the repo is already configured for it. All five agent-friendly criteria Pass, and the docs are the most agent-readable of any candidate.

#### 2. Netlify

The strongest fallback: also truly free, but on **real Node functions**, which sidesteps every workerd-specific risk in Cloudflare's register. GA MCP server and GA Astro 6 adapter make it equally agent-friendly. The only material gap is the absence of a rollback CLI command. Choose this if the workerd runtime quirks (below) turn out to cost more debugging time than the free tier is worth.

#### 3. Vercel

Best raw developer experience and fully GA tooling on real Node. Held back only by the Hobby tier's non-commercial restriction — a compliance cliff triggered by success rather than by code. A legitimate pick if runtime fidelity matters more than staying free through monetization.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The `[object Object]` SSR footgun (present in this repo today).** With `nodejs_compat` and `compatibility_date >= 2025-09-15`, Astro 6 SSR pages render `[object Object]` unless `disable_nodejs_process_v2` is also set (astro#15434). The current `wrangler.jsonc` has `compatibility_date: "2026-05-08"` + `nodejs_compat` but **not** the fix flag — so this must be applied before first deploy.
2. **Workers is not Node.** Any current or future dependency needing an unpolyfilled Node built-in fails at build/deploy (not locally). The ecosystem escape hatch is narrower than a real Node container.
3. **Cron Triggers have no automatic retry.** The original concern was the 10ms free-tier CPU limit, but CPU time excludes I/O wait (Supabase queries, Brevo API calls), so a synchronous loop over the current group size (<45 recipients) comfortably fits the budget — Queues were considered and deferred for now. The real risk is an unhandled error (e.g. a transient Brevo API failure) killing the invocation mid-loop with no retry, silently skipping the digest — the PRD's load-bearing "social heartbeat."
4. **Pages-vs-Workers drift.** `tech-stack.md` and `CLAUDE.md` both say "cloudflare-pages," but the installed `@astrojs/cloudflare` v13 adapter and `wrangler.jsonc` target **Workers**. Following stale Pages docs (`wrangler pages deploy`) will not match the actual config (`wrangler deploy`).
5. **No native email.** Deliverability is a hard NFR, but Cloudflare has no outbound email primitive (Email Routing is inbound-only). Magic-link auth is unaffected (Supabase Auth's own SMTP settings send from Supabase's servers, not the Worker); the quarterly digest calls Brevo's transactional email REST API via `fetch` from the Worker — a dependency not covered by the platform itself, but a plain HTTPS call with no experimental runtime features involved.

### Pre-Mortem — How This Could Fail

The team shipped Resolution Circle on Workers in three weeks; it worked in dev. The first failure was invisible: the digest cron fired on March 31, looped synchronously over every active member, and a transient timeout calling Brevo's API for one recipient threw an unhandled exception mid-run. The invocation was killed, and because Cron Triggers don't retry, that quarter's digest never sent — no error, no user-facing signal. The one mechanism the whole product depends on silently skipped a beat, noticed only when a friend asked why no email arrived. Meanwhile a routine dependency bump pulled in a library expecting a Node built-in Workers didn't polyfill: the build passed locally (Node) but failed on deploy, and a `compatibility_date` bump reintroduced the `[object Object]` bug. Each fix was small but demanded Workers-specific runtime knowledge the solo dev lacked, turning "just deploy it" into repeated edge-runtime debugging sessions that devoured the after-hours budget a three-week timeline couldn't spare.

### Unknown Unknowns

- The 10ms CPU limit is **CPU time, not wall-clock time** — time awaiting Supabase queries and Brevo API `fetch` calls does *not* count. A digest is overwhelmingly I/O-bound, so a single synchronous `scheduled` handler comfortably fits the CPU budget at the current recipient count (<45) — no need for Cloudflare Queues yet. The free plan's separate **50-external-subrequest-per-invocation** cap is the more relevant ceiling: revisit Queues (or Workers Paid, which lifts that cap) once recipient count approaches it.
- The "Pages absorbed into Workers" transition means adapter docs, tutorials, and the repo's own "cloudflare-pages" label are drifting out of sync with the current-recommended Workers path.
- **Email deliverability has no Cloudflare-native answer** — Email Routing is inbound-only; the outbound digest depends entirely on a third party.
- **Local-dev fidelity is softer than it looks:** `astro dev` runs on Node; production runs on workerd. Env access, crypto, and cookie behavior can differ, so "works locally" is a weaker guarantee than on Node-container platforms.
- Supabase connections aren't pooled from short-lived isolates the way a long-lived Node server pools them; at real scale you'd need Hyperdrive — not an MVP problem, but an invisible cliff.

## Operational Story

- **Preview deploys**: `wrangler versions upload` publishes a *preview* version with its own `*-<version>.<subdomain>.workers.dev` URL without shifting production traffic; promote with `wrangler deployments`/`wrangler rollback`. For PR-triggered previews, wire the `cloudflare/wrangler-action` GitHub Action (the repo already uses GitHub Actions). Preview URLs on `workers.dev` are public unless gated behind Cloudflare Access.
- **Secrets**: local dev reads `.dev.vars` (already present, git-ignored); production secrets are set with `npx wrangler secret put SUPABASE_URL` and `SUPABASE_KEY` (stored encrypted in Cloudflare, not readable back), or injected via CI from GitHub Actions secrets. Astro reads them through `astro:env/server`. Rotation = re-run `wrangler secret put` (a human-only action — see Approval).
- **Rollback**: `npx wrangler deployments list` to find the prior version id, then `npx wrangler rollback [version-id]` — near-instant re-point, no rebuild. Caveat: rollback reverts *code only*; a Supabase schema migration shipped alongside does not roll back automatically, so migrations must be backward-compatible.
- **Approval**: an agent may deploy code (`wrangler deploy`), tail logs, and upload preview versions unattended. **Human-only:** rotating `SUPABASE_KEY` (or any primary secret), running a destructive Supabase migration, and deleting the Worker/project. The Cloudflare API token given to the agent/CI should be scoped to Workers for this one project — no DNS, no unrelated Workers Secrets, no billing.
- **Logs**: `npx wrangler tail` streams live runtime logs (observability is already enabled in `wrangler.jsonc`); allow ~60s to exit sampling mode. Historical logs and invocation metrics are in the Workers Observability dashboard, and the Cloudflare Observability MCP server exposes them for structured agent queries.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                |
|---|---|---|---|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| SSR pages render `[object Object]` (nodejs_compat + compat_date ≥ 2025-09-15, fix flag missing in current `wrangler.jsonc`) | Devil's advocate | H | H | Add `disable_nodejs_process_v2` to `compatibility_flags` in `wrangler.jsonc` before first deploy; verify SSR output on a preview version (astro#15434).                                                                                                                                                                   |
| Quarterly digest cron killed by an unhandled error mid-loop; no auto-retry → silent missed digest | Pre-mortem | M | H | **Decided (MVP, <45 recipients): no Queues** — a single synchronous `scheduled` handler queries Supabase and sends via Brevo directly, comfortably under the free plan's 10ms CPU (I/O wait doesn't count) and 50-external-subrequest caps. Make the send idempotent via a per-quarter send-state row in Supabase (already decided), and expose a protected manual re-fire route to recover from a killed invocation. Add Cloudflare Queues once recipient count approaches ~45 (the free-tier subrequest ceiling, not the CPU limit — see Unknown Unknowns). |
| Email deliverability (hard NFR) has no Cloudflare-native path | Research finding | M | H | **Decided: Brevo** (one provider for both paths — SMTP for magic-link via Supabase, REST API via `fetch` for the digest). No domain/DNS required to start (single sender email verification); treat it as a first-class dependency, not an afterthought.                                                                  |
| Brevo free tier caps at **300 emails/day**; quarterly digest is a same-day burst (≈1 email per active user) | Research finding | L | M | Fine at MVP scale (well under 300 active users). If the user base grows further, spread the digest send across a few days via the Queue consumer, or migrate to a different solution (to be discovered if needed).                                                                                                        |
| Without an authenticated sending domain, Brevo substitutes the visible sender address as a deliverability workaround | Research finding | L | L | Cosmetic only — doesn't block sending or break magic-link/digest delivery. Authenticate a domain later if a branded "From" address becomes a requirement; out of scope for MVP.                                                                                                                                           |
| Following stale "Pages" docs/labels breaks the deploy (wrong command / adapter path) | Devil's advocate | M | M | Deploy path is Workers: `npm run build && npx wrangler deploy` (never `wrangler pages deploy`). Update `tech-stack.md`/`CLAUDE.md` "cloudflare-pages" references to "Cloudflare Workers" to remove the drift.                                                                                                             |
| A dependency needing an unpolyfilled Node built-in passes local build, fails on deploy | Devil's advocate | M | M | Test against workerd (`wrangler dev` on the built output, or CI deploy to a preview) before merging dependency bumps; prefer edge-safe libraries; keep `nodejs_compat` on.                                                                                                                                                |
| Supabase migration shipped with a code deploy doesn't roll back with `wrangler rollback` | Research finding | L | M | Keep migrations backward-compatible; deploy schema changes separately and ahead of code that depends on them.                                                                                                                                                                                                             |
| Supabase connection exhaustion from many short-lived isolates at scale | Unknown unknowns | L | M | Not an MVP concern at `low` QPS; if it appears, front Postgres with Cloudflare Hyperdrive.                                                                                                                                                                                                                                |
| Local-dev (Node) behavior diverges from production (workerd) — "works locally" gives false confidence | Unknown unknowns | M | L | Smoke-test auth/cookie/crypto flows on a deployed preview version, not just `astro dev`, before production publish.                                                                                                                                                                                                       |

## Getting Started

Version-accurate for the pinned stack (`astro@^6.3.1`, `@astrojs/cloudflare@^13.5.0`, `wrangler@^4.90.0`). The repo is already configured for Workers, so this is finish-the-wiring, not from-scratch.

1. **Apply the SSR fix flag.** In `wrangler.jsonc`, change `"compatibility_flags": ["nodejs_compat"]` to `"compatibility_flags": ["nodejs_compat", "disable_nodejs_process_v2"]`. Without this, SSR pages can render `[object Object]` at the current `compatibility_date`.
2. **Authenticate wrangler:** `npx wrangler login` (interactive, human) — or for CI, set a scoped `CLOUDFLARE_API_TOKEN` env var (Workers-only, this project).
3. **Set production secrets:** `npx wrangler secret put SUPABASE_URL` then `npx wrangler secret put SUPABASE_KEY`. (Local dev already reads these from `.dev.vars`.)
4. **Build and deploy:** `npm run build && npx wrangler deploy`. Note: use `wrangler deploy` (Workers), **not** `wrangler pages deploy` — the v13 adapter targets Workers. For day-to-day dev, `npm run dev` (`astro dev`) is the loop; a separate `wrangler dev` is only needed when you specifically want full workerd fidelity, and is otherwise redundant.
5. **Set up email (Brevo) — two paths, one provider.** In the Brevo dashboard, verify a single sender email address (6-digit code, no DNS needed) and grab an SMTP key plus a REST API key (Settings → SMTP & API).
   - **Magic-link auth:** in the Supabase dashboard (Auth → SMTP settings), enter Brevo's SMTP host/port (`smtp-relay.brevo.com:587`), your Brevo account email as the SMTP login, and the SMTP key as the password, so Supabase Auth sends magic links through Brevo.
   - **Quarterly digest:** store the Brevo REST API key as a Worker secret (`npx wrangler secret put BREVO_API_KEY`) and call Brevo's transactional email endpoint (`POST https://api.brevo.com/v3/smtp/email`) via `fetch` from the Worker — plain HTTPS, no raw-socket SMTP client needed inside workerd.
6. **Wire the quarterly digest** as a Cron Trigger in `wrangler.jsonc` (`"triggers": { "crons": ["0 9 1 1,4,7,10 *"] }`) plus a `scheduled` handler that queries all active members from Supabase and sends each email directly via the Brevo API using `fetch` — no Cloudflare Queues needed at the current group size (<45 recipients), well under the free plan's 50-external-subrequest cap per invocation. Gate the send on a per-quarter idempotency row in Supabase, and expose a protected manual re-fire route in case a transient error kills the invocation partway through (no automatic retry without Queues). Add Queues once recipient count approaches ~45.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration (not needed — Workers deploys the adapter bundle, no Dockerfile).
- CI/CD pipeline setup (the repo's GitHub Actions workflow is separate; wiring `wrangler-action` for auto-deploy is a follow-up).
- Production-scale architecture (multi-region HA, Hyperdrive connection pooling, DR) — MVP is `low` QPS / `small` data.
- Email provider **selection is decided (Brevo)**; Resend remains the documented fallback if Brevo's daily cap or deliverability needs are outgrown. The remaining setup — sender verification, SMTP/API key generation, and Supabase SMTP configuration — is an implementation follow-up, not part of this research.
