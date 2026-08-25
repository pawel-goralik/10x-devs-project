---
change_id: magic-link-auth
title: Replace password auth with passwordless magic-link auth
status: planned
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
