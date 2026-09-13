import type { Locator, Page } from "@playwright/test";

/**
 * Every goal card shares the identical accessible name for its description field
 * ("Cel"), so getByRole/getByLabel alone can't tell two goals apart — and there's no
 * id known test-side to key a testid on (it's server-generated at insert time). The
 * description is: GoalCard renders `data-testid={`goal-card-${goal.description}`}` on
 * the card's root element, and a test already knows its own (unique, timestamped)
 * description before creating the goal, so it can look the card up by the same value
 * it typed in. This is the getByTestId fallback our E2E rules allow when accessible
 * attributes are ambiguous — scoped to the whole card, not just the description field,
 * so a caller can find the row's own "Usuń" button under the same locator too.
 */
export function getGoalCard(page: Page, description: string): Locator {
  return page.getByTestId(`goal-card-${description}`);
}
