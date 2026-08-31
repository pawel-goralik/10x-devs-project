# Form and Manage a Group — Plan Brief

> Full plan: `context/changes/form-and-manage-a-group/plan.md`

## What & Why

Implement FR-008–011 (roadmap S-02): create a named group, invite others via a shareable link, accept an invite (even as a brand-new user), and leave a group — with remaining members notified by email. This is the core membership vertical the north star (S-03, witnessing goals) depends on.

## Starting Point

No group schema exists yet. No cross-user identity resolution exists either — `auth.users` isn't queryable via the Data API, and every existing page only ever displays the *current* user's own email. The magic-link auth flow has no "return to X after sign-in" concept, which an invite link needs for new users.

## Desired End State

A user creates a group by name, sees it on `/groups`, opens `/groups/[id]` for its member list and invite link, and can leave. An invite recipient — new user or not — lands on an explicit confirm screen naming the group and its creator before joining. Leaving triggers a real email to remaining members via F-02.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| PRD change | Group naming required at creation; renaming removed from scope entirely | Simplifies S-02 (no default-name logic, no rename UI/endpoint) — decided during this planning session, PRD updated |
| Invite mechanism | One standing, reusable `invite_token` column on `groups`, no separate invites table | Matches the PRD's explicit trust assumption that group composition is trusted |
| Unauthenticated invitee | Preserve invite intent through sign-up via a `next` path threaded through the auth callback | The product's core flow (US-01) explicitly assumes inviting people who may not have an account yet |
| Accept UX | Explicit confirm screen, not immediate join-on-click | Matches FR-009's explicit-accept requirement and its own Socratic reasoning |
| Preview vs. auth ordering | Confirm screen previews the group (name + creator) for signed-out visitors too; only the Join click requires sign-in | Revised 2026-08-31 during implementation — signing up blind, before seeing what you're agreeing to, is worse UX for a brand-new invitee; `get_group_preview` is safely token-gated regardless of auth state |
| Leave notification | Real email via F-02's `sendEmail`, not an in-app record | Confirmed by the user: users don't check the app often enough for in-app-only visibility to be reliable |
| Identity resolution | A lightweight `profiles` table (synced from `auth.users` via trigger) | The standard Supabase pattern; S-03 needs the identical capability, so building it once now avoids solving it twice |
| Security model | Two `SECURITY DEFINER` RPC functions for invite preview/join, not a permissive SELECT policy | This app's Supabase key is client-visible — a permissive `groups` SELECT policy would let any user enumerate every invite token |
| Empty group after last leave | Leave the row in place, no cleanup | No cascading-delete edge cases; matches S-01's precedent of not building cleanup for a cosmetic concern |

## Scope

**In scope:**
- `groups`, `group_members`, `profiles` schema + RLS + RPC functions (`create_group`, `get_group_preview`, `join_group_by_token`, `is_member_of`)
- Create / list / detail / leave / invite-accept flows
- Auth callback + middleware threading so invite links survive sign-up
- Departure email via F-02

**Out of scope:**
- Group renaming (PRD Non-Goals, revised)
- Per-invite tokens, expiry, or revocation
- Group deletion or member-count-triggered cleanup
- Any change to the 24h goal edit window or goals domain

## Architecture / Approach

Migration → types/service → API → UI, mirroring S-01's layering. Two narrow `SECURITY DEFINER` functions handle the two operations that must act before the caller is a member (preview, join); everything else is plain RLS-gated queries following `goals.ts`'s existing style.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database schema & RLS | `groups`/`group_members`/`profiles` + RPC functions | RLS self-reference recursion if the "fellow members" policy isn't routed through the `is_member_of` helper function |
| 2. Types & service layer | `src/types.ts`, `src/lib/services/groups.ts` | None significant — thin wrappers over Phase 1's schema |
| 3. API routes + auth threading | create/leave/join endpoints, `next`-path threading through 4 files | Open-redirect if the `next` value isn't sanitized at every read site |
| 4. UI | `/groups`, `/groups/[id]`, `/groups/join/[token]`, nav | The full new-user invite flow only proves out end-to-end at this phase |

**Prerequisites:** F-01 (done), F-02 (done).
**Estimated effort:** ~2-3 sessions across 4 phases — the largest slice built so far, given the new identity-resolution infrastructure.

## Open Risks & Assumptions

- No test runner exists in this repo — verification is lint + build + manual testing only.
- The `profiles` table is new shared infrastructure; S-03 is expected to consume it as-is rather than needing its own identity mechanism.
- Manual testing requires two real test accounts (or a private window) to exercise the invite flow properly — cannot be fully verified solo.

## Success Criteria (Summary)

- A brand-new user can go from clicking an invite link to being a visible group member without losing the invite context partway through sign-up.
- Leaving a group reliably notifies remaining members by email.
- No authenticated user can see another group's data, another group's invite token, or a non-group-member's identity.
