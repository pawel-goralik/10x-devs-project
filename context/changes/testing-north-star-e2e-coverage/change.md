---
change_id: testing-north-star-e2e-coverage
title: North-star e2e coverage for shared-group goal visibility
status: implementing
created: 2026-09-13
updated: 2026-09-13
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "North-star e2e coverage".
Risks covered: #1 (A group member or any authenticated user sees a goal/progress belonging to someone outside every group they share with that goal's author) — applied here as the positive/cross-cutting counterpart: prove the north-star flow (S-03 witness-the-circles-goals) actually delivers a shared-group member's goal and progress to another real member, end-to-end through the browser.
Test types planned: e2e (Playwright).
Risk response intent: prove that a group member signed in through the real UI can see another member's committed goal and its current progress on the shared group view — a full end-to-end walk of the product's core bet (shape-notes.md: "First user-visible value lands at step 4-5"), not just the server-side visibility boundary already covered by Phase 1's integration tests.
Context already in place: Playwright infra is bootstrapped (auth.setup.ts shared storageState fixture, tests/e2e/CLAUDE.md rules, seed.spec.ts exemplar) — this phase writes the first risk-anchored e2e test, not new infra.
After creating the folder, follow the downstream continuation rule (suggest /10x-research next).
