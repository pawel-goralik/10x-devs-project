<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: North-Star E2E Coverage

- **Plan**: context/changes/testing-north-star-e2e-coverage/plan.md
- **Scope**: Phase 1 of 1 (full plan)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — `afterEach` doesn't guard against `cleanupFixtures` itself throwing

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/group-goal-visibility.spec.ts:38-53
- **Detail**: The hook calls `cleanupFixtures(...)` as a plain top-level `await`, then unconditionally closes both `BrowserContext`s and resets module state. `cleanupFixtures` (tests/support/fixtures.ts:81-106) can throw — its `for (const userId of userIds)` loop aborts on the *first* user's `deleteTestUser` failure and never attempts the second. If it throws, none of the following lines run: both browser contexts leak for the rest of the worker process, and any DB rows not yet deleted (test users, their goals/groups) are permanently orphaned in the real Supabase project — there's no separate sweep for these ephemeral per-test users (only `auth.setup.ts` wipes the shared fixture account). `context/foundation/test-plan.md:129` states the project's own convention: "cleanupFixtures already does this; always call it in a finally block." The integration tests honor this via `try {...} finally { cleanupFixtures(...) }`; this spec's `afterEach` gives the "runs even if the test throws" guarantee for the *test body*, but nothing protects the rest of `afterEach` from a throw inside `cleanupFixtures` itself.
- **Fix**: Wrap the context-close + state-reset in a `finally` around the `cleanupFixtures` call (or wrap `cleanupFixtures` itself in try/catch), so a partial cleanup failure never leaks browser contexts and doesn't block resetting module state for a subsequent worker-reused run.
  - Strength: Small, localized change to the one file this phase owns; directly closes a resource-leak/data-orphan path with no behavior change on the happy path.
  - Tradeoff: Doesn't fix the underlying issue that `cleanupFixtures`'s per-user loop aborts on first failure (that's shared helper code, see F2/F3) — this only stops it from also leaking contexts in this spec.
  - Confidence: HIGH — the control-flow gap is directly visible in both files.
  - Blind spot: How often `cleanupFixtures` actually throws in practice (transient network/DB errors) wasn't measured; this is a defense-in-depth fix, not a response to an observed failure.
- **Decision**: SKIPPED

### F2 — `signInContextAsNewUser` can orphan a DB user if a later internal step fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/support/auth.ts:19-29 (shared helper, not modified by this phase; surfaced by this spec's use of it at tests/e2e/group-goal-visibility.spec.ts:64-65)
- **Detail**: `createTestUser` (creates the real `auth.users` row) runs before `signInAsTestUser` and the `getSession()` check. If either later step throws, the function throws without ever returning the user object — the spec's `author`/`viewer` variable is never assigned, so `afterEach`'s `[author, viewer].filter(Boolean)` silently excludes the already-created user from `cleanupFixtures`. The user is orphaned in the DB with no path to deletion.
- **Fix**: Have `signInContextAsNewUser` clean up the user it just created if a later step fails (try/catch around the post-creation steps, delete-and-rethrow), or restructure it to surface the created id to the caller before the risky steps.
  - Strength: Fixes the gap once, for every current and future spec that uses this helper (this spec is currently its only consumer, but the fix isn't scoped to this test).
  - Tradeoff: Touches shared test infra outside this phase's planned file list — a deliberate call to make since it's a correctness gap in code this phase's test exercises, but worth a separate small change rather than folding into this phase's commit.
  - Confidence: MEDIUM — the failure path is real but was not observed in any actual run this session; reasoned from code inspection.
  - Blind spot: Haven't checked whether any other test (present or planned) already relies on the current throw-without-cleanup behavior.
- **Decision**: SKIPPED

### F3 — `createGroupWithMembers`'s two-step insert only accidentally avoids leaking a group id

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/support/fixtures.ts:15-33 (shared helper, not modified by this phase)
- **Detail**: If the `group_members` insert fails after the `groups` insert succeeds, the function throws without returning `group.id`, so this spec's `groupId` stays `undefined` and `cleanupFixtures`'s `groupIds` branch never runs for it. In this specific spec the orphan is coincidentally still swept, because `createGroupWithMembers`'s first `memberId` becomes `created_by`, and `author.id` is already captured — `deleteTestUser(author.id)` cascades to delete groups it created. This safety net is undocumented and depends on member-array ordering and the creator always being a tracked id.
- **Fix**: A short comment on `createGroupWithMembers` noting that group cleanup on a partial failure currently relies on the creator's own `deleteTestUser` cascade, so future callers don't assume `groupId` tracking alone is sufficient.
- **Decision**: FIXED — added the explanatory comment to `tests/support/fixtures.ts`'s `createGroupWithMembers`.

### F4 — Dev-toolbar hiding workaround not described in the plan

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: tests/e2e/group-goal-visibility.spec.ts:79-82
- **Detail**: The spec adds `authorPage.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" })` before interacting with the goal card, to work around Astro's dev-mode toolbar overlay intercepting pointer events near the bottom of the viewport — discovered during VERIFY, not called out in the plan's Contract or Critical Implementation Details. It's narrowly scoped, inline-commented, touches only dev-only chrome (absent in production), and doesn't weaken any assertion.
- **Fix**: Optional — add a one-line mention to the plan's Critical Implementation Details for future readers, since this is exactly the kind of "gotcha the implementer needs to know" the section exists for; not required since the code comment already explains it in place.
- **Decision**: ACCEPTED-AS-RULE — recorded in `context/foundation/lessons.md` as "Astro's dev-mode toolbar can intercept Playwright clicks near the viewport bottom"; plan.md left unchanged (lesson only, no code/plan fix applied).

## Success Criteria Verification

All automated checks re-run independently during this review and confirmed passing:
- `npx playwright test tests/e2e/group-goal-visibility.spec.ts` — 2 passed
- `npm run test:e2e` — 3 passed (setup + seed.spec.ts + group-goal-visibility.spec.ts)
- `npm run lint` — 0 errors (4 pre-existing warnings, unrelated to this change)
- `npm run build` — clean build

Manual verification items (Progress 1.5, 1.6) are marked `[x]` with real evidence, not rubber-stamped: two deliberate breaks were performed and shown to turn the spec red (inverted `listGroupMemberGoals`'s `.lte`/`.gt` cutoff; removed `readOnly={true}` on the group page), each reverted and reconfirmed green, with `git diff --stat` showing zero residual diff on the app files.
