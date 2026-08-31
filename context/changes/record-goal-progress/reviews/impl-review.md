<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Record Goal Progress Implementation Plan

- **Plan**: context/changes/record-goal-progress/plan.md
- **Scope**: Phase 1 and 2 of 2 (full plan)
- **Date**: 2026-08-31
- **Verdict**: REJECTED
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL |

## Findings

### F1 — Blank amount input on any other goal breaks the entire progress submission

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability/correctness) — also causes Success Criteria FAIL
- **Location**: src/pages/api/goals/progress.ts:19-28, 42
- **Detail**:
  `src/pages/goals/index.astro:85-92` renders a `progress.<id>.amount` number input, unconditionally, for **every** numeric goal on the page (no `value`, not conditionally rendered). Real browsers always include text/number inputs in a form submission, even when left blank — only unchecked checkboxes are omitted. So on submit, `FormData` contains `progress.<id>.amount=""` for every numeric goal the user did *not* fill in this round.

  `parseProgress` (progress.ts:19-28) turns every matching field into a row regardless of value, so those blank inputs become rows like `{ id, amount: "" }`. `progressSchema` (progress.ts:9-14) is `z.array(z.union([...]))`, and `safeParse` validates the whole array atomically — one bad row fails the entire request. `z.coerce.number()` on `""` coerces to `0` (verified: `Number("") === 0` in JS), which then fails `.positive()`. The row also can't fall through to the `done` union member (no `done` key). Verified directly:
  ```
  progressSchema.safeParse([
    { id: "<numeric-goal-id>", amount: "" },   // blank, untouched goal
    { id: "<other-goal-id>",  amount: "4" },   // the one goal actually filled in
  ])
  // => success: false
  ```
  Net effect: **any page with more than one numeric goal — or even one numeric goal the user isn't touching this round — fails the whole submission**, including the row the user *did* fill in correctly. This directly contradicts the plan's own contract (`plan.md:73`): *"`progress.<id>.amount` (present → numeric add-amount row) ... array un-bounded — an empty submission is a valid no-op, not an error."* The plan's "present" assumed a blank field produces no row; the implementation doesn't enforce that.

  This also undermines the Phase 2 manual verification already checked off in `## Progress` (2.4, 2.6, 2.7): those were verified via hand-crafted curl payloads containing only the specific fields under test, not a faithful replay of the real form (which always includes every numeric goal's blank input once ≥2 numeric goals exist, or ≥1 numeric goal is left untouched). A real multi-goal browser session would have hit this immediately.
- **Fix**: In `parseProgress`, skip a field whose value is a blank string before adding it to the row map:
  ```ts
  for (const [key, value] of form.entries()) {
    const match = PROGRESS_FIELD_PATTERN.exec(key);
    if (!match) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const [, id, field] = match;
    byId.set(id, { ...byId.get(id), id, [field]: value });
  }
  ```
  This restores the plan's intended semantics — a field only counts as "present" when the user actually entered something — without touching the zod schema, `recordProgress`, or the markup.
- **Decision**: FIXED — applied the one-line blank-value skip in `parseProgress` (src/pages/api/goals/progress.ts). Re-ran the exact repro scenario (blank amount on one goal + a filled amount on another + a checked boolean) directly against the schema: now parses to 2 rows and validates successfully. `npm run lint` and `npm run build` re-verified clean.

### F2 — Unplanned `supabase/config.toml` change (out-of-band, but authorized and verified)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/config.toml:156
- **Detail**: `additional_redirect_urls` was widened from `http://localhost:4321/**` to `http://localhost:*/**` (commit a298030). This file/change is not mentioned anywhere in `plan.md` — it's unrelated to FR-007/record-goal-progress. Mitigating context: this was an explicit, separately-requested fix mid-session (the user hit production-redirect magic-link emails while manually testing this plan, on an unrelated but real bug), it landed in its own clearly-labeled commit outside the phase commits, and Agent 2's security review found no new exposure (production `site_url` is untouched; the widened pattern only affects local dev). Not code the plan's phases should have produced, but not silent/undocumented scope creep either — the commit message explains it and it's traceable to this conversation.
- **Fix**: Add a line to `context/changes/record-goal-progress/change.md`'s Notes section documenting this out-of-band fix (commit a298030) so future readers of this change's history aren't confused about why an unrelated file changed on this branch.
- **Decision**: FIXED — added a Notes entry to change.md documenting commit a298030 and why it landed on this branch.
