// seed.spec.ts — the project's E2E exemplar (see `/10x-e2e`'s seed-test-pattern).
// Every generated E2E test is modeled on the patterns shown here: role-based
// locators, full setup/action/assertion/cleanup independence, waiting for state
// instead of time, and a name that binds the test to the risk it protects.
//
// Auth comes from the shared `storageState` (see auth.setup.ts) — every spec starts
// already signed in as the E2E fixture account, no per-test login. Because that
// account is shared across specs (including ones that may run in parallel), each
// test's own data must stay uniquely identifiable and its assertions/actions scoped
// to just the row it created — never to "the only goal" or "the whole list."
//
// This single-identity assumption doesn't hold for a multi-user test.
// For that cases, opt out of the project's default storageState.
import { test, expect } from "@playwright/test";
import { getGoalCard } from "./support/locators";

const goalDescription = `Test goal ${Date.now()}`;

test.afterEach(async ({ page }) => {
  await page.goto("/goals");
  const goalCard = getGoalCard(page, goalDescription);
  if ((await goalCard.count()) === 0) return;

  await goalCard.getByRole("button", { name: "Usuń" }).click();
  await expect(goalCard).toHaveCount(0);
});

test("created goal persists after page reload", async ({ page }) => {
  await page.goto("/goals");

  await page.getByLabel("Cel", { exact: true }).fill(goalDescription);
  await page.getByLabel("Wartość docelowa").fill("5");
  await page.getByRole("button", { name: "Zapisz cele" }).click();

  await expect(page.getByText("Cele zapisane!")).toBeVisible();

  const goalCard = getGoalCard(page, goalDescription);
  await expect(goalCard).toBeVisible();

  await page.reload();
  await expect(goalCard).toBeVisible();
});
