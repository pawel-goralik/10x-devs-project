import { test as setup } from "@playwright/test";
import { createServiceRoleClient } from "../support/service-role-client";
import { createTestUser, deleteTestUser, signInAsTestUser } from "../support/test-users";
import { buildSupabaseAuthCookie } from "./support/session-cookie";
import { E2E_STORAGE_STATE } from "./support/storage-state-path";

const FIXTURE_EMAIL = "e2e-fixture@example.com";

/**
 * Runs once before the test project (see the "setup" project's `dependencies` in
 * playwright.config.ts) and authenticates as one shared fixture account, saved to
 * E2E_STORAGE_STATE — every spec then starts already signed in, no per-test login.
 *
 * The fixture user is deleted and recreated on every run rather than reused across
 * runs, so a stale session/password from a previous run never lingers.
 */
setup("authenticate", async ({ context, baseURL }) => {
  if (!baseURL) throw new Error("playwright.config.ts must set use.baseURL");
  const serviceClient = createServiceRoleClient();

  const { data: existing, error: listError } = await serviceClient.auth.admin.listUsers();
  if (listError) throw listError;
  const previous = existing.users.find((u) => u.email === FIXTURE_EMAIL);
  if (previous) {
    await deleteTestUser(serviceClient, previous.id);
  }

  const user = await createTestUser(serviceClient, FIXTURE_EMAIL);
  const authedClient = await signInAsTestUser(user.email, user.password);
  const {
    data: { session },
    error: sessionError,
  } = await authedClient.auth.getSession();
  if (sessionError || !session) {
    throw new Error(`Failed to obtain a session for the E2E fixture user: ${sessionError?.message}`);
  }

  const cookie = buildSupabaseAuthCookie(session);
  await context.addCookies([
    {
      ...cookie,
      domain: new URL(baseURL).hostname,
      path: "/",
    },
  ]);

  await context.storageState({ path: E2E_STORAGE_STATE });
});
