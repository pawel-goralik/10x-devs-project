import type { BrowserContext } from "@playwright/test";
import { createServiceRoleClient } from "../../support/service-role-client";
import { createTestUser, deleteTestUser, signInAsTestUser, type TestUser } from "../../support/test-users";
import { buildSupabaseAuthCookie } from "./session-cookie";

export interface AuthenticatedTestUser extends TestUser {
  /** Deletes the test user, and everything it owns, via the service role. */
  cleanup: () => Promise<void>;
}

/**
 * Creates a fresh Supabase user and authenticates `context` as it, with no UI login.
 *
 * Most specs should use the shared `storageState` from `auth.setup.ts` instead (faster,
 * no per-test user provisioning) — reach for this only when a test specifically needs a
 * guaranteed-empty, isolated account (e.g. a first-run/empty-state scenario the shared
 * fixture account can't represent once other tests have added goals to it).
 */
export async function signInContextAsNewUser(context: BrowserContext, baseURL: string): Promise<AuthenticatedTestUser> {
  const serviceClient = createServiceRoleClient();
  const user = await createTestUser(serviceClient);
  const authedClient = await signInAsTestUser(user.email, user.password);
  const {
    data: { session },
    error,
  } = await authedClient.auth.getSession();
  if (error || !session) {
    throw new Error(`Failed to obtain a session for test user ${user.email}: ${error?.message}`);
  }

  const cookie = buildSupabaseAuthCookie(session);
  await context.addCookies([
    {
      ...cookie,
      domain: new URL(baseURL).hostname,
      path: "/",
    },
  ]);

  return {
    ...user,
    cleanup: () => deleteTestUser(serviceClient, user.id),
  };
}
