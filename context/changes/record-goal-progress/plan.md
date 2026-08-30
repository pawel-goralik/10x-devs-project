# Record Goal Progress Implementation Plan

## Overview

Implement FR-007: an authenticated user can record progress on one of their own goals — add an amount to a numeric goal's current value, or flip a yes/no goal to done. This is roadmap slice S-04, built on top of S-01 (`commit-a-goal`), and is independent of S-02/S-03 (groups/witnessing).

## Current State Analysis

- `public.goals` (`supabase/migrations/20260829164522_create_goals.sql`) stores `current_value` (numeric) and `is_done` (boolean), but nothing in the app writes to them after creation — `current_value` starts at `0`, `is_done` starts at `false`, and both are frozen forever today.
- `src/lib/services/goals.ts` has `createGoals`, `updateGoals`, `deleteGoal`, `isEditable` — all scoped to the FR-006 24h edit/delete window. `updateGoals` (`src/lib/services/goals.ts:103-137`) only ever patches `description`/`target_value`.
- `src/pages/goals/index.astro` renders three sections: the create form, an "editable" section (`src/pages/goals/index.astro:60-115`) backed by `POST /api/goals/manage`, and a read-only "locked goals" `<ul>` (`src/pages/goals/index.astro:117-131`) with no interactive affordance at all.
- `src/pages/api/goals/manage.ts` is the established pattern for a bundle-style mutation endpoint: parse `field.<id>.subfield` form fields into per-id rows with a regex (`manage.ts:18-30`), zod-validate, call a service function, redirect to `/goals` or `/goals?error=...`.

### Key Discoveries:

- The `goals_update_own` RLS policy (`supabase/migrations/20260829164522_create_goals.sql:63-67`) allows the owner to update any column at any time — the 24h window is enforced only in the application query (`updateGoals`'s `.gt("created_at", cutoff)`, `goals.ts:126`), not in RLS. FR-007 has no time window, so **no migration or RLS change is needed**; a new service function can update `current_value`/`is_done` without any cutoff check.
- The `goals_measure_shape` CHECK constraint (`...create_goals.sql:28-32`) puts no upper bound on `current_value` — it only requires `current_value >= 0` for numeric goals. This confirms overshoot (current_value > target_value) is already a legal DB state.
- Locked goals currently have zero interactivity, so a progress control must be added there as new markup (not an extension of an existing form), while editable goals already sit inside a `<form>` whose action is FR-006-scoped and must not be reused for FR-007.

## Desired End State

On `/goals`, every committed goal — whether inside or outside its 24h edit window — has a progress control: numeric goals show an "add amount" input, boolean goals not yet done show a "mark as done" checkbox (already-done boolean goals show a static "Done" indicator instead). All controls sit inside one form with a single "Save progress" button. Submitting it increments each changed numeric goal's `current_value` by the entered amount (no cap, can exceed target) and flips each checked boolean goal's `is_done` to `true` (one-way — no un-check affordance, ever). The page redirects back to `/goals` with a success or partial-failure message, following the existing `?created=1` / `?error=...` convention.

Verify by: creating a numeric and a boolean goal, recording progress on each while still inside the 24h window and (simulated) after it closes, and confirming the values persist and boolean goals can't be un-done.

## What We're NOT Doing

- No change to the 24h edit/delete window or to `updateGoals`/`deleteGoal` — FR-006 is untouched.
- No migration, no new RLS policy, no new DB function/RPC for atomic increments — accepted as a reasonable simplification given `target_scale: { users: small, qps: low, data_volume: small }` in the PRD frontmatter; see Critical Implementation Details below.
- No cap/clamp on `current_value` at `target_value` — overshoot is allowed and simply displays as "reached."
- No way to decrement a numeric goal's progress or un-mark a boolean goal as done — both are one-way per FR-007/the product's commitment-device framing.
- No third-party/external progress sources — manual entry only (PRD Non-Goals).
- No changes to `src/middleware.ts` — the new API route follows the existing inline `if (!user) return context.redirect(...)` pattern used by `index.ts`/`manage.ts`, not the `PROTECTED_ROUTES` gate (which only covers page routes).

## Implementation Approach

Mirror the existing `manage.ts` bundle-mutation pattern exactly, but as a fully separate vertical: a new `RecordProgressCommand` type, a new `recordProgress` service function, and a new `POST /api/goals/progress` endpoint — none of them touch FR-006's edit/delete code path. On the page, add a new "Track progress" section that lists every goal (editable + locked) with its progress control, independent of the existing "Manage goals" and "Locked goals" sections.

## Critical Implementation Details

**State sequencing (numeric increment)**: there is no Postgres function for an atomic `current_value + amount` update, and adding one would require a migration this plan deliberately avoids. `recordProgress` must therefore do a read-then-write per numeric row: `SELECT current_value ... WHERE id = ? AND user_id = ? AND measure_type = 'numeric'`, compute `newValue = current_value + amount` in application code, then `UPDATE ... SET current_value = newValue WHERE id = ? AND user_id = ?`. This is a two-round-trip, non-atomic read-modify-write — acceptable because a single user submitting from a single browser tab is the only realistic writer (PRD: `users: small`, `qps: low`), but it means two concurrent submits for the same goal could lose an update. Do not "fix" this with an RPC/migration without checking with the user first — it's an explicit scope boundary above, not an oversight.

## Phase 1: Progress recording service + API endpoint

### Overview

Add the command type, the service function that applies progress updates, and the API route that parses the form bundle and calls it — no UI changes yet.

### Changes Required:

#### 1. Progress command type

**File**: `src/types.ts`

**Intent**: Add the DTO for a progress-recording submission, mirroring the existing `CreateGoalCommand`/`UpdateGoalCommand` discriminated-union style already in this file.

**Contract**: `export type RecordProgressCommand = { id: string; measureType: "numeric"; amount: number } | { id: string; measureType: "boolean" };` — the boolean variant always means "mark done" (no `isDone` field needed since there's only one legal direction).

#### 2. `recordProgress` service function

**File**: `src/lib/services/goals.ts`

**Intent**: Apply a bundle of progress commands for one user, following the same per-row loop + `updated`/`skipped` result shape as `updateGoals` (`goals.ts:103-137`), but with no 24h cutoff check at all.

**Contract**: `export async function recordProgress(supabase: SupabaseClient, userId: string, commands: RecordProgressCommand[]): Promise<{ updated: string[]; skipped: string[] }>`. For a `numeric` command: read-then-add `current_value` as described in Critical Implementation Details, scoped by `.eq("id", ...).eq("user_id", userId).eq("measure_type", "numeric")`; a missing/foreign row goes to `skipped`. For a `boolean` command: `.update({ is_done: true, updated_at: ... })` scoped by `.eq("id", ...).eq("user_id", userId).eq("measure_type", "boolean")`; zero rows affected (already done, wrong type, or not owned) goes to `skipped`.

#### 3. Progress API endpoint

**File**: `src/pages/api/goals/progress.ts` (new)

**Intent**: New route, `export const prerender = false`, following `manage.ts`'s exact shape: auth check → parse `progress.<id>.amount` / `progress.<id>.done` form fields into per-id rows via a regex reconstruction (same technique as `manage.ts:18-30`/`index.ts:23-36`) → zod-validate → call `recordProgress` → redirect.

**Contract**: form field names `progress.<id>.amount` (present → numeric add-amount row; zod `z.coerce.number().positive()`) and `progress.<id>.done` (present with value `"on"` → boolean mark-done row; zod `z.literal("on")`). Row schema: `z.union([z.object({ id: z.uuid(), amount: z.coerce.number().positive() }), z.object({ id: z.uuid(), done: z.literal("on") })])`, array un-bounded (no `.min(1)` — an empty submission is a valid no-op, not an error). Map parsed rows to `RecordProgressCommand[]` before calling `recordProgress`. On success with no skips, redirect to `/goals?progress=1`; if any ids were skipped, redirect to `/goals?error=...` naming the count, matching `manage.ts:66-68`'s phrasing style; on empty input, redirect to `/goals` with no banner.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (incl. type-check) passes: `npm run build`

#### Manual Verification:

- `curl`/Postman a POST to `/api/goals/progress` with a valid `progress.<id>.amount` for an owned numeric goal and confirm `current_value` increases in Supabase Studio.
- Same for `progress.<id>.done=on` on an owned boolean goal and confirm `is_done` flips to `true`.
- Confirm a progress submission for another user's goal id is a no-op (row appears in `skipped`, nothing changes) via the RLS-scoped query.

---

## Phase 2: UI integration

### Overview

Add the "Track progress" section to `/goals` and wire the success/error banner.

### Changes Required:

#### 1. Track progress section

**File**: `src/pages/goals/index.astro`

**Intent**: Render one progress control per goal (both `editableGoals` and `lockedGoals`, i.e. every goal returned by `listGoals`), inside a single new form posting to `/api/goals/progress`, positioned after the "Commit new goals" card and before the existing "Manage goals" section — progress tracking is the primary recurring action FR-007 targets, ahead of the administrative edit/lock views.

**Contract**: for each goal: numeric → a `progress.${goal.id}.amount` number input (`min="0"` `step="any"`, matching the existing target-value input's style at `index.astro:84-91`) alongside a `current / target` display; boolean and not `isDone` → a `progress.${goal.id}.done` checkbox labeled "Mark as done"; boolean and `isDone` → a static "✓ Done" label, no input. One shared submit button, `type="submit"`, no `name`/`value` needed (the endpoint has only one action). Reuses the existing `goals.length === 0` empty-state guard — the new section only renders when `goals.length > 0`.

#### 2. Success banner

**File**: `src/pages/goals/index.astro`

**Intent**: Extend the existing banner block to also recognize a progress-save confirmation, following the same pattern as the `created` param (`index.astro:10-11`, `33-39`).

**Contract**: add `const progressSaved = Astro.url.searchParams.get("progress") === "1";` and a conditional block rendering a success message (e.g. "Progress saved.") using the same emerald styling as the `created` banner.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Load `/goals` with at least one numeric and one boolean goal in both the editable (< 24h) and locked (> 24h) states; confirm all four combinations render the correct control (amount input, checkbox, or "✓ Done").
- Add an amount to a numeric goal, submit, confirm the new value displays after redirect and the `?progress=1` banner appears.
- Check a boolean goal's checkbox, submit, confirm it now renders as "✓ Done" with no checkbox, and reloading the page does not offer any way to un-check it.
- Enter an amount that pushes `current_value` past `target_value`; confirm it saves without error and displays as "reached" rather than being clamped.
- Submit the progress form with nothing checked/filled; confirm it redirects back to `/goals` with no error banner.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

No test runner exists in this repo (`package.json` has no `test` script) — this plan does not introduce one. Verification is lint + build + manual testing, matching S-01's plan.

### Integration Tests:

N/A — see above.

### Manual Testing Steps:

1. Create a numeric goal (e.g. target 10) and a boolean goal via the existing create form.
2. Immediately (within 24h) add progress to the numeric goal and mark the boolean goal done via the new "Track progress" section; confirm both persist and the boolean goal switches to its static "✓ Done" state.
3. Simulate the post-24h state (e.g. by adjusting `created_at` directly in Supabase Studio for a test goal) and confirm the numeric goal still accepts an added amount even though its "Manage goals" edit fields are gone (it's in the "Locked goals" section).
4. Add an amount that overshoots the numeric target; confirm no error and the display reflects "reached" with the true raw value.
5. Attempt to submit progress for a goal id that isn't the signed-in user's (e.g. via browser dev tools tampering the form) and confirm nothing changes (RLS + the service's `user_id` scoping block it).

## Performance Considerations

None beyond what's already noted in Critical Implementation Details — the per-row read-then-write is a non-issue at the PRD's stated `low` qps / `small` data volume.

## Migration Notes

None — no schema or RLS changes in this plan.

## References

- Roadmap: `context/foundation/roadmap.md` (S-04: record-goal-progress)
- PRD: `context/foundation/prd.md` (FR-007)
- Prior implementation (pattern source): `context/archive/2026-08-29-commit-a-goal/plan.md`
- Similar bundle-mutation endpoint: `src/pages/api/goals/manage.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Progress recording service + API endpoint

#### Automated

- [ ] 1.1 Lint passes: `npm run lint`
- [ ] 1.2 Build (incl. type-check) passes: `npm run build`

#### Manual

- [ ] 1.3 POST a valid numeric progress amount for an owned goal and confirm `current_value` increases
- [ ] 1.4 POST a boolean mark-done for an owned goal and confirm `is_done` flips to `true`
- [ ] 1.5 Confirm a progress submission for another user's goal id is a no-op

### Phase 2: UI integration

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build passes: `npm run build`

#### Manual

- [ ] 2.3 All four goal-state combinations (numeric/boolean × editable/locked) render the correct control
- [ ] 2.4 Adding numeric progress persists and shows the `?progress=1` banner
- [ ] 2.5 Marking a boolean goal done removes the checkbox and cannot be un-done
- [ ] 2.6 Overshooting the numeric target saves without error and displays as "reached"
- [ ] 2.7 Submitting with nothing filled redirects with no error banner
