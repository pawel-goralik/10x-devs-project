// group-goal-visibility.spec.ts — proves the north-star cross-group witnessing flow
// (test-plan.md Risk #1, positive/cross-cutting case): a group member's already-locked goal
// and its current progress are actually delivered to another real member on the shared group
// view, end-to-end through two real, independently signed-in browser sessions.
//
// Modeled on seed.spec.ts's conventions (role-based locators, wait-for-state, unique test
// data, afterEach cleanup) but opts out of the shared storageState fixture — this is
// inherently a multi-user scenario (see tests/e2e/CLAUDE.md's explicit call-out), so both
// members are fresh, isolated users via signInContextAsNewUser, each in their own
// BrowserContext.
//
// listGroupMemberGoals only surfaces goals whose created_at is already >=24h old, so the goal
// is seeded directly via the service-role client with a backdated created_at — the same
// technique tests/integration/goals-visibility.test.ts already uses — since there is no way to
// get a real, already-locked goal into the database in under 24 real hours. recordProgress has
// no lock-window check, so bumping that goal's progress through the real UI afterward is
// realistic.
import { test, expect } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { createServiceRoleClient } from "../support/service-role-client";
import { cleanupFixtures, createGoalAt, createGroupWithMembers } from "../support/fixtures";
import { signInContextAsNewUser, type AuthenticatedTestUser } from "./support/auth";
import { getGoalCard } from "./support/locators";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const LOCKED_CREATED_AT = new Date(Date.now() - EDIT_WINDOW_MS - 1000);
const goalDescription = `Group goal ${Date.now()}`;
const TARGET_VALUE = 5;
const PROGRESS_AMOUNT = 3;

let authorContext: BrowserContext | undefined;
let viewerContext: BrowserContext | undefined;
let author: AuthenticatedTestUser | undefined;
let viewer: AuthenticatedTestUser | undefined;
let groupId: string | undefined;
let goalId: string | undefined;

test.afterEach(async () => {
  const serviceClient = createServiceRoleClient();
  await cleanupFixtures(serviceClient, {
    goalIds: goalId ? [goalId] : [],
    groupIds: groupId ? [groupId] : [],
    userIds: [author, viewer].filter((u): u is AuthenticatedTestUser => Boolean(u)).map((u) => u.id),
  });
  await authorContext?.close();
  await viewerContext?.close();
  authorContext = undefined;
  viewerContext = undefined;
  author = undefined;
  viewer = undefined;
  groupId = undefined;
  goalId = undefined;
});

test("a group member sees another member's committed goal and its current progress on the shared group view", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("playwright.config.ts must set use.baseURL");
  const serviceClient = createServiceRoleClient();

  authorContext = await browser.newContext();
  viewerContext = await browser.newContext();
  author = await signInContextAsNewUser(authorContext, baseURL);
  viewer = await signInContextAsNewUser(viewerContext, baseURL);

  groupId = await createGroupWithMembers(serviceClient, [author.id, viewer.id]);
  goalId = await createGoalAt(serviceClient, {
    userId: author.id,
    description: goalDescription,
    measureType: "numeric",
    targetValue: TARGET_VALUE,
    createdAt: LOCKED_CREATED_AT,
  });

  // Author records progress on their own already-locked goal through the real /goals UI.
  const authorPage = await authorContext.newPage();
  await authorPage.goto("/goals");
  // TODO: Consider removing dev-mode toolbar in the future, so that workaround won't be needed
  // Astro's dev-mode toolbar overlay (dev-only chrome, absent in production) can intercept
  // pointer events for elements near the bottom of the viewport; hide it before interacting.
  await authorPage.addStyleTag({ content: "astro-dev-toolbar { display: none !important; }" });
  const authorGoalCard = getGoalCard(authorPage, goalDescription);
  // The dialog's content portals outside the goal card's DOM subtree, so these locators are
  // scoped to the page, not the card.
  const progressInput = authorPage.getByLabel("Wartość do dodania");
  // "Dodaj postęp" mounts a client-side React island; if the click lands before it hydrates,
  // it's a dead DOM click (no listener attached yet) and the dialog never opens. Retry the
  // click until the dialog is actually up, rather than waiting on a field that may never appear.
  await expect(async () => {
    await authorGoalCard.getByRole("button", { name: "Dodaj postęp" }).click();
    await expect(progressInput).toBeVisible({ timeout: 2000 });
  }).toPass();
  await progressInput.fill(String(PROGRESS_AMOUNT));
  await authorPage.getByRole("button", { name: "Potwierdź" }).click();
  await expect(authorPage.getByText("Postęp zapisany.")).toBeVisible();

  // A second, independently signed-in group member sees the goal and its updated progress on
  // the shared group view, with no way to record progress on it themselves.
  const viewerPage = await viewerContext.newPage();
  await viewerPage.goto(`/groups/${groupId}`);
  const viewerGoalCard = getGoalCard(viewerPage, goalDescription);
  await expect(viewerGoalCard).toBeVisible();
  // The current/target values render as adjacent sibling <span>s with no text-node space
  // between them (only a CSS flex gap), so the accessible/DOM text is "3/5", not "3 / 5".
  await expect(viewerGoalCard).toContainText(`${PROGRESS_AMOUNT}/${TARGET_VALUE}`);
  await expect(viewerGoalCard.getByRole("button", { name: "Dodaj postęp" })).toHaveCount(0);
});
