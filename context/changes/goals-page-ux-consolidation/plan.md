# Goals Page UX/UI Consolidation Implementation Plan

## Overview

Rework `/goals` (`src/pages/goals/index.astro`) from its current four sections into two: "Dodaj nowe cele" (unchanged) and a single "Lista celów" where each goal is exactly one card — combining measure/progress display, progress recording, an editable/countdown indicator, and (only while still within the 24h window) inline edit/delete. This is presentation-only: `/api/goals/progress` and `/api/goals/manage` and their underlying service functions in `src/lib/services/goals.ts` do not change behavior.

## Current State Analysis

`src/pages/goals/index.astro` currently renders, after "Dodaj nowe cele":

1. **"Zapisz postęp"** — one `<form method="POST" action="/api/goals/progress">` wrapping ALL goals (editable + locked), one row per goal, one shared "Zapisz postęp" submit button (`src/pages/goals/index.astro:76-128`).
2. **"Zarządzaj celami (edycja przez 24h)"** — one `<form method="POST" action="/api/goals/manage">` wrapping only `editableGoals`, one row per goal, a single shared "Zapisz zmiany" submit button, and a per-row "Usuń" submit button (`name="action" value="delete:<id>"`) (`src/pages/goals/index.astro:130-185`).
3. **"Zablokowane cele"** — a plain read-only `<ul>` over `lockedGoals` (`src/pages/goals/index.astro:187-201`).

`editableGoals`/`lockedGoals` are computed via `isEditable(goal)` (`src/lib/services/goals.ts:58-60`), a pure function comparing `Date.now() - new Date(goal.createdAt).getTime()` against the 24h `EDIT_WINDOW_MS` constant (module-private, not exported).

### Key Discoveries:

- **Shared-form bug in the manage form**: because all editable goals sit in one `<form>`, clicking "Usuń" on one row submits the whole form with `action=delete:<id>`; `manage.ts`'s handler (`src/pages/api/goals/manage.ts:46-55`) checks for the delete-prefixed action FIRST and returns before parsing any edits, so any unsaved edits on sibling rows in the same submission are silently dropped. Splitting each goal into its own `<form>` removes this bug as a side effect — it's not something we're implementing on purpose, but it's worth knowing the current behavior changes.
- **`recordProgress` has no 24h cutoff** (`src/lib/services/goals.ts:150-206`, per FR-007) — progress must remain recordable on both editable and locked goals, so the consolidated card's progress control cannot be gated by `isEditable`.
- **Form field naming is the API contract.** Both endpoints reconstruct one command per goal from flat `FormData` keys via regex (`PROGRESS_FIELD_PATTERN = /^progress\.([^.]+)\.(amount|done)$/` in `progress.ts:16`, `EDIT_FIELD_PATTERN = /^edits\.([^.]+)\.(description|targetValue)$/` in `manage.ts:18`). Nothing requires multiple goals to share one `<form>` — the regex just needs the same field-name shape, one goal per form is equally valid and requires zero backend changes.
- **`manage.ts`'s delete/save branching doesn't actually check the Save button's value** — it only special-cases values starting with `"delete:"`; anything else falls through to edits-parsing. So a per-card Save button needs no `name`/`value` at all, and the Delete button just needs `name="action" value="delete:<id>"`, exactly as today.
- **`SubmitButton` (`src/components/shared/SubmitButton.tsx`) does not forward arbitrary props** — its interface is `{ pendingText, icon, children }` only, no `name`/`value` passthrough. It cannot be used for the Delete button (which needs `name="action" value="delete:<id>"`). Delete must use the plain `Button` component directly.
- **`FormField` (`src/components/shared/FormField.tsx`) is a controlled component** (`value`/`onChange` required, no defaultValue-only mode) — using it requires a hydrated client-side React island holding local state per field, exactly like `GoalBundleForm.tsx` already does successfully with `client:load` and a plain `method="POST" action="..."` form (not a React 19 action prop) — `SubmitButton`'s `useFormStatus()` already works with that exact pattern today, confirming it'll work again here.
- **No test framework exists in this project** (`package.json` has no `test` script, no `*.test.*`/`*.spec.*` files). Prior archived plans (`context/archive/2026-08-30-record-goal-progress/plan.md`, `context/archive/2026-08-29-commit-a-goal/plan.md`) verify with `npm run lint` + `npm run build` only — this plan follows the same convention.
- **`Array.prototype.sort` is stable since ES2019** — `listGoals` already returns goals newest-first (`src/lib/services/goals.ts:67`), so partitioning editable-before-locked with a single-key sort preserves newest-first ordering within each group without a secondary comparator.

## Desired End State

`/goals` shows exactly two sections. "Dodaj nowe cele" is untouched. "Lista celów" renders one `GoalCard` per goal, editable goals first (newest-first), then locked goals (newest-first). Each card shows the description, measure label, and progress-recording controls; an editable card additionally shows a "still editable, ~Xh Ym left" badge and inline edit/delete controls; a locked card shows neither the badge nor the edit/delete controls (no separate "locked" label — its absence from the editable group and its lack of edit controls communicate the state). No API, schema, or service-function behavior changes.

**Verification**: `npm run lint` and `npm run build` pass; manually exercising the golden path and edge cases below on the local dev server confirms behavior parity with today (create → progress → edit → delete → lock) with the new layout.

## What We're NOT Doing

- No new API endpoints, no schema changes, no change to FR-006 (24h edit/delete window) or FR-007 (unrestricted progress recording) enforcement — both stay exactly as implemented today.
- No live-ticking countdown — the remaining-edit-time label is computed once at page render (server-side), matching the page's current zero-JS-timer style.
- No delete confirmation dialog — "Usuń" stays an instant, unconfirmed submit, matching today's behavior.
- No changes to `src/pages/api/goals/{progress,manage,index}.ts` or the exported behavior of `src/lib/services/goals.ts`'s existing functions (`listGoals`, `createGoals`, `updateGoals`, `recordProgress`, `deleteGoal`, `isEditable`) — only one new pure helper is added alongside `isEditable`.
- No changes to "Dodaj nowe cele" / `GoalBundleForm.tsx`.
- No cross-page changes (groups pages, dashboard, etc.).

## Implementation Approach

Extract a single `GoalCard.tsx` React island (`client:load`) that owns everything about rendering and acting on one goal: measure/progress display, the editable-countdown badge, the progress sub-form (always present), and the edit/delete sub-form (present only when editable). `index.astro` computes `isEditable` + a remaining-time label per goal server-side (as it already computes similar per-goal booleans today), sorts editable-before-locked, and replaces its three old sections with one `.map()` over `GoalCard`. Both sub-forms keep the exact field-name contracts the existing API routes already parse, so the backend requires zero changes.

## Phase 1: Build the `GoalCard` component

### Overview

Create the self-contained per-goal card component, with both its sub-forms, independent of how `index.astro` will eventually call it.

### Changes Required:

#### 1. New goal card component

**File**: `src/components/goals/GoalCard.tsx`

**Intent**: Render one goal as a single card: description + measure label (moved here from `index.astro`'s current `measureLabel`/`isReached` helpers), an editable-countdown badge when applicable, a progress-recording sub-form (always present, mirroring today's "Zapisz postęp" row), and an edit/delete sub-form (present only when `editable` is true, mirroring today's "Zarządzaj celami" row).

**Contract**:
- Props: `{ goal: Goal; editable: boolean; remainingLabel: string | null }`. `remainingLabel` is a pre-formatted string (e.g. `"Do edycji: jeszcze 18h 30min"`) computed by the caller when `editable` is true, `null` otherwise — this component does no time math itself.
- Progress sub-form: `<form method="POST" action="/api/goals/progress">` containing, for a numeric goal, a `FormField`-based number input named `progress.${goal.id}.amount` (icon: e.g. `TrendingUp` from `lucide-react`, matching `GoalBundleForm`'s icon convention) plus the existing reached-state display (`current/target`, ✓ + emerald styling when `currentValue >= targetValue`); for a boolean goal, either the "✓ Wykonano" done-state text or a native `<input type="checkbox" name="progress.${goal.id}.done">` with a `Label` ("Oznacz jako wykonane") — `FormField` doesn't fit a checkbox, so this one input stays native, matching today's style. Submit via `SubmitButton` ("Zapisz postęp").
- Edit/delete sub-form (only rendered when `editable`): `<form method="POST" action="/api/goals/manage">` containing a `FormField` for `edits.${goal.id}.description` (icon `PenLine`, `defaultValue`→initial state seeded from `goal.description`) and, for numeric goals, a `FormField` for `edits.${goal.id}.targetValue` (icon `Target`, seeded from `goal.targetValue`); a `SubmitButton` ("Zapisz zmiany") with no `name`/`value` (falls through to the edits-parsing branch, per Key Discoveries); and a plain `Button` (`variant="ghost"`, matching `GoalBundleForm`'s remove-row styling) with `type="submit" name="action" value={`delete:${goal.id}`}` and label "Usuń" — **not** `SubmitButton`, since it doesn't forward `name`/`value`.
- When `editable` is true, render `remainingLabel` as a small badge near the description (e.g. muted pill styling consistent with the card's existing dark/glass theme). When `editable` is false, render neither the badge nor the edit/delete sub-form — no separate "locked" label is shown.
- Both sub-forms must preserve the exact field-name patterns above; nothing else about `progress.ts`/`manage.ts` changes, so any deviation from these names breaks parsing silently (wrong field → not matched by regex → ignored, not an error).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (incl. type-check) passes: `npm run build`

#### Manual Verification:

- With a temporary inline call from a scratch page (or by proceeding to Phase 2 before manually checking — acceptable given Phase 2 is the next step), the component renders without console errors for both a numeric and a boolean goal, editable and locked.

---

## Phase 2: Add the remaining-time helper and rewire `index.astro`

### Overview

Add the one new pure helper `GoalCard` needs, then replace the three old sections in `index.astro` with the sorted `GoalCard` list.

### Changes Required:

#### 1. Remaining edit-time helper

**File**: `src/lib/services/goals.ts`

**Intent**: A pure sibling to `isEditable` that returns milliseconds remaining in the 24h edit window (0 when already locked), for display purposes only — no behavior change to any existing exported function.

**Contract**: `export function editWindowRemainingMs(goal: Pick<Goal, "createdAt">): number { return Math.max(0, EDIT_WINDOW_MS - (Date.now() - new Date(goal.createdAt).getTime())); }`, placed directly below `isEditable` and reusing the same module-private `EDIT_WINDOW_MS` constant (no need to export the constant itself).

#### 2. Rewire the goals page

**File**: `src/pages/goals/index.astro`

**Intent**: Remove the three old sections (`Zapisz postęp`, `Zarządzaj celami`, `Zablokowane cele`) and their now-unused local `measureLabel`/`isReached` helpers (moved into `GoalCard`); add a single "Lista celów" section rendering `GoalCard` per goal, sorted editable-first.

**Contract**:
- Sort: `const sorted = [...goals].sort((a, b) => Number(isEditable(b)) - Number(isEditable(a)));` — relies on stable sort (see Key Discoveries) to preserve `listGoals`'s newest-first order within each group; no secondary comparator needed.
- Per-goal render props: `editable = isEditable(goal)`, `remainingLabel = editable ? formatRemaining(editWindowRemainingMs(goal)) : null`, where `formatRemaining` is a new small local helper in this file (matching the file's existing convention of local pure formatting helpers like today's `measureLabel`):
  ```ts
  function formatRemaining(ms: number): string {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours === 0 ? `Do edycji: jeszcze ${minutes} min` : `Do edycji: jeszcze ${hours}h ${minutes}min`;
  }
  ```
- Replace the three old sections with: `{sorted.map((goal) => <GoalCard goal={goal} editable={isEditable(goal)} remainingLabel={...} client:load />)}`, keeping the existing "brak celów" empty-state paragraph above it unchanged.
- "Dodaj nowe cele" section and its `created`/`progressSaved`/`updated`/`error` banners at the top of the page are untouched.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (incl. type-check) passes: `npm run build`

#### Manual Verification:

- Fresh page load with no goals: unchanged empty-state message under "Dodaj nowe cele".
- Create a numeric + a boolean goal via the bundle form: both appear in "Lista celów" as editable cards with a countdown badge close to 24h.
- Record progress on the numeric goal via its own card: value increments, `?progress=1` banner shows, card still shows the countdown badge.
- Mark the boolean goal done via its own card: card switches to "✓ Wykonano", checkbox disappears.
- Edit the numeric goal's description/target via its own card, save: `?updated=1` banner shows, new values reflected on the card.
- Delete the boolean goal via its own card: it disappears from the list; the numeric goal's card is unaffected (confirms per-card forms are fully independent — see Key Discoveries).
- Force a goal past its 24h window (e.g. update `created_at` directly in the local Supabase DB) and reload: that card shows no countdown badge and no edit/delete controls, but its progress form still works.
- With a mix of editable and locked goals present, editable cards appear before locked cards, each group ordered newest-first.

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Cleanup & verification

### Overview

Confirm nothing dead is left behind and do a final end-to-end pass.

### Changes Required:

#### 1. Dead code sweep

**File**: `src/pages/goals/index.astro`

**Intent**: Verify no leftover references to the removed sections, unused imports, or now-orphaned helper functions remain.

**Contract**: No functional change beyond removing dead code already superseded by Phase 1/2.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (incl. type-check) passes: `npm run build`

#### Manual Verification:

- Full golden-path pass on the local dev server (`npm run dev`): create, record progress, edit, delete, and a locked goal, all via the consolidated "Lista celów" — no regressions vs. Phase 2's manual checks.
- Responsive check at mobile width: cards remain usable (matches the page's existing `p-4 sm:p-8` breakpoint pattern).

---

## Testing Strategy

### Unit Tests:

- None — no test framework exists in this project (see Key Discoveries); verification is lint + build + manual.

### Integration Tests:

- None, for the same reason.

### Manual Testing Steps:

1. Create a goal bundle (one numeric, one boolean) and confirm both show as editable cards with a countdown badge.
2. Record progress on each via its own card; confirm the correct redirect banner and updated display.
3. Edit the numeric goal's description and target via its card; confirm the save.
4. Delete the boolean goal via its card; confirm the numeric goal's card (and any unsaved state on it) is unaffected.
5. Force a goal past 24h (direct DB update in local Supabase) and confirm it shows as a locked card: no badge, no edit/delete controls, progress form still functional.
6. Confirm list ordering: editable cards before locked cards, newest-first within each group.
7. Confirm the empty state and the "Dodaj nowe cele" section are unchanged.

## Performance Considerations

Each `GoalCard` hydrates as its own `client:load` React island, so the number of hydrated islands on the page now scales with the goal count (previously the page had a fixed 1-2 islands regardless of goal count, since progress/edit were plain server-rendered forms). Given the PRD's `target_scale: { users: small, qps: low, data_volume: small }`, this is not a concern for the MVP; revisit only if goal counts per user grow large enough to make per-card hydration cost noticeable.

## Migration Notes

None — no schema or data changes.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-08 (`goals-page-ux-consolidation`)
- PRD refs: FR-005 (view own goals), FR-006 (24h edit/delete window), FR-007 (record progress)
- Analogous working pattern: `src/components/goals/GoalBundleForm.tsx` (client:load React form using `FormField`/`SubmitButton` with a plain `method`/`action` form)
- Current implementation being replaced: `src/pages/goals/index.astro`, `src/lib/services/goals.ts`, `src/pages/api/goals/{progress,manage}.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Build the `GoalCard` component

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Build (incl. type-check) passes: `npm run build`

#### Manual

- [ ] 1.3 Component renders without console errors for numeric/boolean, editable/locked goals

### Phase 2: Add the remaining-time helper and rewire `index.astro`

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Build (incl. type-check) passes: `npm run build`

#### Manual

- [ ] 2.3 Empty state unchanged
- [ ] 2.4 Create numeric + boolean goal — both show as editable cards with countdown badge
- [ ] 2.5 Record progress on numeric goal via its card
- [ ] 2.6 Mark boolean goal done via its card
- [ ] 2.7 Edit numeric goal's description/target via its card
- [ ] 2.8 Delete boolean goal via its card — numeric goal's card unaffected
- [ ] 2.9 Force a goal past 24h — shows locked (no badge/edit controls), progress form still works
- [ ] 2.10 List ordering: editable before locked, newest-first within each group

### Phase 3: Cleanup & verification

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Build (incl. type-check) passes: `npm run build`

#### Manual

- [ ] 3.3 Full golden-path pass on local dev server, no regressions
- [ ] 3.4 Responsive check at mobile width
