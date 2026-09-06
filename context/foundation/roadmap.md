---
project: "Resolution Circle"
version: 1
status: draft
created: 2026-08-02
updated: 2026-09-06
prd_version: 1
main_goal: speed
top_blocker: capacity
---

# Roadmap: Resolution Circle

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

People who set yearly goals routinely abandon them because no one is watching. Resolution Circle bets that three constraints, bundled together, fix this: goals are **immutable once committed**, the check-in cadence is **quarterly**, and the witnessing audience is a **closed circle of friends and family** — not strangers, not the public. Removing any one of the three breaks the mechanism.

## North star

**S-03: Group member can see another member's committed goal and its current progress** — this is the moment a locked-in promise actually gets witnessed by someone the user cares about, which is the whole product's bet. shape-notes.md names this directly: *"First user-visible value lands at step 4–5 (goals committed and witnessed by a real human who cares)."*

> The north star is the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as its Prerequisites allow, because every other slice only matters if this one works.

## At a glance

| ID   | Change ID                      | Outcome (user can …)                                                            | Prerequisites | PRD refs                          | Status   |
| ---- | ------------------------------- | -------------------------------------------------------------------------------- | -------------- | ---------------------------------- | -------- |
| F-01 | magic-link-auth                 | (foundation) passwordless magic-link auth replaces the current password flow    | —              | FR-001, FR-002, FR-003, Access Control | done |
| F-02 | email-sending-infrastructure    | (foundation) a Brevo REST API key + a reusable send-email service other slices call (SMTP/magic-link already done in deployment) | —              | FR-010, NFR ("Quarterly digest deliverability") | done |
| S-01 | commit-a-goal                   | create a goal (one-line + numeric or yes/no measure) and view it on their personal page; edit/delete within 24h | F-01           | US-01, FR-004, FR-005, FR-006     | done |
| S-02 | form-and-manage-a-group         | create a group, invite others, accept an invite, and leave a group they belong to | F-01, F-02     | US-01, FR-008, FR-009, FR-010, FR-011 | done |
| S-03 | witness-the-circles-goals       | see every group member's committed goals and current progress on a shared view  | S-01, S-02     | US-01, FR-012                      | in-progress |
| S-04 | record-goal-progress             | record progress on their own goal (increment number / flip yes-no)              | S-01           | FR-007                             | done |
| S-05 | quarterly-digest-email          | receive a quarterly email summarizing every group's goals and progress          | S-03, F-02     | FR-013, NFR ("Quarterly digest deliverability") | proposed |
| S-06 | anonymize-on-account-deletion   | delete their account while their locked goals/progress persist as "former member" in group views | S-01, S-02     | FR-014                             | proposed |
| S-07 | ui-polish-and-consistency       | see product-relevant homepage content, navigate to any page after sign-in, get success feedback when saving a goal edit or progress update, and read all user-facing text (incl. errors) in consistent Polish | F-01, S-01, S-04 | — (surfaced during implementation, not PRD-derived) | done |
| S-08 | goals-page-ux-consolidation     | see all of their goals as one list — one card per goal — with progress recording and (while still editable) inline edit/delete on that same card, instead of three separate sections/forms | S-01, S-04, S-07 | FR-005, FR-006, FR-007 (presentation-only; no new FR) | done |
| S-09 | shadcn-dark-theme-tokens        | (any shadcn/ui component renders correctly out of the box) the app's design tokens in `global.css` actually encode its dark "cosmic glass" palette instead of the unused shadcn-scaffold light defaults | S-08 | — (surfaced during implementation, not PRD-derived) | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                        | Chain                              | Note                                                                                  |
| ------ | ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| A      | Commitment & witnessing loop | `F-01`, `F-02` → `S-01`, `S-02` → `S-03`  | The core must-have path culminating in the north star; sequenced strictly given the `speed` goal. `F-02` (email infra) now gates `S-02` alongside `F-01`, since FR-010's leave notification is a real email. |
| B      | Progress tracking            | `S-04`                              | Branches off `S-01` in parallel with the rest of Stream A; not a hard prerequisite for `S-03`. |
| C      | Social heartbeat             | `S-05`                              | Depends on `S-03`'s data/query logic and `F-02`'s email infra; the quarterly long-tail mechanism, sequenced after the core loop lands. |
| D      | Account lifecycle            | `S-06`                              | Depends on Stream A's `S-01` + `S-02`; an edge-case departure flow, not part of first-value delivery. |
| E      | Post-launch UI/UX polish     | `F-01`, `S-01`, `S-04` → `S-07` → `S-08` → `S-09` | Surfaced by using the shipped app rather than by a PRD requirement; joins Stream A at `S-01` and Stream B at `S-04` instead of belonging to either, since it touches navigation, forms, and copy across both. `S-08` builds directly on `S-07`'s goals-page save-feedback work, consolidating the same page's layout next. `S-09` is a design-system fix surfaced while building `S-08`'s first shadcn Dialog. |

## Baseline

What's already in place in the codebase as of `2026-08-02` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 6 + React 19 + Tailwind 4 scaffolded, shadcn configured (`components.json`) with only `button.tsx` installed. No goals/groups pages exist yet.
- **Backend / API:** partial — SSR wired on `@astrojs/cloudflare`, but only auth API routes exist (`src/pages/api/auth/{signin,signup,signout}.ts`). No goals/groups/progress/digest routes; no `src/lib/services/`.
- **Data:** absent — no `supabase/migrations/` directory. No schema for goals, groups, group_members, progress, or digest send-state. No `src/types.ts`.
- **Auth:** partial — Supabase auth fully wired end-to-end (`src/lib/supabase.ts`, `src/middleware.ts`, protected `/dashboard`), but it's an email+password flow (signup → confirm-email → signin), not the magic-link flow FR-001/002/003 require.
- **Deploy / infra:** present — live on Cloudflare Workers (`resolution-circle.pawel-goralik.workers.dev`); CI (lint+build) and auto-deploy-on-merge (wrangler-action) both wired; all deployment phases 0–6 done per `context/changes/deployment/deployment-plan.md`.
- **Observability:** partial — Cloudflare Workers observability enabled in `wrangler.jsonc`, but no app-level logging/error tracking. Not a gating concern for this roadmap (no PRD NFR requires it beyond digest deliverability, which S-05 owns directly).

## Foundations

### F-01: Magic-link auth replaces password auth

- **Outcome:** (foundation) visitors can request a magic link by email, authenticate by clicking it, and sign out — matching FR-001/002/003 exactly, replacing the password-based flow found in the baseline.
- **Change ID:** magic-link-auth
- **PRD refs:** FR-001, FR-002, FR-003, Access Control ("Authentication is passwordless email magic-link only for the MVP")
- **Unlocks:** S-01, S-02 (every downstream slice assumes an authenticated user signed in via magic link — building goal/group features against the current password flow would mean redoing the sign-in surface later)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** sequenced first because it replaces, rather than extends, an already-built surface — every other slice's acceptance criteria assume magic-link sign-in, so shipping goal/group work first would mean reworking the auth touchpoints in those slices later.
- **Status:** done

### F-02: Email-sending infrastructure

- **Outcome:** (foundation) the application can send app-triggered transactional email via Brevo's REST API — a provisioned `BREVO_API_KEY` Worker secret plus a reusable send-email service other slices call rather than each wiring their own. Brevo's SMTP side (sender verification, magic-link email) is already done as part of `context/changes/deployment/deployment-plan.md` Phase 1c/4 — this item is scoped to the separate REST API key and the code, not account/sender setup.
- **Change ID:** email-sending-infrastructure
- **PRD refs:** FR-010 (leave-a-group notification), NFR ("Quarterly digest deliverability")
- **Unlocks:** S-02 (FR-010's leave-notification email), S-05 (quarterly digest)
- **Prerequisites:** —
- **Parallel with:** S-01, S-03, S-04 (any slice that doesn't send email)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** pulled forward from being S-05-only infra because S-02's FR-010 also needs real email delivery, not just an in-app record — provisioning the REST API key and building the send-email utility once, ahead of both consumers, avoids duplicating that setup across two slices.
- **Status:** done

## Slices

### S-01: User can commit a goal

- **Outcome:** authenticated user can create a goal (one-line description + one measure — numeric target or yes/no) and view it on their personal goals page; within 24 hours they can edit or delete it, after which it's locked forever.
- **Change ID:** commit-a-goal
- **PRD refs:** US-01, FR-004, FR-005, FR-006
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** the smallest fully self-contained vertical slice after auth (single-user, no cross-user visibility yet); sequenced early because S-03 (the north star), S-04, and S-06 all consume a committed goal.
- **Status:** done

### S-02: User can form and manage a group

- **Outcome:** authenticated user can create a named group, invite others via a shareable link/code, accept an invite to join a group, and leave a group they belong to — with departure notifying remaining members by email.
- **Change ID:** form-and-manage-a-group
- **PRD refs:** US-01, FR-008, FR-009, FR-010, FR-011
- **Prerequisites:** F-01, F-02
- **Parallel with:** S-01, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** bundles four FRs (create/invite/accept/leave) into one slice because they share the same groups/group_members schema and form one coherent membership workflow — splitting further would fragment a single vertical outcome without a real granularity benefit. Depends on F-02 (not just F-01) because FR-010's departure notification is a real email, not an in-app record.
- **Status:** done

### S-03: Group member can witness the circle's goals (north star)

- **Outcome:** group member can view every other member's committed goals and current progress, across every group they belong to, on one shared view.
- **Change ID:** witness-the-circles-goals
- **PRD refs:** US-01, FR-012
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-04, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** this is the north star — placed as early as S-01 and S-02 allow, not deferred for symmetric ordering, because it's the first point where the product's core bet (a promise witnessed by a trusted circle) becomes real and testable.
- **Status:** in-progress

### S-04: User can record progress on their own goal

- **Outcome:** authenticated user can increment their own goal's numeric measure, or flip a yes/no measure to done.
- **Change ID:** record-goal-progress
- **PRD refs:** FR-007
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** small and isolated (one field update on an existing goal); sequenced with generous parallel-with given `capacity` is the #1 constraint — it doesn't block, and isn't blocked by, the witnessing loop.
- **Status:** done

### S-05: Group member receives the quarterly digest

- **Outcome:** at the end of each calendar quarter, every group member receives an email summarizing the goals and current progress of every member of every group they belong to.
- **Change ID:** quarterly-digest-email
- **PRD refs:** FR-013, NFR ("Quarterly digest deliverability")
- **Prerequisites:** S-03 (reuses its cross-group goal/progress roll-up), F-02 (email-sending infrastructure)
- **Parallel with:** S-04, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** infrastructure.md's own risk register calls this "the fragile piece" — a Cloudflare Cron Trigger with no automatic retry, so an unhandled mid-loop error silently skips the quarter's digest. Sequenced deliberately after the core witnessing loop (S-03) lands, since shape-notes.md explicitly frames it as the "long-tail mechanism," not first-value.
- **Status:** proposed

### S-06: User can delete their account with immutability preserved

- **Outcome:** authenticated user can delete their own account; their committed goals and frozen progress remain visible in every group they belonged to, with the author identity replaced by "former member."
- **Change ID:** anonymize-on-account-deletion
- **PRD refs:** FR-014
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** an account-lifecycle edge case, not part of first-value delivery, so it's sequenced after the core loop; correctness here matters because it's the one place immutability and identity deletion intersect (FR-014's anonymize-not-delete guarantee).
- **Status:** proposed

### S-07: User experiences a coherent, navigable, Polish-language UI

- **Outcome:** authenticated user gets a coherent app experience: the homepage shows product-relevant content instead of the default Astro starter page, every page is reachable via visible in-app navigation after sign-in, saving a goal edit or recording progress gives clear success feedback, and every user-facing text — including error messages — reads in consistent Polish.
- **Change ID:** ui-polish-and-consistency
- **PRD refs:** — (not PRD-derived; surfaced by the user while exercising the shipped S-01/S-02/S-04 slices, not by a stated FR/US)
- **Prerequisites:** F-01, S-01, S-04
- **Parallel with:** S-03, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Does progress tracking already give adequate feedback via the visibly-updated value, or does it need an explicit confirmation too? — Owner: user. Block: no.
  - Does the Polish-only text pass extend to transactional email templates (invite, leave-group, quarterly digest), or is it limited to in-app UI/error messages? — Owner: user. Block: no.
- **Risk:** bundles four independent, low-risk UI fixes discovered by using the shipped app rather than by a PRD requirement; kept as one slice per explicit request, but each item touches a different surface (root layout/homepage, dashboard nav, goal/progress forms, i18n strings) — `/10x-plan` should confirm scope, or split it, during planning.
- **Status:** done

### S-08: User sees their goals as one consolidated list

- **Outcome:** authenticated user views their goals page as two sections only — "Dodaj nowe cele" (unchanged) and a single "Lista celów" — where each goal is exactly one card showing its description, measure, and progress-recording controls; while still within its 24h edit window a card also exposes inline edit/delete, and once locked it shows a read-only/locked state instead. Replaces today's three separate sections ("Zapisz postęp", "Zarządzaj celami", "Zablokowane cele"), each iterating the goal list independently.
- **Change ID:** goals-page-ux-consolidation
- **PRD refs:** FR-005 (view own goals), FR-006 (24h edit/delete window), FR-007 (record progress) — presentation-only consolidation of capabilities already shipped in S-01/S-04; no new FR, no schema change, no change to the 24h immutability rule or to unrestricted progress recording.
- **Prerequisites:** S-01, S-04, S-07 (reworks the same `/goals` page S-07 already touched for save-feedback and copy)
- **Parallel with:** S-03, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Should a locked goal's card show any visual "locked" affordance (e.g., a badge/greyed state), or simply omit edit/delete controls silently? — Owner: user. Block: no.
  - Per-card actions currently span two independent endpoints (`/api/goals/progress`, `/api/goals/manage`); does consolidating the visual card also require consolidating the submit action (e.g., one form per card, or per-card AJAX), or can two sibling forms per card stay as-is? — Owner: team. Block: no.
- **Risk:** reads as "just markup," but each card still has to submit to two independent existing endpoints without nesting `<form>` elements — `/10x-plan` should confirm the per-card form/submit structure before implementation, since that decision drives whether this stays a server-rendered Astro page or needs a client-side island.
- **Status:** done

### S-09: App's design tokens actually match its dark visual identity

- **Outcome:** the `:root`/`.dark` CSS custom properties in `src/styles/global.css` (`background`, `foreground`, `muted-foreground`, `secondary`/`secondary-foreground`, `border`, etc.) encode this app's real "cosmic glass" dark palette (navy background, white text, white/10 borders, blue-100/60 muted text, purple accents) instead of the unused shadcn-scaffold light/gray defaults, so any shadcn/ui component (the `Dialog` added in `S-08`, and future additions) renders correctly out of the box without per-component class overrides.
- **Change ID:** shadcn-dark-theme-tokens
- **PRD refs:** — (not PRD-derived; surfaced while implementing `S-08`'s progress-recording `Dialog` — see `context/foundation/lessons.md` § "Override shadcn's default theme tokens to match this app's dark-only look")
- **Prerequisites:** S-08 (surfaced during its implementation; not a hard technical dependency — it's a design-system fix, not something `S-08`'s own code needs)
- **Parallel with:** S-03, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Should the app also wire up an actual light/dark toggle (both palettes properly defined), or is this genuinely a dark-only product where `:root` itself should just carry the dark values and `.dark` is left unused? — Owner: user. Block: no.
- **Risk:** touches a shared design-system file (`global.css`) that every shadcn component reads from — low blast radius today since only `Dialog` currently depends on the tokens, but the rewrite should be checked against every installed `src/components/ui/*` component, not just the one that surfaced it.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                    | Suggested issue title                                            | Ready for `/10x-plan` | Notes |
| ---------- | ------------------------------ | -------------------------------------------------------------------- | ---------------------- | ----- |
| F-01       | magic-link-auth               | Replace password auth with passwordless magic-link auth              | yes                    | Run `/10x-plan magic-link-auth` |
| F-02       | email-sending-infrastructure   | Provision Brevo and add a reusable send-email service                | yes                    | Run `/10x-plan email-sending-infrastructure` |
| S-01       | commit-a-goal                 | User can commit a goal with a 24h edit/delete window                 | no                     | Needs F-01 first |
| S-02       | form-and-manage-a-group       | User can create, invite to, join, and leave a group                  | no                     | Needs F-01 and F-02 first |
| S-03       | witness-the-circles-goals     | Group member can see every member's committed goals and progress     | no                     | Needs S-01 and S-02 first (north star) |
| S-04       | record-goal-progress          | User can record progress on their own goal                           | no                     | Needs S-01 first |
| S-05       | quarterly-digest-email        | Group member receives a quarterly digest email                       | no                     | Needs S-03 and F-02 first |
| S-06       | anonymize-on-account-deletion | User can delete their account; goals persist anonymized              | no                     | Needs S-01 and S-02 first |
| S-07       | ui-polish-and-consistency     | Homepage, in-app navigation, save-feedback, and Polish i18n polish    | no                     | Needs S-01 and S-04 first; not PRD-derived — see slice Unknowns |
| S-08       | goals-page-ux-consolidation   | Consolidate the goals page into "add goals" + one-card-per-goal list  | yes                    | Needs S-01, S-04, S-07 first — all `done` |
| S-09       | shadcn-dark-theme-tokens      | Align shadcn/ui design tokens with the app's dark visual identity    | no                     | Surfaced during S-08; not PRD-derived — see slice Unknowns |

## Open Roadmap Questions

None. All PRD shaping-stage questions were resolved before this roadmap was generated (`prd.md` §Open Questions: "None outstanding").

## Parked

- **No notification channels other than email** — Why parked: PRD Non-Goals; email (the quarterly digest) is the only product channel for the MVP.
- **No user-configurable notification frequency** — Why parked: PRD Non-Goals; cadence is fixed at calendar-quarter end for every user/group, by design (the fixed cadence is one of the three load-bearing pillars).
- **No group-shared goals** — Why parked: PRD Non-Goals; the MVP is one-person-one-goal-with-witnesses, not a joint/collective-goal model.
- **No frequency-style goals** ("N times per period") — Why parked: PRD Non-Goals; would require a recurring-window state model beyond the numeric/yes-no measure types. Candidate for v2.
- **No third-party progress integrations** (Strava, Apple Health, etc.) — Why parked: PRD Non-Goals; progress is recorded manually by the goal author for the MVP. Candidate for v2 if manual reporting proves a credibility limit.
- **No operator-proof immutability** — Why parked: PRD Non-Goals; post-window immutability binds the product surface only, not the datastore; operators retain raw data access for maintenance.

## Done

- **F-01: (foundation) passwordless magic-link auth replaces the current password flow** — Archived 2026-08-30 → `context/archive/2026-08-25-magic-link-auth/`. Lesson: —.
- **S-01: authenticated user can create a goal (one-line description + one measure — numeric target or yes/no) and view it on their personal goals page; within 24 hours they can edit or delete it, after which it's locked forever** — Archived 2026-08-30 → `context/archive/2026-08-29-commit-a-goal/`. Lesson: —.
- **F-02: (foundation) the application can send app-triggered transactional email via Brevo's REST API — a provisioned `BREVO_API_KEY` Worker secret plus a reusable send-email service other slices call rather than each wiring their own. Brevo's SMTP side (sender verification, magic-link email) is already done as part of `context/changes/deployment/deployment-plan.md` Phase 1c/4 — this item is scoped to the separate REST API key and the code, not account/sender setup.** — Archived 2026-08-31 → `context/archive/2026-08-30-email-sending-infrastructure/`. Lesson: —.
- **S-02: authenticated user can create a named group, invite others via a shareable link/code, accept an invite to join a group, and leave a group they belong to — with departure notifying remaining members by email.** — Archived 2026-08-31 → `context/archive/2026-08-30-form-and-manage-a-group/`. Lesson: —.
- **S-04: authenticated user can increment their own goal's numeric measure, or flip a yes/no measure to done.** — Archived 2026-08-31 → `context/archive/2026-08-30-record-goal-progress/`. Lesson: —.
- **S-07: authenticated user gets a coherent app experience: the homepage shows product-relevant content instead of the default Astro starter page, every page is reachable via visible in-app navigation after sign-in, saving a goal edit or recording progress gives clear success feedback, and every user-facing text — including error messages — reads in consistent Polish.** — Archived 2026-09-06 → `context/archive/2026-09-06-ui-polish-and-consistency/`. Lesson: —.
- **S-08: authenticated user views their goals page as two sections only — "Dodaj nowe cele" (unchanged) and a single "Lista celów" — where each goal is exactly one card showing its description, measure, and progress-recording controls; while still within its 24h edit window a card also exposes inline edit/delete, and once locked it shows a read-only/locked state instead. Replaces today's three separate sections ("Zapisz postęp", "Zarządzaj celami", "Zablokowane cele"), each iterating the goal list independently.** — Archived 2026-09-06 → `context/archive/2026-09-06-goals-page-ux-consolidation/`. Lesson: [[override-shadcn-default-theme-tokens-to-match-this-app-s-dark-only-look]] (see `context/foundation/lessons.md`; follow-up tracked as roadmap slice S-09).
