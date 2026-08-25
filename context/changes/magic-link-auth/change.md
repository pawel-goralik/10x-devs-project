---
change_id: magic-link-auth
title: Replace password auth with passwordless magic-link auth
status: implementing
created: 2026-08-25
updated: 2026-08-25
archived_at: null
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
