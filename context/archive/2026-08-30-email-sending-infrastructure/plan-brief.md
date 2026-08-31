# Email-Sending Infrastructure (F-02) — Plan Brief

> Full plan: `context/changes/email-sending-infrastructure/plan.md`

## What & Why

Provision Brevo's REST API key and build a reusable `sendEmail` service, so S-02's leave-a-group email notification and S-05's quarterly digest can send real email without each building their own Brevo integration or email markup. Pulled out of S-02's own planning session once it became clear both slices need the same infra.

## Starting Point

Brevo's **SMTP** side is already done and confirmed working — magic-link auth has been sending real emails through Brevo since the initial Cloudflare deployment (`context/changes/deployment/deployment-plan.md` Phase 1c/4). What's missing is the separate **REST API key** (confirmed: none exist yet in the Brevo dashboard) and any app code to call it — no `src/lib/services/email.ts` exists.

## Desired End State

A `BREVO_API_KEY` Worker secret is provisioned, and any future slice can call `sendEmail({ to, subject, heading, bodyHtml, text })` to send a single-recipient email that automatically matches the existing branded template look (`supabase/templates/magic-link.html`'s dark/purple styling). Without the key configured, calls log and return a "skipped" result instead of crashing — same graceful-degradation pattern as missing Supabase config.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Scope correction | F-02 is REST-API-key-only; SMTP/magic-link is already done | Discovered mid-planning that Phase 1c/4 of the deployment already finished the SMTP side — confirmed by a real received magic-link email |
| Send shape | Single-recipient function, caller loops for multiple | Keeps partial-failure handling in the caller's domain, where S-02 and S-05 actually differ |
| Failure mode | Log and continue, never block the triggering action | A Brevo outage shouldn't prevent someone from leaving a group |
| Content format | HTML + plain-text fallback, with a shared branded wrapper | Keeps visual consistency with the existing Supabase email templates without duplicating markup in every slice that sends email |
| Missing-key behavior | No-op + log, mirroring `supabase.ts`'s null-fallback pattern | Matches the one config-handling convention this codebase already has |

## Scope

**In scope:**
- Generating and storing the Brevo REST API key (`BREVO_API_KEY` Worker secret)
- `src/lib/services/email.ts`: `sendEmail` + a shared `renderEmailLayout` HTML wrapper
- `config-status.ts` warning-banner integration for missing Brevo config

**Out of scope:**
- Any change to Brevo SMTP or Supabase Auth's SMTP settings (already done)
- S-02's leave-notification logic or S-05's digest logic (first callers, built later)
- Batch sending, retries, or a queue

## Architecture / Approach

Mirrors the two conventions already in this codebase: `src/lib/supabase.ts`'s null-fallback for missing external config, and `config-status.ts`'s warning-banner pattern. `sendEmail` owns the branded HTML shell so callers only ever supply message content, never raw markup.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Provision the key | `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` in env schema + Worker secret | Human-only step (secret provisioning) — nothing to automate here |
| 2. `sendEmail` service | Reusable send function + branded wrapper + config-status entry | None significant — small, isolated, no schema changes |

**Prerequisites:** None (no roadmap dependency).
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- No test runner exists in this repo — verification is lint + build + manual send testing only.
- Assumes `BREVO_SENDER_EMAIL` is set to the same address already verified in Brevo (Phase 1c) — a different, unverified sender would fail to send.

## Success Criteria (Summary)

- `sendEmail` successfully delivers a real email to a disposable inbox, styled consistently with the existing magic-link/confirmation templates.
- Without the key configured, the app doesn't crash — it logs and shows the same warning banner pattern as missing Supabase config.
