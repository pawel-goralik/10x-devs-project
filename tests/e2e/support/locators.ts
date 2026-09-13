import type { Locator, Page } from "@playwright/test";

function escapeForCssAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Playwright has no built-in "find the textbox with this value" locator (unlike
 * Testing Library's getByDisplayValue). Needed here because every goal card's
 * description field shares the identical accessible name ("Cel"), so getByRole/
 * getByLabel alone can't tell two goals' fields apart — and a plain `.nth(i)` would
 * drift under the shared E2E fixture account, where another test's goal can appear
 * or disappear between one action and the next. Falling back to the value itself
 * (the exact state under test, not styling/DOM structure) is the disciplined
 * equivalent of the getByTestId fallback our E2E rules allow when accessible
 * attributes are ambiguous.
 */
export function getByDisplayValue(page: Page, value: string): Locator {
  return page.locator(`input[value="${escapeForCssAttrValue(value)}"]`);
}
