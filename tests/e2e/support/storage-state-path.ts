// Kept in its own module (no `@playwright/test` import) so playwright.config.ts can
// reference it without loading auth.setup.ts — importing a file that calls `test()`
// from the config file itself fails Playwright's config loader.
export const E2E_STORAGE_STATE = "playwright/.auth/e2e-fixture.json";
