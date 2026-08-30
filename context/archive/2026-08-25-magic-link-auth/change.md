---
change_id: magic-link-auth
title: Replace password auth with passwordless magic-link auth
status: archived
created: 2026-08-25
updated: 2026-08-30
archived_at: 2026-08-30T08:03:20Z
---

## Notes

Roadmap item F-01 (`context/foundation/roadmap.md`). Foundation change — unlocks S-01/S-02 and everything downstream, since all later slices assume magic-link sign-in.

Key decisions made during planning (see `plan-brief.md` for the full table):

- Signin/signup merged into a single "continue with email" flow.
- PKCE flow only for MVP; OTP-code fallback explicitly deferred to post-MVP.
- Default 1h link expiry kept; failures redirect back to `/auth/signin` with a friendly error rather than a dedicated error page.
- Pre-launch assumption: no real end users yet, so no password→magic-link account migration path needed.
- Dead password-auth code deleted outright, not kept dormant.
- Magic-link email template customized and stored in the codebase (`supabase/templates/magic-link.html`), consistent with how this repo already treats `config.toml` as the source of truth pushed to production — not a local-only file.

## Phase 1 adaptation (discovered during manual verification)

`config.toml`'s `additional_redirect_urls` only listed the bare production origin (`https://resolution-circle.pawel-goralik.workers.dev`, no path). Supabase's GoTrue validates `emailRedirectTo` against `site_url` + `additional_redirect_urls` and **silently falls back to the bare `site_url`** when the requested URL isn't on that list — meaning `/api/auth/callback` never matched, and both local dev and production would have redirected to the site root with the `code` param dropped, breaking the entire magic-link flow (not just local testing). Fixed by widening `additional_redirect_urls` to `["https://resolution-circle.pawel-goralik.workers.dev/**", "http://localhost:4321/**"]` (wildcarding the path, not the domain) as part of Phase 1, verified end-to-end via curl (request → Inbucket email → Supabase verify → `/api/auth/callback` → authenticated `/dashboard`).

Also discovered: `signInWithOtp` sends Supabase's **`confirmation`** email template (subject "Confirm your email address") for brand-new users, and only uses the **`magic_link`** template for returning users requesting a link again. Phase 3's branded-template work should account for both templates, not just `magic_link`, since first-time signup is the more common case for this app.

## Phase 3 adaptation (discovered during manual verification)

Confirmed via local Inbucket testing that the Phase 1 note above was correct in practice: an unconfirmed email (new signup or any account that never completed a click-through) got Supabase's generic, unbranded "Confirm your email address" template even after the plan's `[auth.email.template.magic_link]` wiring landed — because Supabase routes it through the separate `confirmation` template, not `magic_link`. Since Phase 2 merged signup+signin into one flow, first-time requests are the common case, so shipping only `magic_link` would leave most real users seeing the unbranded default. Adapted by adding a second template file (`supabase/templates/confirmation.html`, same branding/copy, first-time-appropriate wording) and wiring `[auth.email.template.confirmation]` alongside `[auth.email.template.magic_link]` in `config.toml` — both point at the same subject ("Your Resolution Circle sign-in link"). Verified end-to-end via curl + Inbucket: an unconfirmed test account now gets the branded `confirmation.html` body, and a confirmed returning account gets the branded `magic-link.html` body.
