# Goals Page UX/UI Consolidation — Plan Brief

> Full plan: `context/changes/goals-page-ux-consolidation/plan.md`

## What & Why

The `/goals` page currently splits one goal's information across three separate sections ("Zapisz postęp", "Zarządzaj celami", "Zablokowane cele"), each iterating the goal list independently. This consolidates them into a single "Lista celów" section where each goal is exactly one card, carrying progress recording plus (while still editable) inline edit/delete — matching the "one entry per goal" mental model. Presentation-only: no FR, schema, or API behavior changes.

## Starting Point

`src/pages/goals/index.astro` renders "Dodaj nowe cele" (`GoalBundleForm.tsx`, untouched by this plan) followed by three independent sections/forms over the same goal list — a shared bulk progress-form over all goals, a shared bulk edit-form over editable goals only (with a known bug: deleting one row silently drops sibling rows' pending edits), and a read-only list of locked goals. `/api/goals/progress.ts` and `/api/goals/manage.ts` parse per-goal commands from flat `FormData` keys via regex, independent of how many goals share a `<form>`.

## Desired End State

Two sections only. "Dodaj nowe cele" unchanged. "Lista celów" shows one `GoalCard` per goal — editable goals first (newest-first), then locked goals (newest-first) — each combining measure/progress display, a progress-recording control, and, only while still within its 24h window, an editable-countdown badge ("Do edycji: jeszcze ~18h 30min") plus inline edit/delete. A locked card shows none of that — no separate "locked" label, its absence from the editable group and lack of edit controls communicate the state.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Form/submit architecture | Two sibling `<form>`s per card (progress-form always; edit-form only while editable) | Zero backend changes — reuses `/api/goals/{progress,manage}` exactly, matches the roadmap's "presentation-only" scope |
| Save/delete granularity | Per-card Save and Delete (not one page-wide bulk button) | Matches "one entry = one goal"; incidentally fixes today's drop-sibling-edits bug |
| Progress save granularity | Per-card, follows from the above | Falls out of the two-forms-per-card architecture — flagged here since it wasn't asked about directly |
| Locked-goal indicator | No "locked" badge — instead, editable goals get a "time left to edit" badge; locked goals simply lack it and the edit controls | User's preference: frame it positively (editable + countdown) rather than negatively (locked) |
| Countdown freshness | Static, computed at page render (not live-ticking) | No schema change needed (`created_at` already exists); avoids adding a new client-side timer for an MVP polish slice |
| List ordering | Editable-first, then locked, newest-first within each group | Surfaces actionable goals first |
| Componentization | Extract `GoalCard.tsx` (React island, not `.astro`) | Needed anyway once `FormField` is reused (see below) — `.astro` can't hold the controlled-input state `FormField` requires |
| UI primitive reuse | Reuse `FormField`/`Button`/`SubmitButton` (same as `GoalBundleForm.tsx`) for edit-form inputs | Visual consistency with "Dodaj nowe cele"; accepted tradeoff: turns the card into a `client:load` island |
| Delete confirmation | None — instant delete, unchanged | Out of scope; not requested, no behavior change |

## Scope

**In scope:** Consolidating "Zapisz postęp" + "Zarządzaj celami" + "Zablokowane cele" into one "Lista celów" section of `GoalCard`s; adding one pure time-remaining helper.

**Out of scope:** Any change to FR-006/FR-007 enforcement, any new API endpoint or schema change, "Dodaj nowe cele", a live-ticking countdown, delete confirmation, any other page.

## Architecture / Approach

`GoalCard.tsx` (React, `client:load`) owns one goal's full card: static info, the editable/countdown badge, a progress sub-form, and (when editable) an edit/delete sub-form — both sub-forms keep the exact field-name contracts `progress.ts`/`manage.ts` already parse. `index.astro` computes `isEditable` + a remaining-time label per goal server-side, sorts editable-before-locked (relying on `Array.sort`'s ES2019 stability to preserve `listGoals`'s newest-first order within each group), and replaces its three old sections with one `.map()` over `GoalCard`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Build `GoalCard` | Self-contained per-goal card component with both sub-forms | Getting the exact field-name contracts right so the existing endpoints keep parsing correctly |
| 2. Helper + rewire `index.astro` | Remaining-time helper, sorted single-list rendering | Sort-stability reliance; badge/edit-control visibility logic |
| 3. Cleanup & verification | Dead code removed, full manual pass | Regression on the "per-card independence" behavior (delete one, others unaffected) |

**Prerequisites:** None beyond what's already shipped (S-01, S-04, S-07 — all `done`).
**Estimated effort:** Small — one new component, one new helper function, one page rewrite; no backend changes.

## Open Risks & Assumptions

- Assumes goal counts per user stay small enough that per-card `client:load` hydration cost is a non-issue (matches PRD's `target_scale: small`).
- Assumes `Array.prototype.sort`'s ES2019 stability guarantee holds in the deployed runtime (Cloudflare Workers V8) — it does, but this is a load-bearing assumption for order correctness without a secondary sort key.

## Success Criteria (Summary)

- A user sees exactly two sections on `/goals`, with each goal as one card.
- Progress recording, editing, and deleting all still work exactly as before, now scoped per-card.
- An editable goal visibly shows how much time is left to edit it; a locked goal shows neither that badge nor edit controls.
