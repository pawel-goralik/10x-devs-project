# Email-Sending Infrastructure (F-02) Implementation Plan

## Overview

Provision the missing Brevo REST API key and build a reusable `sendEmail` service so app-triggered transactional email (S-02's leave-a-group notification, S-05's quarterly digest) can be sent without each slice wiring its own Brevo integration or reinventing the email's visual chrome.

## Current State Analysis

- Brevo's **SMTP** side is already fully provisioned and working: `context/changes/deployment/deployment-plan.md` Phase 1c (account + verified sender + SMTP key) and Phase 4 (Supabase Auth Custom SMTP) are both done, confirmed by a live end-to-end smoke test (Phase 3b) and independently reconfirmed by a real received magic-link email from the substituted sender address. This is out of scope here — nothing in this plan touches `supabase/config.toml` or Supabase's SMTP dashboard settings.
- Brevo's **REST API key** — a separate credential from the SMTP key, per `infrastructure.md`'s Getting Started step 5 and `deployment-plan.md` Phase 7 — has not been generated (confirmed: no API keys currently visible in the Brevo dashboard).
- No email-sending code exists in the app: `src/lib/` has `utils.ts`, `config-status.ts`, `supabase.ts`, and `services/goals.ts` only — no `email.ts`, no `BREVO_*` references anywhere in the repo.
- `astro.config.mjs`'s `env.schema` currently declares only `SUPABASE_URL`/`SUPABASE_KEY`, both `context: "server", access: "secret", optional: true` — the established pattern for external config this app can run without in dev.
- `src/lib/config-status.ts` exports `configStatuses`/`missingConfigs`, consumed by `src/layouts/Layout.astro` to render a warning banner when Supabase env vars are absent — the established pattern for surfacing missing external config.
- `supabase/templates/magic-link.html` and `confirmation.html` define the app's existing branded email look: dark background (`#0f0a2e`), a rounded card (`#1a1440`, `border-radius:16px`, `max-width:420px`), a centered "Resolution Circle" header, Helvetica/Arial, and a purple (`#9333ea`) call-to-action button — table-based markup for email-client compatibility.

## Desired End State

A `BREVO_API_KEY` Worker secret exists in production, and `src/lib/services/email.ts` exports a `sendEmail` function any future slice can call to send a single-recipient HTML+text email that automatically matches the existing template's visual style. Locally, without the key set, calling `sendEmail` logs the would-be email and returns a "skipped" result instead of throwing, and `/` (or any page using `Layout.astro`) shows a warning banner when it's absent — exactly mirroring how missing Supabase config already behaves.

Verify by: sending a real test email via `sendEmail` to a disposable inbox once the secret is provisioned, and confirming the local no-key path logs instead of crashing.

## What We're NOT Doing

- No changes to Brevo SMTP, `supabase/config.toml`, or Supabase Auth's dashboard settings — that infrastructure already works.
- No digest-specific logic (Cron Trigger, per-quarter idempotency, recipient roll-up) — that's S-05's job, built against this utility later.
- No leave-notification logic (S-02) — this plan only builds the reusable capability, not its first caller.
- No batch/multi-recipient send support — `sendEmail` is single-recipient; a caller sending to a group loops and aggregates results itself.
- No retry/queueing logic for failed sends — a failure is logged and returned to the caller, never retried automatically.

## Implementation Approach

Follow the two established patterns in this codebase exactly: optional, secret-context env vars with a graceful null-fallback (`src/lib/supabase.ts`'s `createClient` returning `null` when config is missing) and a `config-status.ts` entry for the warning-banner convention. `sendEmail` owns the branded HTML wrapper so callers only ever supply their message's heading/body/text — never raw email markup — keeping S-02 and S-05 focused on their own domain logic.

## Phase 1: Provision the Brevo REST API key

### Overview

Generate and store the one missing credential, and declare it (plus the sender identity) in the app's env schema.

### Changes Required:

#### 1. Brevo REST API key generation (manual, human)

**Intent**: Generate the REST API key Brevo keeps separate from the already-provisioned SMTP key, and store it as a Worker secret — per `infrastructure.md`'s posture, provisioning/rotating a primary secret is human-only, not something an agent runs.

**Contract**: In the Brevo dashboard, Settings → SMTP & API → API Keys tab → generate a new key. Store it with `npx wrangler secret put BREVO_API_KEY` (prompts interactively; the value is never pasted into chat). For local dev, add the same value to `.dev.vars` (git-ignored, matching how `SUPABASE_URL`/`SUPABASE_KEY` are already handled there).

#### 2. Env schema

**File**: `astro.config.mjs`

**Intent**: Declare `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` following the exact existing `SUPABASE_URL`/`SUPABASE_KEY` shape, so both are optional at build time and the app degrades gracefully without them.

**Contract**: add `BREVO_API_KEY: envField.string({ context: "server", access: "secret", optional: true })` and `BREVO_SENDER_EMAIL: envField.string({ context: "server", access: "secret", optional: true })` to `env.schema`. `BREVO_SENDER_EMAIL` must be the same address verified in `deployment-plan.md` Phase 1c (Brevo requires the "from" address to be a verified sender).

#### 3. Example env files

**File**: `.env.example`

**Intent**: Document the two new variables for local setup, matching the existing `SUPABASE_URL=###` / `SUPABASE_KEY=###` placeholder style.

**Contract**: append `BREVO_API_KEY=###` and `BREVO_SENDER_EMAIL=###`.

### Success Criteria:

#### Automated Verification:

- `npx wrangler secret list` shows `BREVO_API_KEY` present as `secret_text` (read-only check, no value exposed)
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Confirm the generated key is the REST API key (API Keys tab), not the SMTP key already in use for magic-link auth
- Confirm `.dev.vars` has been updated locally (not committed — already git-ignored)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: `sendEmail` service + branded HTML wrapper

### Overview

Build the reusable service, its shared visual wrapper, and the config-status integration.

### Changes Required:

#### 1. Email service

**File**: `src/lib/services/email.ts` (new)

**Intent**: A single-recipient send function that calls Brevo's REST API, matching the null-fallback pattern `src/lib/supabase.ts` already uses for missing config, plus a shared HTML layout so every app-triggered email inherits the same branding as `supabase/templates/*.html` without each caller rebuilding it.

**Contract**: `export function renderEmailLayout({ heading, bodyHtml }: { heading: string; bodyHtml: string }): string` returns the full HTML document, reusing the exact color/layout values from `magic-link.html` (`#0f0a2e` background, `#1a1440` card, `#9333ea` accent, `max-width:420px`, table-based structure) with `heading` and `bodyHtml` slotted into the card in place of the sign-in button block.

`export async function sendEmail({ to, subject, heading, bodyHtml, text }: { to: string; subject: string; heading: string; bodyHtml: string; text: string }): Promise<{ success: boolean; error?: string }>`: if `BREVO_API_KEY` or `BREVO_SENDER_EMAIL` is unset, log the skipped send (recipient + subject, not content) and return `{ success: false, error: "Brevo is not configured" }` — never throw. Otherwise POST to `https://api.brevo.com/v3/smtp/email` with header `api-key: <BREVO_API_KEY>`, body `{ sender: { email: BREVO_SENDER_EMAIL, name: "Resolution Circle" }, to: [{ email: to }], subject, htmlContent: renderEmailLayout({ heading, bodyHtml }), textContent: text }`. On a non-2xx response or fetch error, log and return `{ success: false, error: ... }` — the caller decides whether/how to surface that; this function never throws and never blocks on a failed send.

#### 2. Config status

**File**: `src/lib/config-status.ts`

**Intent**: Extend the existing `configStatuses` array so a missing `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` surfaces the same warning banner as missing Supabase config, via the existing `Layout.astro` consumer.

**Contract**: add one more `ConfigStatus` entry, `name: "Brevo"`, `configured: Boolean(BREVO_API_KEY && BREVO_SENDER_EMAIL)`, importing both from `astro:env/server` alongside the existing `SUPABASE_URL`/`SUPABASE_KEY` import.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- With `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` unset locally, calling `sendEmail` (e.g. from a throwaway script or `astro dev` console) logs the skipped send and returns `{ success: false }` without throwing; the homepage shows the Brevo warning banner.
- With the real key set (post-Phase-1), call `sendEmail` once against a disposable inbox (e.g. a `mailinator.com` address, matching `deployment-plan.md`'s own smoke-test convention) and confirm the email arrives with the correct heading/body and the same visual style as `magic-link.html` (dark background, purple accent, "Resolution Circle" header).
- Confirm the plain-text fallback is present (view the email's "show original"/plain-text view in the test inbox).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

No test runner exists in this repo (`package.json` has no `test` script) — this plan does not introduce one. Verification is lint + build + manual send testing.

### Integration Tests:

N/A — see above.

### Manual Testing Steps:

1. Before Phase 1's key is provisioned, call `sendEmail` locally and confirm it logs + returns `{ success: false }` with no exception, and the config-status banner appears.
2. After Phase 1, send a real test email to a disposable inbox and confirm delivery, correct sender (the verified Brevo sender), subject, HTML rendering (matches `magic-link.html`'s look), and a working plain-text fallback.
3. Temporarily use an invalid `BREVO_API_KEY` value to confirm a Brevo API error is logged and returned as `{ success: false, error: ... }` rather than throwing.

## Performance Considerations

None — a single `fetch` call per send, well within Cloudflare Workers' free-tier subrequest budget at this app's scale.

## Migration Notes

None — no schema changes.

## References

- Roadmap: `context/foundation/roadmap.md` (F-02: email-sending-infrastructure)
- PRD: `context/foundation/prd.md` (FR-010, NFR "Quarterly digest deliverability")
- Infra research: `context/foundation/infrastructure.md` (Getting Started step 5, risk register)
- Prior deployment work: `context/changes/deployment/deployment-plan.md` (Phase 1c/4 SMTP setup, Phase 7 deferred REST API key)
- Existing null-fallback pattern: `src/lib/supabase.ts`
- Existing config-status pattern: `src/lib/config-status.ts`, consumed by `src/layouts/Layout.astro`
- Existing branded template reference: `supabase/templates/magic-link.html`, `supabase/templates/confirmation.html`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Provision the Brevo REST API key

#### Automated

- [x] 1.1 `npx wrangler secret list` shows `BREVO_API_KEY` present as `secret_text`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Build passes: `npm run build`

#### Manual

- [x] 1.4 Confirm the generated key is the REST API key, not the SMTP key
- [x] 1.5 Confirm `.dev.vars` updated locally

### Phase 2: `sendEmail` service + branded HTML wrapper

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`

#### Manual

- [ ] 2.3 Missing-key path logs + returns `{ success: false }` without throwing; banner appears
- [ ] 2.4 Real send to a disposable inbox arrives with correct branding and plain-text fallback
- [ ] 2.5 Invalid-key path logs and returns an error result rather than throwing
