# Form and Manage a Group Implementation Plan

## Overview

Implement FR-008–011 (roadmap S-02): an authenticated user can create a named group, invite others via a shareable link, accept an invite (including as a brand-new user with no account yet), and leave a group — with remaining members notified by email via F-02's `sendEmail`. Built on F-01 (magic-link auth) and F-02 (email infrastructure), both done.

## Current State Analysis

- No group/membership schema exists at all — `supabase/migrations/` has only `20260829164522_create_goals.sql` (S-01's goals table).
- No cross-user identity resolution exists. `auth.users` is not exposed via Supabase's Data API (standard Supabase behavior), and every existing identity display (`Topbar.astro`, `dashboard.astro`) only ever shows the *current* session's own `user.email` — there is no precedent for showing another user's identity, which S-02 needs for the member list and the invite confirm screen.
- The magic-link auth flow (`src/pages/auth/signin.astro` → `src/components/auth/MagicLinkForm.tsx` → `src/pages/api/auth/request-link.ts` → `src/pages/api/auth/callback.ts`) has no concept of "return to X after sign-in" — `request-link.ts` hardcodes `emailRedirectTo` to `/api/auth/callback` with no extra params, and `callback.ts` hardcodes the post-auth redirect to `/dashboard`.
- `src/middleware.ts`'s `PROTECTED_ROUTES` gate (`["/dashboard", "/goals"]`) redirects an unauthenticated visitor straight to `/auth/signin` with no memory of what they were trying to reach.
- `src/lib/services/goals.ts` and `src/pages/api/goals/*` establish the conventions this plan follows: a null-fallback Supabase client (`src/lib/supabase.ts`), zod-validated form-POST endpoints with `export const prerender = false`, and plain `- [ ]`-less service functions returning `{ updated, skipped }`-shaped results.
- `src/lib/services/email.ts` (F-02) exports `sendEmail({ to, subject, heading, bodyHtml, text })` — single-recipient, never throws, no-ops when Brevo isn't configured.

## Desired End State

An authenticated user can create a group by name, see it listed on `/groups`, open `/groups/[id]` to see its members and a shareable invite link, and leave it. Someone who receives the invite link — whether they already have an account or not — sees a confirm screen naming the group and its creator **before** being asked to sign in (revised 2026-08-31 — see Critical Implementation Details), and joining requires an explicit click plus an authenticated identity. When a member leaves, every remaining member receives an email. Renaming is explicitly out of scope (PRD Non-Goals, revised 2026-08-31).

Verify by: creating a group as user A, inviting user B (who has never signed in before) via the link, confirming B lands on the confirm screen after completing magic-link sign-up, B joins, both A and B see each other in the member list, B leaves, and A receives an email about it.

### Key Discoveries:

- Postgres RLS on a table cannot safely reference that same table in its own `USING` clause without recursion — `group_members`' "let a member see their fellow members" policy would otherwise throw `infinite recursion detected in policy for relation "group_members"`. The fix (a `SECURITY DEFINER` helper function) is detailed in Critical Implementation Details.
- Because this app's Supabase key is the browsable `authenticated`-role key (not a server-only service key), RLS is the *only* real access gate — a plain `using (true)` SELECT policy on `groups` would let any authenticated user enumerate every group's `invite_token` directly via the client SDK. Invite preview/join must go through narrow `SECURITY DEFINER` RPC functions instead of a permissive SELECT policy.
- `goals.user_id` and (by the same convention) `group_members.user_id`/`groups.created_by` intentionally have no `ON DELETE` action — matching S-01's precedent of forcing a future account-deletion feature (S-06) to explicitly handle detachment rather than silently cascading.

## What We're NOT Doing

- No group renaming — removed from FR-008 during this planning session (see PRD Non-Goals).
- No per-invite tracking, expiry, or revocation — one standing, reusable `invite_token` per group (Prerequisites: F-01, F-02 only).
- No deletion of a group when its last member leaves — the row persists, matching S-01's "don't build cleanup for a cosmetic concern" precedent.
- No group-shared goals, no in-app notification banners for the leave event — the departure notice is a real email (F-02), not a persisted in-app record (superseding an earlier, reverted draft of this decision).
- No changes to `updateGoals`/`deleteGoal`/the 24h edit window — entirely separate domain.
- No admin/owner role — flat membership per PRD Access Control.

## Implementation Approach

Follow S-01's established layering (migration → types/service → API → UI) across four phases. Introduce `profiles` as shared identity infrastructure now rather than have S-03 solve the identical problem later. Keep the two security-sensitive operations (pre-membership preview, token-based join) behind `SECURITY DEFINER` RPC functions instead of permissive RLS, and keep everything else (create, leave, list) as plain RLS-gated queries following `goals.ts`'s existing style.

## Critical Implementation Details

**State sequencing (RLS self-reference)**: `group_members`' SELECT policy ("a member can see the membership rows of every group they belong to") must NOT be written as a raw subquery against `group_members` itself — Postgres detects the self-reference and raises `infinite recursion detected in policy for relation "group_members"` at query time, not at migration time, making this easy to ship broken and only discover under real multi-member testing. The fix: a `public.is_member_of(p_group_id uuid, p_user_id uuid) returns boolean` function marked `security definer stable`, called from inside the policy. Because the function runs with definer privileges, its internal query against `group_members` bypasses RLS instead of re-triggering the same policy. Reuse the same function in `groups`' SELECT policy for consistency, even though that one isn't self-referential.

**Found during Phase 1 implementation (2026-08-31): `create_group`'s own `RETURNING` clause fails RLS.** `create_group`'s first statement is `insert into groups (...) values (...) returning id into v_group_id`. Postgres re-checks the table's SELECT policy against any row produced by `INSERT ... RETURNING`, and raises `new row violates row-level security policy` (not a silent empty result) if that row isn't visible. At that exact point the caller isn't a `group_members` row yet — that's the function's *second* statement — so `groups_select_member` alone always rejects it, meaning `create_group` would fail on every real call. Fix: a second permissive `groups` SELECT policy, `groups_select_own_created` (`using (auth.uid() = created_by)`), so a creator can always see a group they created regardless of current membership. Multiple permissive policies for the same command combine with `OR` in Postgres RLS, so this doesn't weaken `groups_select_member`, it only adds the one case `create_group` needs. This preserves the plan's original choice to keep `create_group` as invoker-rights (no `SECURITY DEFINER`) rather than switching it to bypass RLS entirely.

**Security model (token-based preview/join)**: `groups` gets no general-purpose "anyone can see a group by token" SELECT policy — RLS can't distinguish "the client happened to filter by token" from "the client is scanning the whole table," and this app's Supabase key is client-visible. Instead, `get_group_preview(p_invite_token uuid)` and `join_group_by_token(p_invite_token uuid)` are `SECURITY DEFINER` functions that look up the *one* row matching the exact token argument and never expose more. `join_group_by_token` re-derives `group_id` from the token server-side and uses `ON CONFLICT (group_id, user_id) DO NOTHING` so re-clicking an already-used invite link is a harmless no-op, not an error.

Both RPC functions get `revoke execute ... from public` before their `grant ... to authenticated` — Postgres grants `EXECUTE` to `PUBLIC` by default on function creation, so without the explicit revoke, `anon` would retain callable access via that default grant regardless of the narrower grant that follows. `is_member_of` and `create_group` get the same revoke-then-grant treatment, restricted to `authenticated` only.

**Revised 2026-08-31 (discussed during Phase 1 implementation): `get_group_preview` is deliberately re-granted to `anon`, not just `authenticated`.** The invite-confirm screen must show the group name and creator's email to whoever holds the exact token *before* asking them to sign in — forcing sign-up before any context is shown is worse UX for a brand-new invitee and works against the product's "witnessed by someone you trust" framing. This is safe: the function only ever returns the one row whose `invite_token` exactly matches the argument (never an enumerable scan), and `already_member` correctly evaluates to `false` for `anon` since `auth.uid()` is null. `join_group_by_token` stays `authenticated`-only — joining requires a real identity, and an anon call to it would additionally fail `group_members.user_id`'s `not null` constraint since `auth.uid()` is null for that role.

**Timing & lifecycle (invite survives sign-up)**: an invite link must work for a visitor with no account yet. This requires threading a `next` path through three files that don't currently know about each other: `signin.astro` reads `?next=`, passes it to `MagicLinkForm`; the form adds it as a hidden field to its existing POST; `request-link.ts` appends it to the `emailRedirectTo` URL passed to `supabase.auth.signInWithOtp` (Supabase preserves that URL's query string, appending its own `code` param); `callback.ts` reads `next` back out after `exchangeCodeForSession` and redirects there instead of the hardcoded `/dashboard`. `src/middleware.ts`'s protected-route redirect gets the same treatment generically (not just for `/groups/join/*`), since any protected route hit while signed out should return the visitor to where they were headed. A shared `sanitizeNextPath` helper (reject anything not starting with a single `/`, reject `//...`) guards all three read sites against open-redirect abuse.

## Phase 1: Database schema & RLS

### Overview

One migration: `groups`, `group_members`, `profiles` (+ auth trigger), RLS policies, and the RPC functions the rest of the plan depends on.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/<timestamp>_create_groups.sql` (new)

**Intent**: Establish the full schema this slice needs in one migration, matching `20260829164522_create_goals.sql`'s structure (explicit grants, per-operation RLS policies, descriptive comments).

**Contract**:

- `public.groups (id uuid pk default gen_random_uuid(), name varchar(255) not null check non-blank, invite_token uuid not null default gen_random_uuid() unique, created_by uuid not null references auth.users(id), created_at timestamptz not null default now())`. Grants: `select, insert` to `authenticated`/`service_role` (no `update`/`delete` — renaming is out of scope, groups are never deleted by app code).
- `public.group_members (group_id uuid not null references public.groups(id) on delete cascade, user_id uuid not null references auth.users(id), joined_at timestamptz not null default now(), primary key (group_id, user_id))`. Grants: `select, insert, delete` to `authenticated`/`service_role`.
- `public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text not null, created_at timestamptz not null default now())`. Grants: `select` to `authenticated`; `select, insert` to `service_role`.
- `public.is_member_of(p_group_id uuid, p_user_id uuid) returns boolean language sql security definer stable` — the RLS-recursion-avoidance helper described in Critical Implementation Details. Used by both `groups`' and `group_members`' SELECT policies.
- RLS policies: `groups_select_member` (via `is_member_of`), `groups_select_own_created` (`using (auth.uid() = created_by)` — added during Phase 1 implementation, see Critical Implementation Details, required for `create_group`'s `RETURNING` to succeed), `groups_insert_own` (`with check (auth.uid() = created_by)`); `group_members_select_fellow_members` (via `is_member_of`), `group_members_insert_own` (`with check (auth.uid() = user_id)` — used by `create_group`'s self-membership insert), `group_members_delete_own` (`using (auth.uid() = user_id)` — the leave action); `profiles_select_self_or_shared_group` (`auth.uid() = id` OR exists a shared `group_members` row).
- `public.handle_new_user()` trigger function (`security definer`) + `on_auth_user_created after insert on auth.users` trigger, inserting `(new.id, new.email)` into `profiles` — the standard Supabase profile-sync pattern. **Accepted limitation**: this only fires on insert, not on an email change — `profiles.email` would go stale if a user ever changes their auth email. No email-change feature exists anywhere in this app today, so this is a deliberate, accepted gap, not an oversight; revisit if such a feature is ever built.
- `public.create_group(p_name text) returns uuid language plpgsql` (no `security definer` needed — both statements are actions the caller is already allowed to perform under existing RLS): inserts into `groups` then `group_members` for `auth.uid()` in one transaction, returning the new group's id. Wrapping both inserts in a function (rather than two sequential client-side inserts) prevents an orphaned group with no members if the second insert ever failed.
- `public.get_group_preview(p_invite_token uuid) returns table (group_id uuid, group_name text, creator_email text, already_member boolean) language sql security definer stable`: joins `groups`/`profiles` by `invite_token`, computing `already_member` via an `exists` check against `group_members` for `auth.uid()`.
- `public.join_group_by_token(p_invite_token uuid) returns uuid language plpgsql security definer`: resolves `group_id` from the token (returns `null` if not found), then `insert ... on conflict (group_id, user_id) do nothing`, returning the resolved `group_id`.
- `revoke execute ... from public` on `is_member_of`, `create_group`, `get_group_preview`, `join_group_by_token` (Postgres grants execute to `public` by default on function creation; without the explicit revoke, `anon` retains callable access to these `security definer` functions regardless of the grants below). `grant execute` on `is_member_of`, `create_group`, `join_group_by_token` to `authenticated`. `grant execute` on `get_group_preview` to `authenticated` **and** `anon` (revised 2026-08-31 — see Critical Implementation Details: the invite-confirm screen must preview the group before requiring sign-in).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` (or `npx supabase migration up` against local dev)
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- In Supabase Studio (local), confirm all three tables exist with the expected columns/constraints and the four functions are listed under Database → Functions
- As one test user, call `select * from group_members` after belonging to a group with a second test user, and confirm no "infinite recursion" error and both members' rows are visible
- Call `get_group_preview` with a valid token as a non-member and confirm it returns a row without needing membership; call it with a bogus token and confirm zero rows

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Types & service layer

### Overview

Shared types and the `groups` service module, including the leave-email integration with F-02.

### Changes Required:

#### 1. Shared types

**File**: `src/types.ts`

**Intent**: Add the entity/DTO shapes for groups, mirroring the existing `Goal`/`CreateGoalCommand` style.

**Contract**: `Group { id, name, inviteToken, createdBy, createdAt }`; `GroupMember { userId, email, joinedAt }`; `GroupDetail extends Group { members: GroupMember[] }`; `GroupPreview { groupId, groupName, creatorEmail, alreadyMember }`; `CreateGroupCommand { name: string }`.

#### 2. Groups service

**File**: `src/lib/services/groups.ts` (new)

**Intent**: One function per operation, each a thin, typed wrapper around the RPC/table access designed in Phase 1 — no business logic duplicated here that the database already enforces.

**Contract**:
- `listMyGroups(supabase, userId): Promise<Group[]>` — groups the user belongs to (RLS already scopes this; no extra `.eq` needed beyond ordering).
- `getGroupDetail(supabase, groupId): Promise<GroupDetail | null>` — the group row plus its `group_members` joined against `profiles` for each member's email (RLS naturally restricts this to groups the caller belongs to).
- `createGroup(supabase, name): Promise<{ success: true; groupId: string } | { success: false; error: string }>` — calls the `create_group` RPC.
- `previewInvite(supabase, token): Promise<GroupPreview | null>` — calls `get_group_preview`.
- `joinGroup(supabase, token): Promise<string | null>` — calls `join_group_by_token`, returning the joined group's id or `null` for an invalid token.
- `leaveGroup(supabase, userId, groupId): Promise<boolean>` — deletes the caller's own `group_members` row (`.eq("group_id", groupId).eq("user_id", userId)`, mirroring `deleteGoal`'s ownership-scoped delete), returns whether a row was actually removed. **Ordering constraint**: the caller (`leave.ts`) MUST call `getGroupDetail(groupId)` and capture its `name`/`members` BEFORE calling `leaveGroup` — `group_members`' SELECT policy requires current membership, so once this delete removes the caller's own row, that same caller's session can no longer see the group's name or member list at all (RLS would return nothing). There is no "fetch afterward" option; the pre-delete snapshot is the only data source.
- `notifyGroupOfDeparture(groupName: string, departedEmail: string, recipientEmails: string[]): Promise<void>` — takes an already-resolved recipient list (no `supabase`/`groupId` params, no query of its own) and calls F-02's `sendEmail` once per entry in `recipientEmails` with a heading like `"${departedEmail} left ${groupName}"`, dispatched via `Promise.all` rather than a sequential loop — `sendEmail` has no per-call timeout, so awaiting each send one at a time would make the leave action's latency the sum of every recipient's send time instead of just the slowest one. The caller (`leave.ts`) computes `recipientEmails` by taking the pre-delete `getGroupDetail` member list and filtering out `departedEmail`. Never throws — `sendEmail` itself already swallows failures.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

No manual verification for this phase — covered by Phase 3's endpoint-level manual tests, since these functions have no UI of their own yet. Once automated checks pass, proceed directly to Phase 3 with no manual-confirmation pause.

---

## Phase 3: API routes + auth callback threading

### Overview

The three mutation endpoints, plus the `next`-path threading that lets an invite link survive a brand-new user's sign-up.

### Changes Required:

#### 1. Shared redirect-path guard

**File**: `src/lib/utils.ts`

**Intent**: One small helper reused by `middleware.ts`, `request-link.ts`, and `callback.ts` to prevent an open-redirect via a maliciously crafted `next` value.

**Contract**: `export function sanitizeNextPath(value: string | null): string | null` — returns `value` only if it starts with exactly one `/` (not `//`) and contains no `://`; otherwise `null`.

#### 2. Create group endpoint

**File**: `src/pages/api/groups/index.ts` (new)

**Intent**: Form-POST create, following `goals/index.ts`'s exact shape (auth check, zod validate, service call, redirect).

**Contract**: zod schema `{ name: z.string().trim().min(1).max(255) }`. On success, redirect to `/groups/<groupId>`; on failure, `/groups?error=...`.

#### 3. Leave endpoint

**File**: `src/pages/api/groups/leave.ts` (new)

**Intent**: Form-POST leave. Fetches the group's name and member list *before* deleting the caller's membership (see `leaveGroup`'s ordering constraint in Phase 2 — this is not optional, RLS blocks the same lookup afterward), then deletes, then notifies.

**Contract**: form field `groupId` (`z.uuid()`). Sequence: `getGroupDetail(groupId)` → `leaveGroup(userId, groupId)` → on success, `notifyGroupOfDeparture(groupName, callerEmail, remainingEmails)` where `remainingEmails` is the pre-fetched member list with the caller's own email filtered out. Redirect to `/groups?left=1`; if the delete affected no rows (not a member), redirect with an error.

#### 4. Join endpoint

**File**: `src/pages/api/groups/join.ts` (new)

**Intent**: Form-POST accept, backing the confirm screen's "Join" button. Since the confirm *page* (Phase 4, revised 2026-08-31) no longer sits behind the auth middleware — it must render for signed-out visitors too — this endpoint is now the actual auth enforcement point for the join action itself, not just a formality.

**Contract**: auth check first, same inline pattern as `goals/index.ts` (`if (!user) return context.redirect("/auth/signin")`) — the confirm page never renders a Join *form* for a signed-out visitor (it renders a sign-in link instead, see Phase 4), so reaching this endpoint unauthenticated only happens via a direct/crafted POST, and a plain sign-in redirect (no `next` needed) is sufficient. Form field `token` (`z.uuid()`). On a resolved group id, redirect to `/groups/<groupId>`; on `null` (invalid token), redirect to `/groups?error=...`.

#### 5. Auth callback threading

**File**: `src/pages/api/auth/callback.ts`

**Intent**: Preserve an invite (or any protected-route) destination through the magic-link round trip, instead of always landing on `/dashboard`.

**Contract**: read `next` from `context.url.searchParams`, pass through `sanitizeNextPath`; redirect there if present and valid, else `/dashboard` (unchanged default).

#### 6. Request-link threading

**File**: `src/pages/api/auth/request-link.ts`

**Intent**: Carry the visitor's `next` value into the magic link itself via Supabase's `emailRedirectTo`.

**Contract**: read an optional `next` form field, sanitize it, and if present append it as a query param on the `emailRedirectTo` URL passed to `signInWithOtp` (e.g. `.../api/auth/callback?next=<encoded>`).

#### 7. Sign-in page + form threading

**File**: `src/pages/auth/signin.astro`, `src/components/auth/MagicLinkForm.tsx`

**Intent**: Read `?next=` on the sign-in page and carry it through the form's existing POST as a hidden field.

**Contract**: `signin.astro` passes `next={Astro.url.searchParams.get("next")}` to `MagicLinkForm`; the form renders `<input type="hidden" name="next" value={next} />` when present.

#### 8. Middleware redirect threading

**File**: `src/middleware.ts`

**Intent**: Any protected route hit while signed out returns the visitor to where they were headed after they sign in — a natural generalization for every protected route. **Revised 2026-08-31**: `/groups/join/[token]` is deliberately *excluded* from this gate — the invite-confirm page must render its preview for a signed-out visitor (see Phase 4), and only the actual Join action requires auth. The `next`-threading mechanism (this item) is still exactly what carries a visitor from that page's own "Sign in to join" link back to itself after auth.

**Contract**: change the unauthenticated redirect from `context.redirect("/auth/signin")` to `context.redirect(\`/auth/signin?next=${encodeURIComponent(context.url.pathname + context.url.search)}\`)`. Add `/groups` to `PROTECTED_ROUTES`, but exempt any path starting with `/groups/join` from the gate via a short exception list checked before the protected-route match (e.g. `const PUBLIC_EXCEPTIONS = ["/groups/join"];` and skip the redirect when `PUBLIC_EXCEPTIONS.some((p) => pathname.startsWith(p))`) — `/groups` (the list page) and `/groups/[id]` (detail) stay fully gated.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- As a signed-in user, create a group via the endpoint (curl or a temporary form) and confirm both `groups` and `group_members` rows exist
- As a second signed-in test user with a valid invite token, POST to the join endpoint and confirm a `group_members` row appears; POST again with the same token and confirm no error (idempotent) and no duplicate row
- As a member, POST to leave and confirm the `group_members` row is gone and (with `BREVO_API_KEY` configured) an email arrives for any remaining member
- Sign out, visit `/groups/join/<a-real-token>`, confirm the page renders the preview directly with no redirect (revised 2026-08-31); click "Sign in to join", confirm redirect to `/auth/signin?next=%2Fgroups%2Fjoin%2F<token>`, request a magic link, click it, and confirm landing back on the join page (now showing a Join button) rather than `/dashboard`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: UI

### Overview

The three pages, plus nav/middleware wiring.

### Changes Required:

#### 1. Groups list + create

**File**: `src/pages/groups/index.astro` (new)

**Intent**: List the user's groups (name, member count, link to detail) and a create-group form, following `goals/index.astro`'s layout conventions (Topbar, `bg-cosmic` container, banner for `?error=`).

**Contract**: server-fetches `listMyGroups`; renders a plain `<form method="POST" action="/api/groups">` with a `name` input, matching the create-goal form's styling.

#### 2. Group detail

**File**: `src/pages/groups/[id].astro` (new)

**Intent**: Show the group's name, its members (email + joined date), the shareable invite link, and a leave button.

**Contract**: server-fetches `getGroupDetail(id)`; the invite link is `new URL(\`/groups/join/${group.inviteToken}\`, Astro.url.origin)`; leave is a `<form method="POST" action="/api/groups/leave">` with a hidden `groupId` field.

**Accepted risk (plan review, 2026-08-31)**: no explicit "not found / not a member" branch is specified for when `getGroupDetail` returns `null` (a non-member visiting another group's URL directly — RLS returns nothing). Unlike the join-confirm page, this contract doesn't handle it, so the page will likely render with a null group and surface an ungraceful error rather than a friendly message. No data is exposed either way (RLS already blocks it) — this is a UX polish gap, not a security gap — and is deferred rather than fixed now because it requires an actual, deliberately-crafted URL to hit (not a flow any real user path leads to).

#### 3. Invite confirm screen

**File**: `src/pages/groups/join/[token].astro` (new)

**Intent**: The explicit-accept screen. **Revised 2026-08-31**: no longer relies on `middleware.ts`'s protection to guarantee `Astro.locals.user` — this route is now exempted from the auth gate (Phase 3) so a signed-out visitor sees the invite preview immediately, before being asked to sign in. The page branches explicitly on `Astro.locals.user` instead.

**Contract**: validate `Astro.params.token` with `z.uuid()` before calling `previewInvite` — a malformed (non-UUID) value is treated identically to a not-found token, rather than reaching `get_group_preview`'s uuid-typed RPC parameter and surfacing a raw Postgres/PostgREST error. Server-calls `previewInvite(token)` regardless of auth state (the RPC is callable by `anon` too, per Phase 1's revised grant). If `null` (or the token failed UUID validation), render "This invite link is invalid" — for anyone, signed in or not. Otherwise render `"You've been invited to join <groupName>, created by <creatorEmail>"`, then branch:
- **Signed out** (`!Astro.locals.user`): render a "Sign in to join" link to `/auth/signin?next=${encodeURIComponent(Astro.url.pathname)}` — no join form, since joining requires an authenticated identity.
- **Signed in and `alreadyMember`**: render a link straight to `/groups/<groupId>` instead of a Join button.
- **Signed in, not yet a member**: render a `<form method="POST" action="/api/groups/join">` (hidden `token` field) and a Join button.

#### 4. Navigation

**File**: `src/components/Topbar.astro`

**Intent**: Add a "My Groups" link alongside the existing "Dashboard"/"My Goals" links.

**Contract**: one more `<a href="/groups">My Groups</a>`, same styling as the existing links.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- End-to-end as an existing user: create a group on `/groups`, open its detail page, copy the invite link
- End-to-end as a brand-new user (no account): open the invite link in a private window, see the correct group name and creator immediately with no sign-in prompt yet (revised 2026-08-31), click "Sign in to join", get redirected through sign-in and back to the same confirm screen (now with a Join button), sign up via magic link, join, and see the group on `/groups`
- As the original creator, refresh the group detail page and confirm the new member now appears in the list
- Leave the group as the new member and confirm the creator receives the departure email
- Confirm `/groups` and `/groups/<id>` redirect to sign-in when signed out, `/groups/join/<token>` renders its preview instead of redirecting (revised 2026-08-31), and `/goals`/`/dashboard` still behave as before (no regression from the `PROTECTED_ROUTES`/middleware change)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

No test runner exists in this repo (`package.json` has no `test` script) — this plan does not introduce one. Verification is lint + build + manual testing, matching S-01 and F-02's plans.

### Integration Tests:

N/A — see above.

### Manual Testing Steps:

1. Create a group as user A; confirm it appears on `/groups` and its detail page shows A as the sole member.
2. Copy the invite link; open it in a private/incognito window (simulating user B with no account).
3. Confirm the confirm screen renders directly — no sign-in redirect yet — showing the correct group name and A's email, with a "Sign in to join" link. Click it; confirm redirect to sign-in with `next` preserved; request a magic link for B's email; click it; confirm landing back on the confirm screen (not `/dashboard`), now showing a Join button.
4. Click Join.
5. Confirm B now appears in the group's member list (visible to both A and B).
6. As B, leave the group; confirm A receives an email; confirm B's `group_members` row is gone.
7. Re-visit the same invite link as A (already a member) and confirm it shows "already a member" rather than a Join button.
8. Attempt to view a group's detail page as a third, non-member user and confirm it's inaccessible (RLS returns nothing).

## Performance Considerations

None — table sizes and query volume are trivial at this app's `low`/`small` target scale.

## Migration Notes

New migration only; no changes to `goals`' existing migration.

## References

- Roadmap: `context/foundation/roadmap.md` (S-02: form-and-manage-a-group)
- PRD: `context/foundation/prd.md` (FR-008–011, revised 2026-08-31)
- Prior implementation (pattern source): `context/archive/2026-08-29-commit-a-goal/plan.md`, `supabase/migrations/20260829164522_create_goals.sql`
- Email infra: `context/changes/email-sending-infrastructure/plan.md`, `src/lib/services/email.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database schema & RLS

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` — 56cb7f6
- [x] 1.2 Lint passes: `npm run lint` — 56cb7f6
- [x] 1.3 Build passes: `npm run build` — 56cb7f6

#### Manual

- [x] 1.4 Tables/constraints/functions exist as expected in Supabase Studio — 56cb7f6
- [x] 1.5 No infinite-recursion error on `group_members` select with two members — 56cb7f6
- [x] 1.6 `get_group_preview` returns a row for a valid token, none for a bogus one — 56cb7f6

### Phase 2: Types & service layer

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — fd63f6e
- [x] 2.2 Build passes: `npm run build` — fd63f6e

### Phase 3: API routes + auth callback threading

#### Automated

- [x] 3.1 Lint passes: `npm run lint`
- [x] 3.2 Build passes: `npm run build`

#### Manual

- [x] 3.3 Create endpoint produces both a `groups` and `group_members` row
- [x] 3.4 Join endpoint is idempotent (no duplicate row on re-submit)
- [x] 3.5 Leave endpoint removes the row and triggers an email to remaining members
- [x] 3.6 Signed-out visit to `/groups/join/<token>` renders the preview with no redirect; its "Sign in to join" link preserves `next` and returns there after auth

### Phase 4: UI

#### Automated

- [ ] 4.1 Lint passes: `npm run lint`
- [ ] 4.2 Build passes: `npm run build`

#### Manual

- [ ] 4.3 Full create → invite → sign-up → confirm → join flow works end-to-end for a brand-new user
- [ ] 4.4 Member list updates after a new member joins
- [ ] 4.5 Leave flow sends the departure email and updates both users' views
- [ ] 4.6 Already-member revisit shows the "already a member" state, not a Join button
- [ ] 4.7 `/groups` (list/detail) is gated when signed out; `/groups/join/<token>` renders its preview ungated (revised 2026-08-31); `/goals`/`/dashboard` unaffected
