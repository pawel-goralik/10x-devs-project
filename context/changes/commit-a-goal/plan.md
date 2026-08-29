# Commit a Goal Implementation Plan

## Overview

Add the first goals vertical slice: an authenticated user commits a bundle of one or more goals in a single form (each with a one-line description and a numeric-target or yes/no measure), sees them on a new personal `/goals` page, and can adjust or remove any of them — through one consolidated form — only within 24 hours of that bundle's creation. After the window closes, each goal is permanently locked. This is roadmap slice S-01 (`commit-a-goal`), covering PRD US-01, FR-004, FR-005, FR-006.

## Current State Analysis

No goals infrastructure exists yet. `supabase/migrations/` doesn't exist (the project currently relies solely on Supabase Auth's built-in `auth.users` table). `src/types.ts` doesn't exist. `src/lib/services/` doesn't exist. No `src/pages/goals/` or `src/pages/api/goals/` routes exist. Magic-link auth (roadmap F-01) is fully shipped, so `context.locals.user` is reliably populated for any signed-in request — this slice builds directly on top of it.

## Desired End State

An authenticated user visits `/goals` and, in one form, adds as many goals as they have in mind (each a description plus a numeric target or yes/no measure), then submits them all together as one bundle. All goals in that bundle share the same commit moment, so their 24-hour windows expire in lockstep. While inside the window, the user adjusts descriptions/targets or removes goals through one consolidated "manage" form on the same page; once a goal's window closes, it becomes permanently read-only — no UI affordance or API path can change or remove it. A user can return later and commit further goals in a new bundle (each with its own fresh window) — creation isn't a one-time-ever action. An unauthenticated visitor hitting `/goals` is redirected to `/auth/signin`.

**Verification**: work through the manual test steps listed under each phase's Success Criteria; Phase 5's full click-through is the final end-to-end confirmation.

### Key Discoveries:

- `src/middleware.ts:4` — `PROTECTED_ROUTES` is a flat string array matched via `pathname.startsWith(route)`; `/goals` must be appended.
- `src/lib/supabase.ts:5-8` — `createClient()` returns `null` when env vars are missing; every new route/page must null-check exactly like the existing auth routes.
- `src/pages/api/auth/{request-link,callback,signout}.ts` — zero JSON-response precedent exists in this codebase. All three routes validate with zod, then respond via `context.redirect(...)`, with errors passed as a `?error=` query string. This plan continues that convention rather than introducing a fetch/JSON layer — these actions are inherently low-frequency, so the added complexity of a JSON API wouldn't pay for itself.
- `src/lib/services/` does not exist yet — this plan's `goals.ts` is the first instance of the service-extraction pattern CLAUDE.md describes.
- Only `src/components/ui/button.tsx` is installed from shadcn; `input`, `label`, and `radio-group` need adding via `npx shadcn@latest add`.
- `src/components/auth/{FormField,SubmitButton,ServerError}.tsx` are fully generic (label/icon/error wrapper, `useFormStatus`-driven submit button, error banner) despite living under `auth/`. Relocating them to `src/components/shared/` avoids duplicating ~120 lines for the new goal forms.
- `supabase/migrations/` doesn't exist — this is the first migration in the project, following CLAUDE.md's `YYYYMMDDHHmmss_short_description.sql` naming convention.

## What We're NOT Doing

- No progress-recording UI or logic (incrementing a numeric value, flipping yes/no to done) — that's S-04 (`record-goal-progress`). The `current_value`/`is_done` columns exist from this migration but this slice only ever sets them to their creation-time defaults, and they are never editable through the manage form (not even within the 24h window).
- No group creation, invites, or cross-member visibility — that's S-02/S-03.
- No quarterly digest — S-05.
- No account deletion or anonymization handling — S-06.
- No frequency-style goals, no third-party progress integrations (PRD Non-Goals).
- No database trigger or operator-proof enforcement of the 24-hour window — the PRD explicitly scopes immutability enforcement to the product surface (API/UI), not the datastore.
- No JSON/fetch-based API for create/edit/delete — deliberate choice given how infrequently these actions occur.
- No live countdown timer UI for the lock window — a one-time notice at bundle-commit time is shown instead.
- No dedicated per-goal edit page — adjusting a goal within its window happens inline, in one consolidated form alongside every other still-editable goal.
- No limit on how many separate bundles a user can commit over time — each bundle-create action is independent and starts its own synchronized window; this is not a single-use ritual gate.

## Implementation Approach

Build bottom-up in the same order `magic-link-auth` used: data contract first (migration + types), then business rules (service layer, including the discriminated numeric/boolean shape and the 24-hour window check), then the thin API layer over those rules, then UI, then docs + full verification. Bundle members get an identical `created_at` because they're inserted via a single multi-row `INSERT` (Postgres evaluates `now()` once per statement) — no separate "bundle" concept is needed in the schema for their windows to move in lockstep. The window check itself is enforced directly in the `UPDATE`/`DELETE` query's `WHERE` clause (alongside ownership), so a zero-rows-affected result *is* the "locked" signal — there is exactly one place or writes are gated, and it needs no separate read-then-check step.

## Critical Implementation Details

**Discriminated measure invariant.** `measure_type` determines which columns are populated: `numeric` requires `target_value` and `current_value` non-null with `is_done` null; `boolean` requires the opposite. A single CHECK constraint enforces this at the database level, but every write path (create, and any future S-04 progress write) must independently set the *other* branch's columns to `NULL` — the CHECK constraint will reject a mismatch, but the service layer is what has to construct a correct row in the first place.

**Bundle commit is all-or-nothing.** Creating a bundle validates every row before inserting any of them; a single bad row (blank description, non-positive target) rejects the *entire* submission with a redirect back to the still-filled-in form, rather than partially committing some goals and silently dropping others. This matches the "commit" framing — the user consciously finalizes a set together, and a partial commit would leave them unsure which goals actually locked in.

**24-hour window enforcement, and where it lives.** The window is never encoded in RLS or a trigger — it's enforced entirely in `src/lib/services/goals.ts`, by including `created_at > <cutoff>` directly in the `UPDATE`/`DELETE` query's `WHERE` clause alongside `user_id = auth.uid()`. This was a deliberate choice: the PRD's Access Control section states immutability is enforced "at the product surface... not cryptographic tamper-proofing," and this codebase has no other consumer of the database that could bypass the app layer. Encoding the check in the query itself (rather than fetching the goal, checking `isEditable` in JS, then issuing a separate write) closes the small race window between page load and submit — if the goal's window closed in the meantime, the write simply affects zero rows, which the manage route must treat as "skipped due to window closing," not as an unexpected error. `isEditable()` still exists as a pure function, used only for deciding what to *render* (editable input vs. read-only text). S-04's future progress-update function must be a separate service call with no window check at all — reusing `updateGoals` for progress writes would incorrectly lock progress after 24 hours.

## Phase 1: Data model & migration

### Overview

Introduce the `goals` table with ownership-only RLS and the shared TypeScript types the rest of the slice depends on.

### Changes Required:

#### 1. Goals table migration

**File**: `supabase/migrations/20260829164522_create_goals.sql`

**Intent**: Create the `goals` table encoding the numeric/boolean discriminated measure via CHECK constraints, and enable RLS with four per-operation, ownership-only policies. The 24-hour edit/delete window is deliberately *not* encoded here (see Critical Implementation Details) — RLS only ever checks `auth.uid() = user_id`.

**Contract**: Table `public.goals` with columns `id, user_id, description, measure_type, target_value, current_value, is_done, created_at, updated_at`; a CHECK constraint enforcing the discriminated shape; an index on `user_id`; RLS enabled with `goals_select_own`, `goals_insert_own`, `goals_update_own`, `goals_delete_own` policies, each `auth.uid() = user_id`. The `user_id` foreign key deliberately has no `ON DELETE` action (defaults to `NO ACTION`) — see Migration Notes.

```sql
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  description varchar(255) not null,
  measure_type text not null check (measure_type in ('numeric', 'boolean')),
  target_value numeric,
  current_value numeric,
  is_done boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_description_not_blank check (char_length(trim(description)) > 0),
  constraint goals_measure_shape check (
    (measure_type = 'numeric' and target_value > 0 and current_value is not null and current_value >= 0 and is_done is null)
    or
    (measure_type = 'boolean' and target_value is null and current_value is null and is_done is not null)
  )
);

create index goals_user_id_idx on public.goals (user_id);

alter table public.goals enable row level security;

create policy "goals_select_own" on public.goals
  for select
  using (auth.uid() = user_id);

create policy "goals_insert_own" on public.goals
  for insert
  with check (auth.uid() = user_id);

create policy "goals_update_own" on public.goals
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "goals_delete_own" on public.goals
  for delete
  using (auth.uid() = user_id);
```

#### 2. Shared entity types

**File**: `src/types.ts`

**Intent**: Define the Goal entity and command DTOs shared by the service layer, API routes, and UI.

**Contract**: `MeasureType = "numeric" | "boolean"`; a `GoalMeasure` discriminated union (`GoalNumericMeasure` with `targetValue`/`currentValue`, `GoalBooleanMeasure` with `isDone`); `Goal = { id, userId, description, createdAt, updatedAt } & GoalMeasure`; `CreateGoalCommand` (one bundle row); `UpdateGoalCommand` (`id`, `description`, optional `targetValue`).

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` applies the new migration cleanly against the local Postgres instance
- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- In local Supabase Studio, attempting to insert a `measure_type = 'numeric'` row with `is_done` non-null (or vice versa) is rejected by `goals_measure_shape`
- Querying `goals` as one authenticated user via the anon client returns no rows belonging to a different user (RLS ownership verified)

---

## Phase 2: Service layer

### Overview

Encapsulate all goal business rules — including the atomic 24-hour window check — in one module, so API routes stay thin.

### Changes Required:

#### 1. Goals service

**File**: `src/lib/services/goals.ts`

**Intent**: Provide `listGoals`, `createGoals` (bundle insert), `updateGoals` (batch edit), `deleteGoal`, and an `isEditable` helper used only for rendering decisions.

**Contract**:
- `isEditable(goal: Pick<Goal, "createdAt">): boolean` — `createdAt` within the last 24 hours.
- `createGoals(supabase, userId, commands: CreateGoalCommand[])` — one multi-row insert; each command produces a row satisfying the discriminated-measure invariant (the inactive branch's columns set to `null`, `current_value`/`is_done` defaulted). Returns the inserted rows or a validation failure; never partially inserts.
- `updateGoals(supabase, userId, edits: UpdateGoalCommand[])` — for each edit, issues an update filtered by `id`, `user_id = userId`, and `created_at > <cutoff computed at call time>`; returns which ids were updated and which were skipped (zero rows affected = window closed or not owned).
- `deleteGoal(supabase, userId, goalId)` — same filtered-delete pattern; returns whether a row was actually removed.

### Success Criteria:

#### Automated Verification:

- `npx astro check` passes
- `npm run lint` passes

---

## Phase 3: API routes

### Overview

Two thin request/response routes over the service layer, following the existing auth routes' form-POST + redirect + `?error=` convention.

### Changes Required:

#### 1. Bundle create route

**File**: `src/pages/api/goals/index.ts`

**Intent**: Accept a bundle-creation form submission (one or more goal rows), validate all of them together, and create them as one all-or-nothing batch.

**Contract**: `export const prerender = false; export const POST: APIRoute`. Parses indexed form fields (e.g. `goals.0.description`, `goals.0.measureType`, `goals.0.targetValue`, `goals.1....`) into an array, validates it with a zod array of a `discriminatedUnion("measureType", ...)` schema (description non-blank/≤255; `targetValue` a positive number, required only when `measureType === "numeric"`; array length between 1 and 20). On any row's validation failure or a missing Supabase client, redirects to `/goals?error=...` with none of the rows created. On success, calls `createGoals` and redirects to `/goals?created=1`.

#### 2. Manage (update + delete) route

**File**: `src/pages/api/goals/manage.ts`

**Intent**: Handle both "save all edits" and "delete one goal" from the single consolidated manage form, distinguished by which submit button was clicked.

**Contract**: `export const prerender = false; export const POST: APIRoute`. Reads an `action` field: `"save-all"` validates and applies every submitted row via `updateGoals`, redirecting to `/goals` on full success or `/goals?error=...` naming how many were skipped because their window closed since page load; `"delete:<id>"` calls `deleteGoal` for that one id, redirecting to `/goals` on success or `/goals?error=...` if it was already locked.

### Success Criteria:

#### Automated Verification:

- `npx astro check` passes
- `npm run lint` passes
- `npm run build` succeeds (Cloudflare adapter build includes the new routes)

#### Manual Verification:

- Submitting a 3-row bundle (e.g. "Sell 2 applications" / numeric target 2, "Read 5 books" / numeric target 5, "Make a new friend" / yes-no) creates all three rows with the same `created_at` and redirects to `/goals?created=1`
- Submitting a bundle where one row has a blank description creates none of the rows and redirects to `/goals?error=...`
- Manually backdating one goal's `created_at` to >24h old, then submitting "save all" with that goal included, updates the other rows but reports the backdated one as skipped
- Attempting to delete a goal owned by a different account (tested via a second local account) is rejected

---

## Phase 4: UI

### Overview

Build the `/goals` page: a bundle-create composer, a consolidated manage form for still-editable goals, and a read-only section for locked ones.

### Changes Required:

#### 1. Relocate shared form primitives

**File**: `src/components/shared/{FormField,SubmitButton,ServerError}.tsx` (moved from `src/components/auth/`)

**Intent**: Reuse the existing generic form primitives for the new goal forms instead of duplicating them; update `MagicLinkForm.tsx`'s imports accordingly.

**Contract**: No behavior change — a straight relocation plus import-path updates in `src/components/auth/MagicLinkForm.tsx`.

#### 2. Add missing shadcn components

**Intent**: Install `input`, `label`, and `radio-group` via `npx shadcn@latest add input label radio-group`, needed for the goal rows' description field, labels, and measure-type choice.

**Contract**: New files under `src/components/ui/`, "new-york" style, matching `button.tsx`'s existing convention.

#### 3. Bundle create composer

**File**: `src/components/goals/GoalBundleForm.tsx`

**Intent**: A client-side React island managing a dynamic list of goal rows (starting with one) — each row has a description field, a measure-type `radio-group`, and a conditional numeric target input. "Add another goal" appends a row (soft cap 20); each row past the first gets a "Remove" button. One "Commit goals" submit posts every row as one native form submission — no client-side fetch.

**Contract**: Renders inputs named so the server can reconstruct an ordered array (`goals.<index>.<field>`); uses the relocated `FormField`/`SubmitButton`/`ServerError` and the new shadcn components; posts to `/api/goals`.

#### 4. Consolidated manage form

**Intent**: On `/goals`, render every still-editable goal (per `isEditable`) as an inline-editable row — description input, target input (numeric goals only), a per-row "Delete" submit button, and measure type shown as read-only text — all inside one `<form method="POST" action="/api/goals/manage">` with a single "Save changes" submit button alongside the per-row delete buttons.

**Contract**: Plain Astro markup (no React needed — the row count is fixed at render time, and HTML natively supports multiple named submit buttons in one form to distinguish "save-all" from "delete:<id>"). Locked goals render separately, read-only, outside this form.

#### 5. Goals list page

**File**: `src/pages/goals/index.astro`

**Intent**: Protected page combining the bundle composer, the manage form, and the read-only locked-goals section. Shows a one-time notice when `?created=1` is present, an error banner when `?error=` is present, and an empty-state message (composer only, no manage/locked sections) when the user has no goals at all.

**Contract**: Reads `Astro.locals.user`; calls `listGoals`; renders `GoalBundleForm` via `client:load`; the composer is always present, not hidden after a user's first bundle.

#### 6. Route protection and navigation

**File**: `src/middleware.ts`, `src/components/Topbar.astro`

**Intent**: Gate `/goals` behind authentication and surface it in navigation.

**Contract**: Append `/goals` to `PROTECTED_ROUTES` (`src/middleware.ts:4`); add a "My Goals" link to `/goals` in `Topbar.astro`'s authenticated-state branch.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` succeeds

#### Manual Verification:

- Signed in with zero goals, `/goals` shows the empty-state message and the bundle composer only
- Committing a 3-row bundle ("Sell 2 applications" numeric/2, "Read 5 books" numeric/5, "Make a new friend" yes-no) shows all three in the manage section with the one-time "locks in 24h" notice (shown once, gone on next page load)
- Using "Add another goal" / "Remove" in the composer correctly grows/shrinks the row count before submission
- Editing two goals' descriptions/targets and clicking "Save changes" updates both in one submission
- Clicking a single goal's "Delete" button removes only that goal, leaving the others untouched
- Backdating one goal's `created_at` past 24h (via Studio) moves it out of the manage form into the read-only locked section
- An unauthenticated visitor hitting `/goals` is redirected to `/auth/signin`

---

## Phase 5: Docs sync + full verification

### Overview

Bring README/CLAUDE.md in line with the new schema and confirm the whole slice end-to-end.

### Changes Required:

#### 1. Documentation sync

**File**: `README.md`

**Intent**: Replace the now-inaccurate "No database tables or migrations are required" statement with a note that `npx supabase start` / `npx supabase db reset` applies the `goals` migration automatically.

**Contract**: Update the Supabase Configuration section only; no other doc changes needed (CLAUDE.md's existing conventions already cover this feature's patterns).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx astro check` passes
- `npm run build` succeeds

#### Manual Verification:

- Full click-through repeated end-to-end: sign in → commit a 3-goal bundle → edit one and delete another via the manage form within the window → backdate the remaining goal past 24h and confirm it becomes read-only and rejects direct API calls → commit a second, later bundle to confirm creation isn't one-time-only → sign out → confirm `/goals` redirects when signed out

---

## Testing Strategy

No automated test framework exists in this repo (established in `magic-link-auth`); this plan follows the same verification approach.

### Manual Testing Steps:

1. Sign in via magic link, land on `/goals` with no goals — confirm empty state (composer only).
2. In one bundle, add three rows: "Sell 2 applications" (numeric, target 2), "Read 5 books" (numeric, target 5), "Make a new friend" (yes/no) — commit them together. Confirm all three appear with identical `created_at` and the one-time notice.
3. In the manage form, edit "Sell 2 applications" → "Sell 2 mobile apps" and "Read 5 books" → target 6, then "Save changes" — confirm both persist and "Make a new friend" (untouched) is unaffected.
4. Click "Delete" on "Make a new friend" — confirm only that goal is removed.
5. In Studio, set one remaining goal's `created_at` to 25 hours ago — confirm it moves to the read-only locked section, and a direct POST to `/api/goals/manage` targeting it is rejected (skipped).
6. Commit a second bundle with one new goal — confirm it's created successfully and gets its own fresh 24h window, independent of the first bundle's now-locked goals.
7. Sign out and hit `/goals` directly — confirm redirect to `/auth/signin`.

## Performance Considerations

Target scale is small (per PRD frontmatter: `users: small`, `qps: low`, `data_volume: small`); no caching or pagination is needed. A single index on `user_id` keeps the per-user goal list query cheap as the table grows. Bundle size is capped at 20 rows per submission, which bounds the cost of the all-or-nothing validation and the single multi-row insert.

## Migration Notes

- **`user_id` has no `ON DELETE` action.** This is deliberate: FR-014 requires a deleted user's goals to persist, anonymized to "former member," not be removed. The default `NO ACTION` will cause Supabase's user-deletion to fail with a foreign-key violation while the user still has goals — forcing S-06 (`anonymize-on-account-deletion`) to explicitly detach `user_id` (which will require altering the column to be nullable) before removing the auth user, rather than silently cascading a delete that would violate the guardrail.
- **The `SELECT` policy is intentionally ownership-only.** S-03 (`witness-the-circles-goals`) will need to alter `goals_select_own` once `group_members` exists, to also allow access when the goal's author shares a group with the requester. That widening is S-03's responsibility, not a gap in this plan — cross-group visibility (FR-012) is explicitly out of scope for S-01.

## References

- PRD: `context/foundation/prd.md` — US-01, FR-004, FR-005, FR-006, Access Control, Business Logic
- Roadmap: `context/foundation/roadmap.md` — S-01 (`commit-a-goal`)
- Pattern to imitate: `context/changes/magic-link-auth/plan.md` (phase structure, verification approach, zod/redirect conventions)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data model & migration

#### Automated

- [x] 1.1 `npx supabase db reset` applies the new migration cleanly — 236396a
- [x] 1.2 `npx astro check` passes — 236396a
- [x] 1.3 `npm run lint` passes — 236396a

#### Manual

- [x] 1.4 CHECK constraint rejects a mismatched measure-type row in Studio — 236396a
- [x] 1.5 RLS ownership verified (cross-user query returns no rows) — 236396a

### Phase 2: Service layer

#### Automated

- [x] 2.1 `npx astro check` passes — 9a3e846
- [x] 2.2 `npm run lint` passes — 9a3e846

### Phase 3: API routes

#### Automated

- [x] 3.1 `npx astro check` passes
- [x] 3.2 `npm run lint` passes
- [x] 3.3 `npm run build` succeeds

#### Manual

- [x] 3.4 3-row bundle submission creates all rows with identical `created_at`
- [x] 3.5 Bundle with one invalid row creates nothing and redirects with error
- [x] 3.6 Save-all with one backdated goal updates the rest and reports the backdated one skipped
- [x] 3.7 Delete of another user's goal is rejected

### Phase 4: UI

#### Automated

- [ ] 4.1 `npm run lint` passes
- [ ] 4.2 `npx astro check` passes
- [ ] 4.3 `npm run build` succeeds

#### Manual

- [ ] 4.4 Empty state shown with zero goals
- [ ] 4.5 3-row bundle commit shows all goals + one-time notice
- [ ] 4.6 Add/remove row controls work correctly before submission
- [ ] 4.7 Save-all updates multiple edited rows in one submission
- [ ] 4.8 Per-row delete removes only the targeted goal
- [ ] 4.9 Backdated goal moves to the read-only locked section
- [ ] 4.10 Unauthenticated visitor redirected from `/goals`

### Phase 5: Docs sync + full verification

#### Automated

- [ ] 5.1 `npm run lint` passes
- [ ] 5.2 `npx astro check` passes
- [ ] 5.3 `npm run build` succeeds

#### Manual

- [ ] 5.4 Full end-to-end click-through completed successfully, including a second later bundle
