# Magic-Link Auth Implementation Plan

## Overview

Replace the current email+password auth flow with passwordless email magic-link auth, per PRD FR-001/002/003 and the `Access Control` section ("Authentication is passwordless email magic-link only for the MVP"). This is roadmap Foundation **F-01** — every downstream slice (S-01 onward) assumes magic-link sign-in, so it must land before any goal/group work begins.

## Current State Analysis

The app has a fully wired, working password-based auth flow: `signup.ts` calls `supabase.auth.signUp()`, `signin.ts` calls `supabase.auth.signInWithPassword()`, backed by `SignUpForm.tsx` / `SignInForm.tsx` (with `PasswordToggle.tsx`) and a post-signup `confirm-email.astro` page. `src/middleware.ts` and `src/lib/supabase.ts` are flow-agnostic — they resolve `context.locals.user` from whatever valid Supabase session cookie exists, so they need no changes for this migration. No callback route exists yet, because the password flow never needed one.

The app is pre-launch: per `context/foundation/roadmap.md`'s baseline, no goals/groups features exist yet and this is the first roadmap item scheduled for implementation. There are no real end users to migrate.

### Key Discoveries:

- `src/middleware.ts:6-16` and `src/lib/supabase.ts` are session-mechanism-agnostic — they'll work unchanged once magic-link auth populates the same cookie-based session.
- No `src/pages/api/auth/callback.ts` (or equivalent) exists — PKCE magic links require one to exchange the `code` query param for a session.
- `zod` is not a dependency anywhere in `package.json`, despite CLAUDE.md's convention that API routes validate input with zod — the current `signin.ts`/`signup.ts` don't validate input either. This change adopts zod for the new route.
- `supabase/config.toml` already declares the live Worker's `site_url` and `additional_redirect_urls` (`https://resolution-circle.pawel-goralik.workers.dev`) — meaning `config.toml` is already treated as the pushed source of truth for the linked remote project's auth config, not a local-only file.
- No `supabase/templates/` directory exists yet; `config.toml`'s `[auth.email.template.*]` section only has commented-out examples for `invite` and `notification.password_changed` — no `magic_link` template is referenced.
- Local email testing is via Inbucket at `http://127.0.0.1:54324` (`supabase/config.toml:99-102`), already the documented local dev inbox.
- No test framework is configured (no vitest/playwright in `package.json`) — automated verification for this change relies on `eslint`, `astro check`, and `astro build`, matching how the rest of the repo is verified today.
- `README.md`'s "Auth routes" table (lines 140-149) and CLAUDE.md's "Auth flow" section both hard-code the current password-flow route list and will go stale once routes change.

## Desired End State

A visitor can request a magic link by submitting their email on `/auth/signin`, receive an email (branded, stored in the codebase) with a clickable link, click it, and land authenticated on `/dashboard` — matching FR-001/002/003 exactly. Signing out via the existing `/api/auth/signout` still works unchanged. No password field, password route, or password component exists anywhere in the app.

**Verification**: `/auth/signup` returns 404, `/auth/signin` renders only an email field, a submitted email round-trips through the local Inbucket inbox to a working `/dashboard` session, and an invalid/expired link redirects back to `/auth/signin` with a friendly error.

## What We're NOT Doing

- **OTP-code (typed 6-digit code) fallback flow** — explicitly deferred to post-MVP. PKCE link-click only for this change; the known cross-device limitation (link opened on a different browser/device than the request) is accepted, not solved, for the MVP.
- **Password-account → magic-link migration tooling** — pre-launch assumption holds (no real end users yet). Existing test/dev accounts, if any, are not migrated.
- **Changing Supabase's default rate limits or `otp_expiry`** — both stay at their `config.toml` defaults (2 emails/hour, 1-hour link expiry).
- **Any goals/groups schema or feature work** — that's S-01/S-02, separate roadmap slices gated on this one.
- **Adding a test framework** (vitest, playwright, etc.) — out of scope for an auth-mechanism swap; verification stays lint + typecheck + build + manual, per decision made during planning.
- **A dedicated "link expired" page** — expired/invalid links redirect back to `/auth/signin` and reuse its existing error banner, rather than adding a new page.

## Implementation Approach

Two new API routes carry the mechanism: `POST /api/auth/request-link` (replaces `signin.ts`/`signup.ts`, calls `signInWithOtp`) and `GET /api/auth/callback` (new, calls `exchangeCodeForSession`). One merged UI flow replaces the two password forms: `/auth/signin` becomes a single "continue with email" page, and `confirm-email.astro` is repurposed as `/auth/check-email` for the post-submit "we sent you a link" state. The email template is customized and checked into the codebase (`supabase/templates/magic-link.html`), consistent with how `config.toml` already carries production's `site_url` — it's pushed to the linked remote project as a deliberate, reviewed step, not left as a local-only file or hand-edited via the Dashboard.

## Critical Implementation Details

### Magic-link callback contract

Supabase's magic-link redirect appends either `?code=<pkce_code>` (success — exchange it via `supabase.auth.exchangeCodeForSession(code)`) or `?error=...&error_description=...` (failure — e.g. an expired/already-used link) to the `emailRedirectTo` URL passed to `signInWithOtp`. `callback.ts` must check for `error_description` before assuming `code` is present, and treat a missing/rejected `code` the same way as an explicit error — both redirect to `/auth/signin?error=...`.

### Supabase config push semantics

`config.toml`'s `[auth]` block is not local-only — `supabase config push` overwrites the **entire** remote `[auth]` block for the linked project in one shot, with no field-level diff. A past incident on this project hit exactly this: a config push silently wiped auth settings that had drifted between the dashboard and git. Before pushing the new `auth.email.template.magic_link` section (Phase 3), manually compare every field in the live project's Authentication dashboard against `config.toml` and reconcile any drift first — do not push blind.

## Phase 1: Magic-link API routes

### Overview

Replace the password-based auth API routes with the two routes the magic-link flow needs: requesting a link and completing it.

### Changes Required:

#### 1. Add zod dependency

**File**: `package.json`

**Intent**: Adopt zod for server-side input validation on the new route, per CLAUDE.md's API-route convention (not previously followed by the password routes).

**Contract**: Add `zod` to `dependencies`.

#### 2. Request-link route

**File**: `src/pages/api/auth/request-link.ts` (new)

**Intent**: Accept an email from the sign-in form, validate it, and trigger Supabase's magic-link email. Replaces both `signin.ts` and `signup.ts` — `signInWithOtp` creates the user if they don't already exist, so one route covers both cases.

**Contract**: `export const prerender = false; export const POST: APIRoute`. Reads `email` from `context.request.formData()`, validates with a zod `z.string().email()` schema, calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <origin>/api/auth/callback } })`. On zod failure or missing Supabase client, redirect to `/auth/signin?error=...`. On a Supabase error whose `error.code === "over_email_send_rate_limit"`, redirect to `/auth/signin` with a friendly rate-limit-specific message ("You've requested a link recently — check your inbox, or wait a bit before trying again.") rather than the raw Supabase message; any other error redirects with `error.message` as-is. On success, redirect to `/auth/check-email?email=<submitted email>`.

#### 3. Callback route

**File**: `src/pages/api/auth/callback.ts` (new)

**Intent**: Complete the PKCE exchange when the user clicks the emailed link, establishing their session.

**Contract**: `export const prerender = false; export const GET: APIRoute`. Implements the contract described in "Critical Implementation Details → Magic-link callback contract" above. On success, redirect to `/dashboard`; on any failure path, redirect to `/auth/signin?error=<friendly message>`.

#### 4. Remove password routes

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts` (delete)

**Intent**: Fully superseded by `request-link.ts`. `signout.ts` is untouched — it works against any session type.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- With `npx supabase start` and `npm run dev` running, `curl -X POST -d "email=test@example.com" http://localhost:4321/api/auth/request-link -i` returns a redirect to `/auth/check-email?email=test%40example.com`
- The magic-link email arrives in the local Inbucket inbox at `http://127.0.0.1:54324`
- Opening the link from Inbucket hits `/api/auth/callback` and redirects to `/dashboard` with a valid session cookie set
- Posting an invalid email (e.g. `not-an-email`) redirects to `/auth/signin?error=...` instead of calling Supabase
- Requesting a second link within the rate-limit window shows the friendly rate-limit message, not a raw Supabase error string

---

## Phase 2: Merged sign-in UI

### Overview

Replace the two password forms and the post-signup page with the single-flow UI: one form to request a link, one page to show "check your email."

### Changes Required:

#### 1. Magic-link form component

**File**: `src/components/auth/MagicLinkForm.tsx` (new)

**Intent**: Single email field, client-side format validation, submits to the new API route. Replaces `SignInForm.tsx` and `SignUpForm.tsx` combined.

**Contract**: Reuses `FormField`, `SubmitButton`, `ServerError` exactly as `SignInForm.tsx` does today (same props, same `cn`/Tailwind conventions). `<form method="POST" action="/api/auth/request-link">` with a single `email` field; same regex-based client validation pattern as the existing forms (no password fields, no `PasswordToggle`).

#### 2. Sign-in page

**File**: `src/pages/auth/signin.astro`

**Intent**: Becomes the single "continue with email" entry point for both new and returning users.

**Contract**: Swap the `SignInForm` import/usage for `MagicLinkForm`; remove the "Don't have an account? Sign up" footer line entirely (no separate signup surface). Keep the existing `?error=` query param → `ServerError` wiring unchanged.

#### 3. Check-email page

**File**: `src/pages/auth/confirm-email.astro` → `src/pages/auth/check-email.astro` (rename + rewrite)

**Intent**: Repurpose the post-signup "check your inbox" page as the post-request-link confirmation, personalized with the submitted email.

**Contract**: Reads `email` from `Astro.url.searchParams`. Copy changes to reflect a magic link rather than a confirmation link (e.g. "We've sent a sign-in link to **{email}**. Click it to continue."); drop the `isAutoConfirmed` dev-mode branching (`import.meta.env.DEV`) since it no longer applies. Link back to `/auth/signin`.

#### 4. Remove password UI

**Files**: `src/pages/auth/signup.astro`, `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`, `src/components/auth/PasswordToggle.tsx` (delete)

**Intent**: Fully superseded by `MagicLinkForm.tsx` and the merged `/auth/signin` page.

#### 5. Topbar sign-in link

**File**: `src/components/Topbar.astro`

**Intent**: Remove the now-nonexistent `/auth/signup` link from the signed-out state.

**Contract**: Signed-out branch keeps only the `/auth/signin` link; drop the `/auth/signup` link and its surrounding `gap-3` wrapper if it becomes a single child.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- `/auth/signin` renders a single email field, no password field, no "Sign up" link
- Submitting a valid email redirects to `/auth/check-email` and displays the submitted address
- `/auth/signup` returns 404
- Topbar's signed-out state shows exactly one auth link (sign in)
- `/dashboard` sign-out still redirects correctly and re-protects the route

---

## Phase 3: Branded magic-link email template

### Overview

Replace Supabase's default, unbranded magic-link email with a template stored in the codebase, applied to both local dev and the linked production project.

### Changes Required:

#### 1. Email template file

**File**: `supabase/templates/magic-link.html` (new)

**Intent**: Branded HTML email shown to the user instead of Supabase's generic "Magic Link / Log In" default.

**Contract**: Uses Supabase's `{{ .ConfirmationURL }}` template variable for the link. Plain, self-contained HTML (no external assets/CDN dependencies, consistent with email-client constraints) mentioning the app name and the 1-hour expiry window.

#### 2. Wire the template into config

**File**: `supabase/config.toml`

**Intent**: Point Supabase at the new template for the `magic_link` email type, for both local dev and (once pushed) production.

**Contract**: Add:
```toml
[auth.email.template.magic_link]
subject = "Your Resolution Circle sign-in link"
content_path = "./supabase/templates/magic-link.html"
```
No other `[auth]` fields change — `site_url`, `additional_redirect_urls`, rate limits, and `otp_expiry` stay as-is (see "What We're NOT Doing").

### Success Criteria:

#### Automated Verification:

- `npx supabase start` boots successfully with the updated `config.toml` (validates TOML syntax and that `content_path` resolves)

#### Manual Verification:

- Requesting a link locally produces an Inbucket email using the new branded copy, not Supabase's default template
- Before pushing: every field in the linked project's live Authentication dashboard settings is manually compared against `config.toml`'s `[auth]` block, and any drift is reconciled first (per "Critical Implementation Details → Supabase config push semantics")
- After `supabase config push` (or the project's documented push equivalent) to the linked remote project, the production Dashboard shows the updated magic-link template
- A real magic-link request against production delivers the branded email and successfully authenticates through `/api/auth/callback`

**Implementation Note**: Pause here for explicit manual confirmation before pushing config to the linked remote project — this is the one step in this plan with real production blast radius.

---

## Phase 4: Docs sync and full verification

### Overview

Bring `README.md` and `CLAUDE.md` back in sync with the new routes, then verify the complete user-facing journey end to end.

### Changes Required:

#### 1. README auth routes

**File**: `README.md`

**Intent**: Replace the stale password-flow route table and remove the now-inapplicable "Email confirmation in local development" section (that Supabase dashboard toggle only affects `signUp()`'s password flow, which no longer exists).

**Contract**: "Auth routes" table (currently lines 140-149) drops the `/auth/signup` row, updates `/auth/signin` and `/auth/confirm-email` → `/auth/check-email` descriptions to match the magic-link flow, and gains a short mention of the local Inbucket inbox (`http://127.0.0.1:54324`) for retrieving magic-link emails in dev.

#### 2. CLAUDE.md auth flow

**File**: `CLAUDE.md`

**Intent**: Keep the "Auth flow" section's file lists accurate.

**Contract**: Update the "API endpoints" and "Auth pages" bullet lines to list `src/pages/api/auth/{request-link,callback,signout}.ts` and `src/pages/auth/{signin,check-email}.astro` respectively.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`
- No stale references remain: `grep -rn "auth/signup\|SignUpForm\|PasswordToggle\|confirm-email" README.md CLAUDE.md src` returns no matches

#### Manual Verification:

- Full click-through as an unauthenticated visitor: land on `/auth/signin` → submit email → see `/auth/check-email` → retrieve the branded email from Inbucket (local) → click the link → land authenticated on `/dashboard`
- Sign out from `/dashboard`; confirm redirect, and that `/dashboard` immediately re-protects (redirects unauthenticated visitors to `/auth/signin`)
- Reuse an already-consumed or malformed link and confirm `/auth/signin` shows the friendly invalid/expired-link error rather than a raw error or a crash

---

## Testing Strategy

### Unit Tests:

- None added — no test framework exists in this repo (see "What We're NOT Doing"). Correctness is established through the automated lint/typecheck/build gates plus the manual verification steps in each phase.

### Integration Tests:

- None added, for the same reason. The Phase 1 curl-based manual checks and Phase 4 full click-through serve as the integration-level verification for this change.

### Manual Testing Steps:

1. Fresh visitor requests a magic link on `/auth/signin`, retrieves it from Inbucket, and authenticates successfully.
2. A second request within the rate-limit window shows the friendly rate-limit message.
3. An expired or already-used link redirects to `/auth/signin` with a friendly error, not a raw Supabase error or a broken page.
4. Signing out from `/dashboard` clears the session and re-protects the route.

## Performance Considerations

None beyond Supabase's own defaults (2 emails/hour rate limit, 1-hour OTP expiry) — both are kept as-is per "What We're NOT Doing."

## Migration Notes

None required. This is a pre-launch swap of the auth mechanism with no real end users yet (confirmed during planning); any existing password-based accounts in the linked project are test/dev data.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01: magic-link-auth)
- PRD: `context/foundation/prd.md` (FR-001, FR-002, FR-003, Access Control)
- Prior incident: `supabase-config-push-full-overwrite` (referenced in Critical Implementation Details)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Magic-link API routes

#### Automated

- [x] 1.1 Lint passes
- [x] 1.2 Type checking passes
- [x] 1.3 Build succeeds
- [x] 1.9 config.toml additional_redirect_urls allow-lists localhost + production callback paths (adaptation, see change.md Notes)

#### Manual

- [x] 1.4 curl to /api/auth/request-link redirects to /auth/check-email
- [x] 1.5 Magic-link email arrives in local Inbucket
- [x] 1.6 Clicking the link authenticates via /api/auth/callback and lands on /dashboard
- [x] 1.7 Invalid email is rejected before calling Supabase
- [x] 1.8 Rate-limited second request shows the friendly message

### Phase 2: Merged sign-in UI

#### Automated

- [ ] 2.1 Lint passes
- [ ] 2.2 Type checking passes
- [ ] 2.3 Build succeeds

#### Manual

- [ ] 2.4 /auth/signin shows a single email field, no password, no sign-up link
- [ ] 2.5 Valid submission redirects to /auth/check-email with the submitted address shown
- [ ] 2.6 /auth/signup returns 404
- [ ] 2.7 Topbar signed-out state shows exactly one auth link
- [ ] 2.8 /dashboard sign-out still works and re-protects the route

### Phase 3: Branded magic-link email template

#### Automated

- [ ] 3.1 supabase start boots with the updated config.toml

#### Manual

- [ ] 3.2 Local Inbucket email uses the new branded template
- [ ] 3.3 Live dashboard auth settings manually diffed against config.toml before push
- [ ] 3.4 Production Dashboard shows the updated template after push
- [ ] 3.5 Real magic-link request against production authenticates successfully

### Phase 4: Docs sync and full verification

#### Automated

- [ ] 4.1 Lint passes
- [ ] 4.2 Type checking passes
- [ ] 4.3 Build succeeds
- [ ] 4.4 No stale references to removed routes/components remain

#### Manual

- [ ] 4.5 Full click-through: signin → check-email → Inbucket → callback → dashboard
- [ ] 4.6 Sign-out clears session and re-protects /dashboard
- [ ] 4.7 Reused/malformed link shows the friendly error on /auth/signin
