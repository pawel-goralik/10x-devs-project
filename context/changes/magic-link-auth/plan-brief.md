# Magic-Link Auth — Plan Brief

> Full plan: `context/changes/magic-link-auth/plan.md`

## What & Why

Replace the current email+password auth flow with passwordless email magic-link auth. This is roadmap Foundation F-01: PRD FR-001/002/003 and the `Access Control` section require magic-link-only auth for the MVP, and every downstream slice (S-01 onward) assumes it — building goal/group features against the current password flow would mean redoing the sign-in surface later.

## Starting Point

Auth is fully wired but password-based: `signup.ts`/`signin.ts` call Supabase's `signUp`/`signInWithPassword`, backed by password forms and a post-signup "check your inbox" page. `src/middleware.ts` and `src/lib/supabase.ts` resolve sessions generically and need no changes. No callback route exists yet — the password flow never needed one, but PKCE magic links do.

## Desired End State

A visitor lands on `/auth/signin`, submits just an email address, receives a branded magic-link email, clicks it, and lands authenticated on `/dashboard`. No password field, password route, or password component exists anywhere in the app. `/auth/signup` is gone entirely — one page now serves both new and returning users.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Auth flow mechanism | PKCE (link-click) only | Simpler to ship for MVP scale; OTP-code fallback (which would solve the cross-device limitation) is explicitly deferred to post-MVP | Plan |
| Signin/signup surface | Merge into one "continue with email" flow | Magic link doesn't distinguish signup from signin — `signInWithOtp` creates the user if needed, so a separate signup page is redundant | Plan |
| Link expiry & failure UX | Keep default 1h expiry; failures redirect to `/auth/signin` with a friendly error (no dedicated error page) | Avoids touching `config.toml`'s auth block for a cosmetic tuning knob; one page covers entry + error state | Plan |
| Existing accounts | No migration path built | Pre-launch: no real end users yet, per roadmap baseline | Plan |
| Dead code | Delete `SignInForm`, `SignUpForm`, `PasswordToggle`, old routes outright | Matches the project's no-dead-code convention; git history is the rollback path, not a dormant fallback | Plan |
| Rate-limit UX | Detect Supabase's rate-limit error code and show a friendly, specific message | Turns an expected, normal event into calm UX instead of a scary generic error | Plan |
| Email template | Custom-branded, stored in the codebase (`supabase/templates/magic-link.html`) and pushed to the linked remote project | `config.toml` is already the pushed source of truth for this project's production auth config (it already carries the live `site_url`) — this follows existing convention rather than introducing a codebase/dashboard split | Plan |
| Verification approach | Lint + `astro check` + build, plus manual click-through via local Inbucket | No test framework exists in this repo; adding one is out of scope for an auth-mechanism swap | Plan |

## Scope

**In scope:**
- `POST /api/auth/request-link` and `GET /api/auth/callback` routes (PKCE)
- Merged `MagicLinkForm`, rewritten `/auth/signin`, repurposed `/auth/check-email`
- Deletion of all password-auth code and routes
- Branded magic-link email template, checked into the codebase and pushed to production
- README/CLAUDE.md doc sync

**Out of scope:**
- OTP-code (typed code) fallback flow
- Any password→magic-link account migration
- Changing Supabase's default rate limits or OTP expiry
- Goals/groups feature work (separate roadmap slices)
- Adding a test framework

## Architecture / Approach

Two new API routes carry the mechanism (`request-link.ts` calls `signInWithOtp`, `callback.ts` calls `exchangeCodeForSession`), replacing the two password routes. One merged UI flow replaces the two password forms. The email template lives in the codebase and is pushed via `supabase config push` — but only after manually diffing the live project's Authentication dashboard against `config.toml` first, since a past incident showed that push overwrites the *entire* remote `[auth]` block with no field-level diff.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Magic-link API routes | `request-link` + `callback` routes, zod validation, password routes removed | Callback's `code`/`error_description` contract is easy to get subtly wrong |
| 2. Merged sign-in UI | Single email-only sign-in page, check-email page, dead password UI removed | None significant — mechanical swap of existing component patterns |
| 3. Branded email template | Custom template in codebase, wired via `config.toml`, pushed to production | Config push overwriting unrelated live `[auth]` settings if drift isn't checked first |
| 4. Docs sync + full verification | README/CLAUDE.md updated, complete end-to-end click-through verified | None significant |

**Prerequisites:** Local Supabase running (`npx supabase start`) for Phases 1-3 manual verification; access to the linked remote project's Dashboard for Phase 3's production push.
**Estimated effort:** ~1-2 sessions across 4 phases — small, self-contained auth swap with no new data model.

## Open Risks & Assumptions

- Assumes there are genuinely no real end users on the current password flow to preserve continuity for (confirmed during planning based on roadmap baseline).
- The PKCE cross-device limitation (magic link opened on a different browser/device than the request) is an accepted, not solved, limitation for MVP.
- Phase 3's production config push depends on a careful manual diff against the live dashboard; skipping that step risks silently overwriting unrelated auth settings.

## Success Criteria (Summary)

- A visitor can request a magic link, receive a branded email, click it, and land authenticated on `/dashboard`, matching FR-001/002/003.
- No password field, password route, or password component remains anywhere in the app.
- Production's magic-link email template matches the codebase version with no unintended drift in other auth settings.
