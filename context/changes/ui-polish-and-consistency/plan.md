# UI Polish & Consistency (S-07) Implementation Plan

## Overview

Close roadmap slice S-07 by fixing four gaps surfaced while exercising the shipped Resolution Circle MVP (not derived from a PRD requirement): a boilerplate homepage, ad-hoc/missing navigation (including a dead-end `/dashboard`), inconsistent save/edit feedback, and English/Polish language mixing. Scope decided during planning: translate the whole app — including transactional email content — to Polish, matching the roadmap's stated outcome exactly rather than settling for a smaller consistency fix.

## Current State Analysis

- **Homepage** (`src/components/Welcome.astro`): unmodified Astro-starter boilerplate — hero reads "10x Astro Starter", a subtext blurb, three generic feature cards, and a stale "Astro 5, React 19, Tailwind 4" claim (project is actually on Astro 6). The CTA always links to `/auth/signin` regardless of auth state.
- **Navigation**: no centralized nav — `<Topbar/>` (`src/components/Topbar.astro`) is manually imported into `Welcome.astro`, `src/pages/goals/index.astro`, `src/pages/groups/index.astro`, and `src/pages/groups/[id].astro`. It's missing from `src/pages/dashboard.astro` (the primary post-sign-in landing page, currently a dead end with only a Sign-out button) and `src/pages/groups/join/[token].astro`.
- **Save/edit feedback**: goal creation and progress-recording already redirect with a query param (`?created=1`, `?progress=1`) that a banner in `goals/index.astro` renders. The "Manage goals" edit/delete flow (`src/pages/api/goals/manage.ts`) redirects bare to `/goals` on success with no confirmation at all.
- **Language**: the app is English everywhere except `src/lib/config-status.ts`'s Polish config-status banner (rendered globally via `src/layouts/Layout.astro`). No i18n framework exists; every string is a hardcoded literal in the component/route that uses it. Zod schemas never carry custom `message:` params — validation copy is separately hand-written English in each route/component.
- **Email content**: the group-leave notification (`src/lib/services/groups.ts`, sent via the Brevo REST service in `src/lib/services/email.ts`) and the Supabase-hosted magic-link/confirmation auth emails (`supabase/templates/*.html`, wired via `supabase/config.toml`) are English.
- No toast/alert library exists in the codebase (no `sonner`/`toast` component, no such dependency) — all feedback today is redirect + static colored banner.
- No automated test suite exists yet in this project (Module 2 stage); CI runs lint + build only.

### Key Discoveries:

- `src/pages/index.astro` is a thin wrapper — all homepage content lives in `src/components/Welcome.astro:35-118`.
- `src/components/Topbar.astro` reads `Astro.locals.user` directly rather than via a prop, so it can be rendered from anywhere (including centrally from `Layout.astro`) with no wiring changes.
- `src/layouts/Layout.astro:10,14` sets a default `title` ("10x Astro Starter") and `lang="en"`, both consumed on every page.
- `src/pages/api/goals/manage.ts:54,71` has two separate success-path bare redirects (delete, edit-save) that both need the new query param.
- `supabase/config.toml:229-235` wires the two Supabase auth email templates and duplicates their subject lines outside the `.html` files themselves.

## Desired End State

- The homepage shows real Resolution Circle content (no starter-kit branding, no stale framework-version claims) with a CTA that reads "Sign in" when logged out and points to `/goals` when logged in (decided during implementation: `/dashboard` has no real content of its own — just email + sign-out — so it isn't a fitting landing spot; it stays reachable via nav, just not as the primary CTA target).
- Every authenticated page — including `/dashboard` and the invite-join page — is reachable via a persistent nav bar, rendered once from `Layout.astro` rather than copy-pasted per page.
- Editing or deleting a goal shows a success banner, matching the existing create/progress banners.
- Every user-facing string in the app and in transactional emails reads in Polish, including validation and error messages.

Verified by: manual click-through of every page/flow listed in each phase's Manual Verification, plus `npm run lint` and `npm run build` passing throughout.

## What We're NOT Doing

- Not introducing a toast library or refactoring the plain-HTML "Track progress"/"Manage goals" forms into React islands — feedback stays on the existing redirect + banner pattern.
- Not adding pending/disabled submit-button state to the plain-HTML forms (kept out of scope; full-page redirect already gives an implicit in-flight cue).
- Not building an i18n framework or string dictionary — following the existing convention of hardcoded inline strings, just in Polish instead of English.
- Not touching the quarterly-digest email (S-05, not yet built) — it will inherit the Polish convention when it's built.
- Not adding richer marketing content (extra feature cards, screenshots) to the homepage beyond a minimal value-prop + adaptive CTA.
- Not splitting this into multiple roadmap slices or pre-deciding a scope cut — kept as one atomic S-07 delivery.

## Implementation Approach

Five phases, in dependency order: homepage content, then nav centralization (structural only — doesn't touch existing English strings), then the edit/delete feedback gap (introduces new strings, authored directly in Polish since the target language is already decided), then a single full-app Polish translation sweep of every remaining pre-existing English string (Phases 1 and 3's new copy is already Polish, so this phase only verifies those and translates everything else), and finally email content translation as its own phase because it carries a deploy-approval gate that the in-app phases don't.

## Critical Implementation Details

- **Deployment ordering & approval gate (Phase 5)**: `supabase/config.toml`'s `[auth]` block is pushed to the remote Supabase project via a config-push command, and a past incident on this project showed that push **overwrites the entire remote `[auth]` block**, not just the touched subject lines — any other remote-only auth settings not mirrored in the local file get silently reset. This is a destructive-adjacent, hard-to-reverse action affecting shared infrastructure: do not run any Supabase config-push command autonomously. Diff the local `[auth]` block against the current remote config before pushing, and get explicit user approval for the exact command before executing it.

## Phase 1: Homepage content refresh

### Overview

Replace the Astro-starter boilerplate in `Welcome.astro` with real Resolution Circle content, written directly in Polish (the target language decided during planning), and fix `Layout.astro`'s stale default title.

### Changes Required:

#### 1. Homepage content

**File**: `src/components/Welcome.astro`

**Intent**: Replace the "10x Astro Starter" hero, subtext, and three generic starter feature cards with a short Resolution Circle value-prop (immutable yearly goals, witnessed by a trusted circle) and a single CTA. The CTA must adapt to auth state: "Sign in" → `/auth/signin` when signed out, "Go to my goals" (or equivalent) → `/goals` when signed in. (`/dashboard` was considered as the signed-in target but rejected during implementation — it has no real content beyond email + sign-out, so `/goals` is the fitting landing spot; `/dashboard` stays reachable via nav, just not as the primary CTA.)

**Contract**: Read `Astro.locals.user` (add `const { user } = Astro.locals;` alongside the existing frontmatter) to branch the CTA. Remove the three feature-card `<div>` blocks entirely (lines ~51-118). New copy is authored in Polish.

#### 2. Default page title

**File**: `src/layouts/Layout.astro`

**Intent**: The default `title` prop fallback ("10x Astro Starter") is stale starter branding; the homepage is the only page that relies on it.

**Contract**: Change the default value in `const { title = "10x Astro Starter" } = Astro.props;` (line 10) to `"Resolution Circle"`.

#### 3. Post-sign-in default landing page

**File**: `src/pages/api/auth/callback.ts`

**Intent**: Scope extension discovered during Phase 1 manual verification — after a magic-link sign-in with no `next` param (e.g. via the homepage CTA), the user landed on `/dashboard`, which has no real content beyond a Sign-out button. Consistent with demoting `/dashboard` as a landing target above, the default fallback should also be `/goals`.

**Contract**: Change `return context.redirect(next ?? "/dashboard");` (line 31) to `return context.redirect(next ?? "/goals");`. The `next`-param redirect (used by the invite-join flow) is unaffected.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Visiting `/` shows Resolution Circle copy with no "Astro 5"/"10x Astro Starter"/generic feature-card text anywhere
- Signed out, the CTA reads "Sign in" and links to `/auth/signin`
- Signed in, the CTA links to `/goals` instead
- Signing in via magic link with no `next` param (e.g. from the homepage CTA) lands on `/goals`, not `/dashboard`

---

## Phase 2: Centralize navigation in Layout

### Overview

Move `<Topbar/>` rendering into `Layout.astro` so every page gets consistent nav automatically, removing the copy-paste-per-page pattern that left `/dashboard` and the invite-join page without any nav.

### Changes Required:

#### 1. Central nav render

**File**: `src/layouts/Layout.astro`

**Intent**: Render the nav bar once, centrally, for every page that uses this layout.

**Contract**: Import `Topbar` and render `<Topbar />` inside `<body>`, after the `missingConfigs` banner block and before `<slot />`. No prop wiring needed — `Topbar` reads `Astro.locals.user` directly.

#### 2. Remove duplicate Topbar usages

**Files**: `src/components/Welcome.astro`, `src/pages/goals/index.astro`, `src/pages/groups/index.astro`, `src/pages/groups/[id].astro`

**Intent**: Each of these pages currently imports and renders `<Topbar/>` manually; once `Layout.astro` renders it centrally, these become duplicates and must be removed to avoid showing the nav bar twice per page.

**Contract**: Remove the `Topbar` import and its `<Topbar />` usage from each file; leave the rest of each page's content untouched.

No code change is required for `src/pages/dashboard.astro` or `src/pages/groups/join/[token].astro` — both gain nav automatically once Phase 2 lands, since both already use `Layout.astro`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `/dashboard` now shows the nav bar and can reach Goals/Groups/Sign-out from it (previously a dead end)
- `/groups/join/<token>` shows the nav bar too
- Homepage, `/goals`, `/groups`, and `/groups/[id]` each show exactly one nav bar (no visual duplication)
- Sign-in and check-email pages show the "Not signed in" nav state, unaffected by this change

---

## Phase 3: Consistent save/edit feedback

### Overview

Close the one gap in an otherwise-consistent feedback pattern: editing or deleting a goal currently gives no success confirmation, unlike creating a goal or recording progress.

### Changes Required:

#### 1. Redirect with a new success param

**File**: `src/pages/api/goals/manage.ts`

**Intent**: Both success paths (delete, edit-save) should redirect with a query param the page can key a banner off, matching the existing `?created=1`/`?progress=1` pattern.

**Contract**: Change both success-path `return context.redirect("/goals")` calls (delete path and edit-save path) to `return context.redirect("/goals?updated=1")`.

#### 2. Render the confirmation banner

**File**: `src/pages/goals/index.astro`

**Intent**: Show a success banner when the new param is present, styled identically to the existing `created`/`progressSaved` banners, with fresh Polish copy (the target language is already decided).

**Contract**: Add `const updated = Astro.url.searchParams.get("updated") === "1";` and a conditional banner block alongside the existing `created`/`progressSaved` blocks, reusing the same Tailwind classes.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Editing a goal's description or target and saving shows a success banner
- Deleting a goal shows the same success banner
- The banner is styled consistently with the existing create/progress banners

---

## Phase 4: Full in-app Polish translation

### Overview

Sweep every remaining English user-facing string in the application — excluding email content, covered in Phase 5 — to Polish, following the existing hardcoded-inline-string convention (no i18n framework introduced). This phase runs last so it also verifies Phases 1 and 3's already-Polish new copy and catches anything else outstanding.

### Changes Required:

#### 1. Layout language attribute

**File**: `src/layouts/Layout.astro`

**Intent**: The document's declared language must match its content.

**Contract**: Change `<html lang="en">` (line 14) to `<html lang="pl">`.

#### 2. Navigation labels

**File**: `src/components/Topbar.astro`

**Intent**: Translate every nav label and state string ("Dashboard", "My Goals", "My Groups", "Sign out", "Not signed in", "Sign in") to Polish.

**Contract**: Inline string replacement only; no structural change.

#### 3. Dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Translate the heading, welcome text, helper text, and "Sign out" button to Polish.

#### 4. Goals page

**File**: `src/pages/goals/index.astro`

**Intent**: Translate all headings ("My Goals", "Commit new goals", "Track progress", "Manage goals (editable for 24h)", "Locked goals"), empty-state copy, measure labels ("Target: …", "Yes / no"), button text ("Save progress", "Save changes", "Delete"), and the pre-existing `created`/`progress` banner copy to Polish. (The Phase 3 `updated` banner is already Polish.)

#### 5. Goal creation form

**File**: `src/components/goals/GoalBundleForm.tsx`

**Intent**: Translate all labels, placeholders, buttons, and validation messages ("Description is required", "Enter a positive target", "Add another goal", "Remove", "Committing…"/"Commit goals", field labels and placeholders) to Polish.

#### 6. Auth pages and form

**Files**: `src/pages/auth/signin.astro`, `src/pages/auth/check-email.astro`, `src/components/auth/MagicLinkForm.tsx`

**Intent**: Translate headings, confirmation copy, "Back to sign in", form label/placeholder, validation messages, and button states ("Sending link…"/"Continue with email") to Polish.

#### 7. Groups pages

**Files**: `src/pages/groups/index.astro`, `src/pages/groups/[id].astro`, `src/pages/groups/join/[token].astro`

**Intent**: Translate all headings, "Create a group" form (label, placeholder, button), empty-state copy, "You left the group.", invite-link section ("Invite link", share instructions, "Members", "joined …", "Leave group"), and the join-page strings (invalid-link message, invite heading, "Sign in before joining", "You're already a member — go to group", "Join") to Polish.

#### 8. API error and validation messages

**Files**: `src/pages/api/auth/request-link.ts`, `src/pages/api/auth/callback.ts`, `src/pages/api/goals/index.ts`, `src/pages/api/goals/progress.ts`, `src/pages/api/goals/manage.ts`, `src/pages/api/groups/index.ts`, `src/pages/api/groups/join.ts`, `src/pages/api/groups/leave.ts`

**Intent**: Translate every hardcoded user-facing error/validation string in these routes (rate-limit message, invalid-link/invite messages, "Supabase is not configured", per-field validation messages, "X goal(s) could not be saved/updated", "Invalid group", "You are not a member of that group") to Polish.

#### 9. Service-layer fallback message

**File**: `src/lib/services/groups.ts`

**Intent**: Translate the `"Failed to create group"` fallback error literal to Polish.

Explicitly not touched: `src/lib/config-status.ts` is already Polish — leave as-is; confirm during manual verification that its wording still reads naturally now that the surrounding UI is Polish too.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Repo-wide grep for a sample of the inventoried English literals (e.g. "Sign in", "Sign out", "Delete", "Create a group") returns no matches outside code/comments

#### Manual Verification:

- Click through every page (homepage, dashboard, goals, groups list, group detail, join-by-invite, sign-in, check-email) both signed in and signed out — no English user-facing text remains
- Trigger each validation/error path (invalid email, empty goal description, expired edit window, invalid invite token, non-member leave attempt) and confirm every banner/message is in Polish

---

## Phase 5: Email content Polish translation

### Overview

Translate the two email surfaces the app controls — the Brevo-sent group-leave notification and the Supabase-hosted magic-link/confirmation auth email templates — to Polish, completing the "consistent Polish" outcome across every channel a user encounters, not just in-app.

### Changes Required:

#### 1. Group-leave notification content

**File**: `src/lib/services/groups.ts`

**Intent**: Translate the `notifyGroupOfDeparture()` subject, HTML body, and plain-text body to Polish.

**Contract**: Keep the same template-literal structure, interpolating `departedEmail`/`groupName` as today; only the surrounding copy changes language.

#### 2. Leave-flow fallback display name

**File**: `src/pages/api/groups/leave.ts`

**Intent**: Translate the `"A member"` fallback display name (used in the notification email body when `user.email` is missing) to its Polish equivalent. Coordinate with Phase 4's pass over this same file — do this string in whichever phase lands second to avoid duplicate edits.

#### 3. Magic-link email template

**File**: `supabase/templates/magic-link.html`

**Intent**: Translate the title, brand line, body copy, button label, and footer disclaimer to Polish.

#### 4. Confirmation email template

**File**: `supabase/templates/confirmation.html`

**Intent**: Same translation as the magic-link template, keeping this template's distinct button label ("Confirm email & sign in" → its Polish equivalent).

#### 5. Email subject lines in Supabase config

**File**: `supabase/config.toml`

**Intent**: Translate the two `subject = "Your Resolution Circle sign-in link"` lines (`[auth.email.template.magic_link]`, `[auth.email.template.confirmation]`) to Polish, matching the templates above.

**Implementation Note**: After completing the code/template changes above and all automated verification passes, pause here for explicit user approval of the exact Supabase config-push command before running it — see Critical Implementation Details.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Request a magic-link email and confirm it renders correctly in Polish
- Trigger a group-leave and confirm the notification email renders correctly in Polish
- Before pushing `config.toml` changes to the remote Supabase project: get explicit user approval for the exact push command, diff the local `[auth]` block against current remote config first, then after pushing verify the live subject line changed without other remote auth settings reverting

---

## Testing Strategy

No automated test suite exists in this project yet (Module 2 stage — CI runs lint + build only). Verification relies on `npm run lint` / `npm run build` passing at every phase plus the manual click-through steps listed per phase above.

### Manual Testing Steps:

1. Walk every route signed out, then signed in, confirming nav, homepage CTA, and language per the phase checklists above.
2. Exercise every form's error path (empty/invalid input, expired edit window, invalid invite token) to confirm Polish error messages.
3. Confirm the create → progress → edit/delete → email flows all show consistent, Polish-language success feedback end to end.

## Performance Considerations

None — this change is content/copy edits, a redirect query-param addition, and a component-render relocation; no new dependencies or data-flow changes.

## Migration Notes

No data migration. Phase 5's Supabase email-template and config changes require a config push to the remote Supabase project, gated on explicit user approval (see Critical Implementation Details).

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-07 (`ui-polish-and-consistency`)
- Existing feedback pattern to match: `src/pages/goals/index.astro` (created/progress banners), `src/pages/api/goals/{index,progress}.ts` (redirect-with-param convention)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Homepage content refresh

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Build passes: `npm run build`

#### Manual

- [x] 1.3 Visiting `/` shows Resolution Circle copy with no starter/feature-card text anywhere
- [x] 1.4 Signed out, CTA reads "Sign in" and links to `/auth/signin`
- [x] 1.5 Signed in, CTA links to `/goals` instead
- [x] 1.6 Signing in via magic link with no `next` param lands on `/goals`, not `/dashboard`

### Phase 2: Centralize navigation in Layout

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`

#### Manual

- [ ] 2.3 `/dashboard` shows the nav bar and can reach Goals/Groups/Sign-out
- [ ] 2.4 `/groups/join/<token>` shows the nav bar
- [ ] 2.5 Homepage, `/goals`, `/groups`, `/groups/[id]` each show exactly one nav bar
- [ ] 2.6 Sign-in/check-email pages show the "Not signed in" nav state unaffected

### Phase 3: Consistent save/edit feedback

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Build passes: `npm run build`

#### Manual

- [ ] 3.3 Editing a goal and saving shows a success banner
- [ ] 3.4 Deleting a goal shows the same success banner
- [ ] 3.5 Banner styled consistently with create/progress banners

### Phase 4: Full in-app Polish translation

#### Automated

- [ ] 4.1 Lint passes: `npm run lint`
- [ ] 4.2 Build passes: `npm run build`
- [ ] 4.3 Repo-wide grep for sample English literals returns no matches outside code/comments

#### Manual

- [ ] 4.4 Every page, signed in and signed out, shows no remaining English user-facing text
- [ ] 4.5 Every validation/error path shows a Polish message

### Phase 5: Email content Polish translation

#### Automated

- [ ] 5.1 Lint passes: `npm run lint`
- [ ] 5.2 Build passes: `npm run build`

#### Manual

- [ ] 5.3 Magic-link email renders correctly in Polish
- [ ] 5.4 Group-leave notification email renders correctly in Polish
- [ ] 5.5 Config-push to remote Supabase approved by user, diffed beforehand, and verified afterward with no other remote auth settings reverted
