# Commit a Goal — Plan Brief

> Full plan: `context/changes/commit-a-goal/plan.md`

## What & Why

Let an authenticated user commit a bundle of one or more goals in a single form (each a one-line description + a numeric target or yes/no measure), see them on a personal `/goals` page, and adjust or remove any of them — through one consolidated form — only within 24 hours of that bundle's commit. This is roadmap slice S-01, the first vertical slice built on top of the now-shipped magic-link auth, and a prerequisite for every other goals/groups feature.

## Starting Point

Nothing goal-related exists yet: no migrations directory, no `src/types.ts`, no `src/lib/services/`, no goals pages. Auth is fully wired (`context.locals.user` is reliable), and that's the only foundation this slice builds on.

## Desired End State

A signed-in user visits `/goals`, adds as many goal rows as they want in one composer, and commits them all at once. All goals in that bundle lock together 24 hours later. While inside the window, the user edits descriptions/targets or deletes goals through one consolidated manage form on the same page. Once a goal's window closes, it moves to a read-only section — permanently. The user can come back later and commit further bundles; creation isn't one-time-only.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Commit unit | One bundle-create form, not one-goal-at-a-time | Matches the "commit my resolutions in one sitting" mental model; bundle members share `created_at` via a single multi-row insert, so no schema change is needed for synchronized windows | Plan |
| Bundle validation | All-or-nothing | A conscious "commit" action shouldn't partially succeed and leave the user unsure what actually locked in | Plan |
| Later bundles | Allowed, unlimited | PRD explicitly doesn't assume calendar alignment; nothing restricts adding more goals later, each with its own fresh window | Plan |
| Editing within window | One consolidated manage form (all editable goals + per-row delete), not per-goal edit pages | Keeps the "one form" feel across the whole lifecycle, not just creation | Plan |
| Row cap | Dynamic add/remove, soft cap 20 | Flexible for however many resolutions someone has, without an arbitrary fixed count | Plan |
| Window enforcement mechanism | `created_at > cutoff` in the UPDATE/DELETE query's own WHERE clause | Atomic — closes the race between page load and submit without a separate fetch-then-check step; zero rows affected IS the "locked" signal | Plan |
| Create/edit/delete mechanism | Form POST + redirect, no JSON/fetch | These actions are rare — a JSON/fetch layer would add real complexity for no perceptible UX gain | Plan |
| Progress columns | Included in this migration, defaulted | Avoids a second migration touching the same table right after this one ships; S-04 owns actually using them, never editable via this slice's forms | Plan |
| Delete semantics | Hard delete | Matches the PRD's anti-soft-delete philosophy — a pre-lock delete is a correction, not a broken promise | Plan |
| Editable fields within window | Description + target only; measure type locked | Simpler form logic; a genuine type mistake is fixed by delete + recreate within the window | Plan |
| Lock-window communication | One-time notice at bundle-commit time, no countdown | Sets the expectation once without client-side timers | Plan |
| Numeric target validation | Positive number, decimals allowed | Covers fractional goals (distance, money) without a rewrite later | Plan |
| Description length | 255 characters | Generous "one-line" budget enforced at both form and DB layers | Plan |
| RLS scope | Ownership-only (`auth.uid() = user_id`) on all 4 operations | Cross-group visibility (FR-012) is S-03's job — widening this policy is deliberately deferred | Plan |

## Scope

**In scope:**
- `goals` table (first migration in the project) with ownership-only RLS
- `src/lib/services/goals.ts` — `listGoals`, `createGoals` (batch), `updateGoals` (batch), `deleteGoal`, `isEditable`
- `POST /api/goals` (bundle create), `POST /api/goals/manage` (batch save + per-row delete)
- `/goals` page: bundle composer + consolidated manage form + read-only locked section
- Relocating `FormField`/`SubmitButton`/`ServerError` to a shared location for reuse

**Out of scope:**
- Recording/incrementing progress (S-04)
- Groups, invites, cross-member visibility (S-02/S-03)
- Quarterly digest (S-05), account deletion/anonymization (S-06)
- Any DB-level (RLS/trigger) enforcement of the 24h window
- JSON/fetch API, live countdown UI, per-goal edit pages

## Architecture / Approach

Bottom-up, same order as `magic-link-auth`: migration + types → service layer (owns the atomic window check and the numeric/boolean discriminated shape) → two thin API routes over the service → UI → docs/verification. The window check lives in the write query itself (`created_at > cutoff` in the UPDATE/DELETE WHERE clause), not in a separate read-then-check step, closing the race between page load and submit.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data model & migration | `goals` table, ownership-only RLS, shared types | Getting the discriminated CHECK constraint right on the first try |
| 2. Service layer | Batch create/update, delete, `isEditable` | Encoding the window check correctly in the query WHERE clause rather than a separate check |
| 3. API routes | Bundle-create route + combined manage (save-all/delete) route | All-or-nothing validation on create; distinguishing save-all vs. delete-by-id from one form's submit buttons |
| 4. UI | Bundle composer (dynamic rows, one React island), consolidated manage form, locked section, nav/middleware wiring | First React island needing new shadcn components (`input`, `label`, `radio-group`) and dynamic row state |
| 5. Docs + full verification | README sync, end-to-end click-through | None significant |

**Prerequisites:** Local Supabase running (`npx supabase start`) for Phase 1 migration and all manual verification.
**Estimated effort:** ~2-3 sessions across 5 phases — new data model plus a full bundle-commit UI slice, but single-user scope keeps it contained.

## Open Risks & Assumptions

- Assumes this app is the only consumer of the Supabase project's database — the basis for enforcing the 24h window in the app layer instead of RLS/a trigger. If a second client ever talks to this DB directly, that assumption needs revisiting.
- All-or-nothing bundle validation is slightly less forgiving than per-row validation — a single typo in a 5-goal bundle means retyping the whole submission (the browser keeps the other fields filled in, so this is a minor friction, not data loss).
- The `user_id` FK's `NO ACTION` default will block Supabase's user-deletion until S-06 explicitly handles detaching it — flagged in Migration Notes so it isn't a surprise later.
- S-03 will need to widen the `SELECT` RLS policy once groups exist — expected, not a gap.

## Success Criteria (Summary)

- A user can commit a bundle of several goals in one form submission and see them all on `/goals` immediately.
- Editing and deleting within 24 hours happen through one consolidated form; both are impossible — via UI or direct API call — after the window closes.
- A user can commit further bundles later, each with its own independent window.
