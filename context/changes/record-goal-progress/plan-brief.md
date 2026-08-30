# Record Goal Progress — Plan Brief

> Full plan: `context/changes/record-goal-progress/plan.md`

## What & Why

Implement FR-007: an authenticated user can record progress on their own goal — add an amount to a numeric measure, or flip a yes/no measure to done. This is roadmap slice S-04, the "progress tracking" branch that runs in parallel with the groups/witnessing work (S-02/S-03) rather than depending on it.

## Starting Point

`goals.current_value` and `goals.is_done` exist in the schema since S-01 but nothing ever writes to them after creation — they're frozen at their initial values (`0` / `false`). The page (`/goals`) currently only supports editing description/target within 24h (`Manage goals`) or viewing locked goals read-only, with zero interactivity for progress.

## Desired End State

Every goal on `/goals` — editable or locked — gets a progress control: an "add amount" input for numeric goals, a "mark as done" checkbox for boolean goals not yet done (a static "✓ Done" label once they are). One shared "Save progress" button commits all changes at once, independent of the 24h edit window.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Numeric input | Add an amount (delta), not a fixed +1 or absolute-value overwrite | Matches how people actually log progress and FR-007's "increment" wording |
| Boolean flip UX | Checkbox + shared "Save progress" button, not an instant-submit button | Lets the user try the control before committing, while still being one-way once saved |
| Save scope | Separate "Save progress" section/button, decoupled from the existing "Save changes" (FR-006 edit) form | FR-007 isn't window-gated like FR-006; it's the only way locked goals get any progress control at all |
| Numeric overshoot | Allowed, no cap | The DB constraint already permits it; capping would silently discard real progress data |
| API design | New dedicated endpoint (`/api/goals/progress`), bundle submit | Keeps `manage.ts`'s windowed edit/delete logic untouched; matches its existing bundle-submit pattern |
| Numeric increment mechanism | Read-then-write in application code, no DB function | Avoids a migration for an atomic RPC; acceptable given the PRD's low-qps/small-scale target |

## Scope

**In scope:**
- `RecordProgressCommand` type, `recordProgress` service function, `POST /api/goals/progress` endpoint
- "Track progress" UI section on `/goals` covering every goal regardless of lock state
- Success (`?progress=1`) / partial-failure (`?error=...`) feedback banners

**Out of scope:**
- Any change to the 24h edit/delete window, `updateGoals`, or `deleteGoal`
- Any migration, RLS change, or DB function/RPC
- Decrementing numeric progress or un-marking a boolean goal as done
- Third-party/external progress sources

## Architecture / Approach

Mirrors the existing `manage.ts` bundle-mutation pattern (parse `field.<id>.subfield` form inputs → zod validate → service call → redirect) as a fully separate vertical, so FR-006 (edit window) and FR-007 (progress) never share a code path.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Service + API | `RecordProgressCommand` type, `recordProgress` function, `/api/goals/progress` endpoint | Non-atomic read-then-write increment could lose an update under concurrent submits for the same goal (accepted risk, single-user low-qps product) |
| 2. UI integration | "Track progress" section on `/goals`, success banner | Visual redundancy — a goal's description now appears in up to three sections on the same page (manage/locked + track progress) |

**Prerequisites:** S-01 (`commit-a-goal`, done) — no other roadmap dependency.
**Estimated effort:** ~1 session across 2 phases; no schema work.

## Open Risks & Assumptions

- The read-then-write numeric increment is not atomic; accepted because the PRD targets `users: small, qps: low` and each user only submits from their own browser.
- No test runner exists in the repo — verification is lint + build + manual only, same ceiling as S-01.

## Success Criteria (Summary)

- A user can add progress to a numeric goal and mark a boolean goal done, on both editable and locked goals, and see it reflected immediately after redirect.
- A boolean goal, once marked done, offers no way to un-mark it.
- A numeric goal can exceed its target without error, and the goal displays as "reached."
