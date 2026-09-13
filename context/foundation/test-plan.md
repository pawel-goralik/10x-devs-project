# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-10

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "<the
   team is worried about X, and the failure would surface somewhere in
   <area>>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (30 commits/30d — sufficient signal), excluding `node_modules`, `dist`, `supabase/migrations`, docs.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Impact      | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A group member (or any authenticated user) sees a goal or its progress belonging to someone outside every group they share with that goal's author                                                                                                                                                                                                                                                                                                                                                                                     | High        | High       | interview Q1; PRD NFR "Closed-circle confinement"; archived slice `witness-the-circles-goals/plan.md` (authorization-boundary widening); recurring theme across 4 archived slices (group-membership authorization); hot-spot dir `src/pages/groups/` (12 commits/30d), `src/lib/services/` (9 commits/30d)                                                                                                                      |
| 2   | The 24h immutability window drifts out of sync across the several independent places that each reimplement "is this goal locked" (create/edit/delete, progress-recording exemption, group-visibility filter, future digest) — a locked goal stays editable, or an unlocked goal is wrongly excluded/included                                                                                                                                                                                                                           | High        | Medium     | PRD guardrail "Goal immutability is never circumvented…"; FR-006; archived slice `witness-the-circles-goals/plan.md` (documents this exact drift as a trap for the next slice); roadmap S-05 (quarterly digest, next up) would hit this trap directly                                                                                                                                                                           |
| 3   | A Supabase migration or config change verified in local dev does not reach production, so prod silently runs stale schema/config until it breaks                                                                                                                                                                                                                                                                                                                                                                                       | High        | High       | interview Q2 (an incident that already happened); archived slices `magic-link-auth/plan.md` and `ui-polish-and-consistency/plan.md` (Supabase config-push blast radius flagged twice); roadmap F-03 (`automated-migration-deploy`, proposed)                                                                                                                                                                                    |
| 4   | The `/api/goals/manage` and `/api/goals/progress` endpoints still validate submissions as an all-or-nothing array of rows keyed by goal id; not reachable through the shipped per-card UI today (confirmed: each `GoalCard` now submits its own single-row `<form>`, post-S-08), but latent — any future caller sending multiple rows in one request (a bulk-edit UI, a non-JS fallback, a malformed/replayed request) would silently drop sibling rows' data on one bad row, the same way the original `record-goal-progress` bug did | Medium-High | Low        | archived slice `record-goal-progress/plan.md` (the original bug this endpoint shape came from, caught only in impl-review); verified against current code during `/10x-test-plan` authoring (2026-09-10) that the S-08 per-card refactor removed the only caller that ever sent multi-row bundles; recurring theme — same endpoint-level bundle shape also used by group create; hot-spot dir `src/pages/api/` (25 commits/30d) |
| 5   | Leaving a group or deleting an account runs a side effect (leave-notification email; FR-014 anonymization) in the wrong order relative to an RLS-gated read, so it silently no-ops instead of erroring                                                                                                                                                                                                                                                                                                                                 | Medium      | Medium     | archived slice `form-and-manage-a-group/plan.md` (this exact ordering bug was caught in plan review); roadmap S-06 (`anonymize-on-account-deletion`, proposed, next up) shares this shape                                                                                                                                                                                                                                       |
| 6   | _(abuse lens)_ The magic-link request endpoint can be used to flood an arbitrary email address with authentication emails, and/or a group's non-expiring, non-revocable invite token is guessed or enumerated by a non-member                                                                                                                                                                                                                                                                                                          | Medium      | Low-Medium | PRD Access Control ("closed-circle… trusted composition… risk accepted"); archived slice `form-and-manage-a-group/plan.md` hard constraint (no invite expiry/revocation); mandatory abuse/security lens (resource abuse + authorization/access classes)                                                                                                                                                                         |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                                                     | Must challenge                                                                                                                                                                         | Context `/10x-research` must ground                                                                                                                                                   | Likely cheapest layer                                                                                                             | Anti-pattern to avoid                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1   | A user who shares no group with the goal's author gets zero rows back for that goal/progress, from the actual query or API response — not just "the page doesn't render it"                                                                                                                     | "Doesn't render" ≠ "server didn't return it"; the membership check must be evaluated live at request time, not cached from page load or a prior session                                | How goal/progress visibility is actually gated (RLS policy vs. service-layer filter vs. both); what happens to visibility the instant a user leaves a group                           | integration                                                                                                                       | Asserting only that rendered HTML omits the goal instead of asserting the query/API response excludes it; testing only "member sees own group" with no negative case                                        |
| #2   | For a goal created at time T, every code path that reasons about "is this goal locked" agrees on the same T+24h boundary, tested exactly at the boundary                                                                                                                                        | A client-hidden edit form ≠ a server-side rejection; a replayed/stale request could bypass a client-only lock; the boundary itself (inclusive/exclusive) is where off-by-one bugs live | Where the 24h check is currently computed/duplicated; what clock source is used (server vs. client-submitted time); timezone safety                                                   | integration                                                                                                                       | Deriving the expected boundary from the same formula the app uses (oracle problem) instead of from FR-006's independent wording; testing only well-inside/well-outside the window and skipping the boundary |
| #3   | An automated CI step applies pending migrations to production as part of every deploy, so a merged migration cannot silently stop short of prod                                                                                                                                                 | "It worked locally" is not evidence it reached prod; two environments are proven in sync only by an explicit step, not by re-running the same local check twice                        | The current CI/deploy pipeline shape (what `wrangler-action` deploys vs. what it doesn't); what `supabase db push --linked` needs (secrets, project ref)                              | **CI/deploy automation (roadmap F-03), not a test**                                                                               | Writing an application-level test that passes locally and gives false confidence about production state — the exact failure mode already experienced                                                        |
| #4   | Calling `/api/goals/manage` or `/api/goals/progress` directly with a multi-row bundle (one valid row + one invalid/blank row) proves the endpoint still rejects the whole array rather than saving the valid row — documenting the latent behavior even though the shipped UI never triggers it | The shipped UI being single-row-only ≠ the endpoint being single-row-only; a future caller can still hit the multi-row path                                                            | Whether `parseEdits`/`parseProgress`-shaped multi-row handling is intentional and stable, or should itself be simplified/removed now that no caller needs it                          | integration (low priority — confirm latent behavior, don't over-invest)                                                           | Treating "the current UI can't trigger this" as "this is safe" and skipping verification entirely; over-investing in a low-likelihood path at the expense of Risks #1–#3                                    |
| #5   | When a member leaves a group or deletes an account, the side effect that depends on membership/identity data (notification recipient list; anonymization across every group) is computed before that data is removed, and the side effect is asserted directly (not just an HTTP status)        | "No error was thrown" ≠ "it actually happened" — an RLS policy silently returning an empty set looks identical to success unless explicitly asserted                                   | Exact ordering of the leave/delete operation's steps (read-then-write vs. write-then-read); for account deletion, what "anonymize" must touch across every group the user belonged to | integration                                                                                                                       | Asserting only that the leave/delete call returned 200; testing account deletion against a single-group case when the real risk is "every group"                                                            |
| #6   | The magic-link request endpoint and invite-token lookup cannot be used to send unlimited emails or brute-force a token within its lifetime — some rate limit or lockout is enforced and observable                                                                                              | A single valid request (happy path) proves nothing about the abuse case; "no expiry" for invite tokens was a scope decision, not necessarily also "no rate limit"                      | Whether any rate-limiting exists today (app-level or Cloudflare-level) on magic-link requests and invite-token lookups; the token's actual entropy/format                             | integration (or: flag the gap to `/10x-plan` if no rate limit exists at all — a phase cannot test a control that was never built) | Testing only a single valid magic-link request and calling auth "tested"; assuming closed-circle trust makes brute-forcing out of scope without checking token entropy                                      |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                          | Goal (one line)                                                                                                                  | Risks covered      | Test types         | Status      | Change folder                                     |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------ | ----------- | ------------------------------------------------- |
| 1   | Critical-path authorization & immutability coverage | Bootstrap the test runner and defend the two highest-impact core guarantees: cross-group visibility and the 24h lock boundary    | #1, #2             | unit + integration | complete    | `context/changes/testing-critical-path-coverage/` |
| 2   | Side-effect ordering & latent bundle-endpoint check | Catch mis-ordered leave/delete side effects (primary); confirm the now-latent multi-row bundle-endpoint behavior at low priority | #5, #4             | integration        | not started | —                                                 |
| 3   | Abuse-surface hardening                             | Verify (or flag the absence of) rate-limiting on magic-link requests and invite-token lookups                                    | #6                 | integration        | not started | —                                                 |
| 4   | Quality-gates wiring                                | Wire Phases 1–3 into CI, add one north-star e2e check, and land the F-03 migration-deploy automation                             | #3 + cross-cutting | gates              | not started | —                                                 |

No AI-native phase: this app has no LLM-facing surface (`tech-stack.md`: `has_ai: false`) and interview Q5 explicitly excluded visual regression — no cost×signal case was found for an AI-native layer.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs;
no docs/search MCP was available this session to cross-check current
framework guidance (see grounding note below).

| Layer              | Tool                     | Version                | Notes                                                                                                                 |
| ------------------ | ------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| unit + integration | Vitest                   | none yet — see Phase 1 | No test runner exists today (0 test files, no config). Vitest is the natural pairing for an Astro/Vite-based project. |
| API mocking        | none yet — see Phase 1   | —                      | Only mock at the network edge (Brevo's HTTP API) when reached; never mock internal service-layer modules.             |
| e2e                | none yet — see Phase 4   | —                      | Scoped to the north-star flow only (cross-group witnessing) — not a general e2e suite.                                |
| accessibility      | not planned this rollout | —                      | No top risk maps to it; not in scope for this rollout.                                                                |
| AI-native          | none                     | n/a                    | No LLM-facing surface in the product; visual regression explicitly excluded (interview Q5). Not proposed.             |

**Stack grounding tools (current session):**

- Docs: none available in current session (no Context7 or framework-docs MCP) — recommendations rely on local manifests (`package.json`, `astro.config.mjs`) only; checked: 2026-09-10.
- Search: no dedicated search MCP (e.g. Exa.ai) available; the session's generic web-search tool was not needed for this pass since no framework-currency question required external verification; checked: 2026-09-10.
- Runtime/browser: no Playwright MCP or browser-automation tool available this session; checked: 2026-09-10.
- Provider/platform: no GitHub/Cloudflare/Supabase MCP available this session; checked: 2026-09-10.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                                            | Where         | Required?                                                 | Catches                                                             |
| ----------------------------------------------- | ------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| lint + typecheck                                | local + CI    | required (already wired — see `.github/workflows/ci.yml`) | syntactic / type drift                                              |
| unit + integration                              | local + CI    | required after §3 Phase 1                                 | authorization-boundary and immutability-window regressions (#1, #2) |
| integration (form-integrity & ordering)         | local + CI    | required after §3 Phase 2                                 | silent data loss and mis-ordered side effects (#4, #5)              |
| e2e on north-star flow (cross-group witnessing) | CI on PR      | required after §3 Phase 4                                 | broken critical user path end-to-end                                |
| automated Supabase migration deploy             | CI deploy job | required — tracked as roadmap `F-03`, not yet wired       | local-vs-prod schema/config drift (#3)                              |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- Config: `vitest.config.ts` (repo root), built via `getViteConfig` from `astro/config` merged with `defineConfig` from `vitest/config` — this is what makes `astro:env/server` and the `@/*` path alias resolve identically to the app inside test files.
- Location: `tests/unit/`. Run with `npm run test` (fast, zero external dependencies — no Supabase needed).
- For any assertion that depends on the system clock (e.g. a time-window boundary), pin "now" with `vi.useFakeTimers()` + `vi.setSystemTime(...)` in a `beforeEach`, and restore with `vi.useRealTimers()` in `afterEach` — see `tests/unit/goals-edit-window.test.ts` for the pattern (asserts `isEditable`/`editWindowRemainingMs` at four fixed points around the 24h boundary).

### 6.2 Adding an integration test for an authorization/visibility boundary

- Shared helpers live in `tests/support/`: `service-role-client.ts` (an RLS-bypassing client for fixture setup/teardown only — never import it into application code), `test-users.ts` (`createTestUser`/`signInAsTestUser`/`deleteTestUser` — password-authenticated throwaway users, purely a test-harness convenience even though the app itself is magic-link-only), and `fixtures.ts` (`createGroupWithMembers`, `createGoalAt` for backdating `created_at` at insert time, `cleanupFixtures`).
- Golden rule: assert against actual DB state (a row read back via the service-role client) or an actual authenticated-client response — never against rendered UI or an HTTP status code alone. A "0 rows affected" result is an intentionally ambiguous signal (wrong owner vs. window closed); confirm what actually happened by re-reading the row.
- Teardown must respect FK ordering (no cascade from `auth.users`): delete `goals` → `group_members` → `groups` → `auth.admin.deleteUser`. `cleanupFixtures` already does this; always call it in a `finally` block. `profiles` cleans itself up via `ON DELETE CASCADE` — no explicit step needed.
- Boundary-exact fixtures: back-date `created_at` at insert time via `createGoalAt`'s explicit `createdAt` param (overriding the column's `default now()`), computed relative to `Date.now()` at fixture-creation time — never a hardcoded date, and never by waiting or mocking the system clock (the client under test recomputes its own cutoff from the real clock at call time).
- Run with `npm run test:integration` — requires local Supabase running (`npx supabase start`; see `lessons.md` for the Colima `[analytics] enabled = false` workaround if it fails). The script preflight-checks reachability and fails fast with instructions instead of hanging; it never auto-starts Supabase. It also runs `supabase db reset` once per run before the suite, so each test file only needs to create/tear down its own fixtures.
- See `tests/integration/goals-visibility.test.ts` (Risk #1: own/shared-group/non-member/post-leave visibility, cross-user write rejection) and `tests/integration/goals-lock-boundary.test.ts` (Risk #2: exact-cutoff/1s-inside/1s-outside consistency across `updateGoals`/`deleteGoal`/`listGroupMemberGoals`, plus the `recordProgress`-has-no-cutoff regression) for worked examples.

### 6.3 Adding an integration test for a multi-field form endpoint

- TBD — see §3 Phase 2 (realistic multi-field bundle-form pattern, Risk #4).

### 6.4 Adding an integration test for a leave/delete side effect

- TBD — see §3 Phase 2 (side-effect-before-removal ordering pattern, Risk #5).

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4 (north-star cross-group witnessing flow).

### 6.6 Per-rollout-phase notes

(Fills in after each phase lands.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI / visual regression** — no automated visual-diff or snapshot testing budget; reviewed by eye. Re-evaluate if the app grows a public-facing marketing surface or a shared design system with many components. (Source: interview Q5.)
- **Configuration & external infrastructure** — not covered by test-rollout phases. The one concrete incident in this category (a Supabase migration verified locally that never reached production, interview Q2) is instead addressed as CI deploy automation (roadmap `F-03`, §5), not a test — a gate/automation step is the mechanism that actually catches this failure mode, not a test asserting against config. Re-evaluate if config/infra drift causes another incident after `F-03` lands. (Source: interview Q5, reconciled against interview Q2.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-10
- Stack versions last verified: 2026-09-10
- AI-native tool references last verified: 2026-09-10 (none in use)

**Flagged for next refresh:**

- The magic-link auth flow itself (request-link → email → `/api/auth/callback`)
  has zero test coverage at any layer. Every test-harness identity — integration
  (`tests/support/test-users.ts`) and E2E (`tests/e2e/auth.setup.ts`) alike —
  authenticates by admin-creating a password-based user and injecting a session
  directly, bypassing the real flow entirely. That's the right call for every
  test that isn't *about* auth (see those files' own comments), but it means no
  test anywhere would catch a break in email delivery or the callback's
  `exchangeCodeForSession` handling. Not one of the six risks in §2's Risk Map
  today. Flagged 2026-09-13 during E2E lever setup; consider as a candidate risk
  (and its own E2E test, driving the real email via Mailpit/Inbucket, with no
  auth bypass) on the next `/10x-test-plan --refresh`.

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
