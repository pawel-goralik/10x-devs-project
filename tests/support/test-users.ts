import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/**
 * Password-authenticated test users are a test-harness-only convenience — the app
 * itself is magic-link-only in production.
 */
export async function createTestUser(serviceClient: SupabaseClient, email?: string): Promise<TestUser> {
  const testEmail = email ?? `test-${randomUUID()}@example.com`;
  const password = randomUUID();

  const { data, error } = await serviceClient.auth.admin.createUser({
    email: testEmail,
    password,
    email_confirm: true,
  });

  if (error) {
    throw new Error(`Failed to create test user: ${error.message}`);
  }

  return { id: data.user.id, email: testEmail, password };
}

/** Returns a session authenticated as this user — what tests use to probe RLS per-user. */
export async function signInAsTestUser(email: string, password: string): Promise<SupabaseClient> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_KEY;

  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set to sign in as a test user.");
  }

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Failed to sign in as test user ${email}: ${error.message}`);
  }

  return client;
}

/** Callers must have already deleted this user's `goals`/`group_members` rows (FK ordering). */
export async function deleteTestUser(serviceClient: SupabaseClient, userId: string): Promise<void> {
  const { error } = await serviceClient.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`Failed to delete test user ${userId}: ${error.message}`);
  }
}
