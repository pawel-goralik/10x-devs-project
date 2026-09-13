# E2E Testing Rules

Scoped to `tests/e2e/`. Read `seed.spec.ts` first — it's the exemplar every test here is modeled on.

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to
  `getByTestId` only when accessibility attributes are ambiguous. Never CSS
  selectors, XPath, or DOM structure.
- Each test must be independently runnable — its own setup, action, assertion,
  and cleanup; no shared state between tests. One test per file (the project
  convention — see `/10x-e2e`'s File placement section).
- Never use `page.waitForTimeout()`. Wait for a specific condition:
  `toBeVisible()`, `waitForURL()`, `waitForResponse()`.
- Assert the business outcome, not implementation details.
- Use a unique identifier (timestamp suffix) for test data, so parallel runs and
  re-runs don't collide. Clean up what the test created — in `afterEach`, not at
  the end of the test body, so a failed assertion mid-test still cleans up
  (otherwise the row is orphaned in the shared fixture account until the next
  full run's `auth.setup.ts` wipe). Since specs are one-test-per-file, the
  identifier can be a plain module-level `const` computed once and
  shared with `afterEach` — no mutable/sentinel state needed, since `afterEach`
  can just check whether its row still exists before acting. See the seed for
  the pattern.
- Auth is `storageState`, set up once — never log in (UI or otherwise) inside an
  individual test:
  - `auth.setup.ts` (the Playwright `setup` project, see `playwright.config.ts`'s
    `dependencies`) provisions one shared E2E fixture account, signs in via
    `tests/support/test-users.ts` (password-based, test-harness-only — the app
    itself is magic-link-only), and writes the session as the same
    `sb-<project-ref>-auth-token` cookie `@supabase/ssr` would set, to
    `playwright/.auth/e2e-fixture.json`.
  - The `chromium` project's `storageState` points at that file, so every spec
    starts already signed in.
  - Because the fixture account is **shared** across specs (and any that run in
    parallel), never assume it's empty or that "the only X" is yours — scope
    locators and cleanup to the exact row your test created. Goal cards all
    share the same accessible name for their description field ("Cel"), so
    `GoalCard` renders `data-testid={`goal-card-${goal.description}`}` on the
    card's root — the getByTestId fallback our first rule allows, used because
    a test knows its own (unique, timestamped) description before creating the
    goal and needs no other id to key it. See `support/locators.ts`'s
    `getGoalCard` and the seed's usage. A test that instead needs a
    guaranteed-empty, fully isolated account (e.g. a first-run/empty-state
    scenario) should use `signInContextAsNewUser` from `support/auth.ts`
    instead of the shared storageState.
- Real vs. mocked: auth, routing, and the database stay real — that's where
  integration risk hides. This app has no external APIs in the critical path
  yet; if one is added, mock it at the network layer (`page.route()`), not by
  faking auth or DB state.
- Name the test after the risk it protects (`created goal persists after page
  reload`), not `test('test 1', ...)`. The control question for every
  assertion: would this fail if the risk it protects actually materialized? If
  not, it's decorative.
