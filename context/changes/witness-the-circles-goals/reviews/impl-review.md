<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Witness the circle's goals — Implementation Plan

- **Plan**: context/changes/witness-the-circles-goals/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-09-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Phase 1 commit included an out-of-contract, disclosed fix

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; already disclosed and approved during implementation
- **Dimension**: Scope Discipline
- **Location**: `src/pages/groups/[id].astro:8-19` (commit `4d94584`)
- **Detail**: Phase 1's contract was scoped to the RLS migration only. The plan's own "Key Discoveries" section (`plan.md:23`) states *"this plan doesn't touch that [gap] — it only adds a new section further down the same template."* In practice, Phase 1's commit also replaced the pre-existing implicit null-crash in `groups/[id].astro` with an explicit `if (!group) throw new Error(...)` guard, to satisfy `astro check`'s null-narrowing after the migration was applied. This was surfaced live during implementation (an `AskUserQuestion` mismatch prompt), approved by the user ("Adapt and continue — fix it now in Phase 1"), and disclosed in the commit message — so it's not silent scope creep, but it does contradict the plan's written record.
- **Fix**: Add a one-line addendum to `plan.md`'s "Key Discoveries" or "Critical Implementation Details" noting that Phase 1 also fixed this pre-existing null-narrowing gap, so the plan's text matches what actually shipped.
- **Decision**: FIXED — addendum added to `plan.md`'s "Key Discoveries" section.

### F2 — `GoalCard`'s `readOnly`/`editable` props aren't mutually type-constrained

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/components/goals/GoalCard.tsx:17-23`
- **Detail**: `Props` allows `readOnly={true}` and `editable={true}` to be passed together, which the component doesn't handle meaningfully (`readOnly` only nulls `progressTrigger`; the `editable` branch would still render the description/target-value inputs and "Zapisz zmiany"/"Usuń" buttons for a goal the viewer doesn't own). Not live today — the only call site (`groups/[id].astro:88`) always pairs `readOnly={true}` with `editable={false}` — and not exploitable even if misused, since `src/pages/api/goals/progress.ts` and `manage.ts` both re-derive `userId` from the server session and filter by `.eq("user_id", userId)`, with RLS as a second independent gate. Purely a type-level gap that could bite a future caller.
- **Fix**: Tighten `Props` to a discriminated union that disallows `editable: true` with `readOnly: true` (e.g. `{ editable: false; readOnly?: boolean } | { editable: true; readOnly?: false }`).
- **Decision**: FIXED — `Props` in `GoalCard.tsx` is now `BaseProps & ({ editable: false; readOnly?: boolean } | { editable: true; readOnly?: false })`. Verified `npx astro check` (0 errors) and `npm run lint` (0 errors) both still pass at both call sites.

## Additional notes (not findings)

- **Success Criteria verification**: re-ran all automated checks independently during this review (`npx astro check`, `npm run lint`, `npm run build`, `npx supabase db reset`) — all pass, matching what was recorded in `plan.md`'s Progress section.
- **Manual verification method**: Phase 1's (1.4-1.6) and Phase 2's (2.3) manual checks were performed by the implementer via direct SQL against the local Postgres instance (simulating RLS with `SET ROLE authenticated` + `request.jwt.claims`, and running the exact lock-window query shape), rather than through the browser with real accounts — the user explicitly reviewed and approved each result before it was checked off. This is real verification evidence, just not captured as a repeatable automated test; noted here for transparency, not flagged as a finding since the user consciously chose and approved this substitution both times.
- **Security review**: the safety/quality agent traced the new RLS policy's `exists(...)` join through a concrete 3-user example (A/B sharing a group, C sharing none) and confirmed correct inclusion/exclusion with no self-join typo. It also confirmed the `readOnly` UI affordance is backed by real server-side ownership checks (not just cosmetic), so there is no bypass path to mutate another member's goal.
