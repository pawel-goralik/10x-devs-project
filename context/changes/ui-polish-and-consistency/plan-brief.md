# UI Polish & Consistency (S-07) — Plan Brief

> Full plan: `context/changes/ui-polish-and-consistency/plan.md`

## What & Why

Close roadmap slice S-07 by fixing four gaps surfaced while actually using the shipped Resolution Circle MVP: a boilerplate homepage, ad-hoc/missing navigation, inconsistent save/edit feedback, and English/Polish language mixing. None of this came from a PRD requirement — it was discovered by exercising the already-shipped S-01/S-02/S-04 slices.

## Starting Point

The homepage is still the unmodified Astro-starter template (stale "Astro 5" copy included). Nav (`<Topbar/>`) is copy-pasted into 3 of 4 authenticated pages and missing from `/dashboard`, making it a dead end. Goal creation and progress-recording already show a redirect+banner success message; editing/deleting a goal shows none. The app is English throughout except one Polish config-status banner — no i18n framework exists, and email templates (Brevo group-leave notice, Supabase magic-link/confirmation) are also English.

## Desired End State

A first-time visitor sees real product content on `/`, with a sign-in CTA that becomes a dashboard link once signed in. Every authenticated page, including `/dashboard` and the invite-join page, is reachable from a persistent nav bar. Editing or deleting a goal gives the same success confirmation as creating one or recording progress. Every user-facing string — in-app and in transactional emails — reads in Polish.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Language scope | Full app-wide Polish translation | Matches the roadmap's stated "consistent Polish" outcome exactly, not a smaller fix | Plan |
| Email i18n | Include email templates | An English magic-link email inside an otherwise-Polish product is a jarring gap | Plan |
| Nav architecture | Centralize `<Topbar/>` in `Layout.astro` | Eliminates the whole class of bug (a new page forgetting nav), not just today's `/dashboard` instance | Plan |
| Save feedback | Extend the existing banner pattern | Zero new dependencies; matches the pattern already used twice in the same file | Plan |
| Homepage content | Minimal product homepage, no extra feature cards | Small and fast; fixes the boilerplate without turning this into a landing-page design exercise | Plan |
| Submit pending state | Left out of scope | Full-page redirect already gives an implicit in-flight cue; disproportionate for a polish item | Plan |
| Priority if capacity bites | No pre-planned cut — all four items ship together | Each item is individually small; splitting adds coordination overhead without clear benefit | Plan |

## Scope

**In scope:** homepage content rewrite, centralized nav in `Layout.astro`, edit/delete success banner, full-app Polish translation (in-app + emails), a deploy-approval gate before pushing translated email subjects to Supabase.

**Out of scope:** toast library / form-to-React-island refactor, submit-button pending state on plain-HTML forms, an i18n framework/dictionary, the quarterly-digest email (not yet built), richer homepage marketing content, splitting this into multiple roadmap slices.

## Architecture / Approach

Five phases in dependency order: homepage → nav centralization (structural only) → edit/delete feedback (new strings, authored in Polish directly) → full in-app Polish translation sweep (catches everything pre-existing plus verifies Phases 1/3) → email content translation (its own phase due to the Supabase config-push approval gate).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Homepage content refresh | Real product copy + auth-aware CTA, replacing Astro-starter boilerplate | Low — isolated to one component |
| 2. Centralize navigation | Nav bar on every page, including the previously dead-end `/dashboard` | Low — removing duplicates could miss a page; verify visually |
| 3. Consistent save/edit feedback | Edit/delete goals get the same success banner as create/progress | Low — small, mirrors an existing pattern |
| 4. Full in-app Polish translation | Every remaining English string in the app translated | Medium — largest surface area; easy to miss a string without the grep check |
| 5. Email content Polish translation | Group-leave + magic-link/confirmation emails in Polish | Medium — carries a deploy-approval gate; past incident shows Supabase config push can overwrite unrelated remote auth settings |

**Prerequisites:** none beyond what's already shipped (F-01, S-01, S-04, per roadmap).
**Estimated effort:** small-to-medium; roughly one implementation session per phase, five phases total.

## Open Risks & Assumptions

- Phase 4's grep-based verification only samples the inventoried English literals — a thorough manual click-through remains the real safety net for full coverage.
- Phase 5's Supabase config push is gated on user approval and must not be run autonomously; if approval is delayed, the in-app phases (1–4) can still ship independently.

## Success Criteria (Summary)

- A visitor sees real Resolution Circle content on `/`, with an auth-aware CTA.
- Every authenticated page is reachable via nav, including `/dashboard`.
- Editing/deleting a goal gives clear success feedback, matching create/progress.
- Every user-facing string, in-app and in email, reads in Polish.
