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

/**
 * Deletes every row this user owns across the tables that hold a (deliberately)
 * no-action FK to auth.users — goals.user_id, groups.created_by, group_members.user_id
 * — then the auth user itself. Those FKs never cascade on purpose: FR-014 requires
 * account deletion to explicitly detach a user's data rather than silently destroy it
 * (see the create_goals/create_groups migrations). A test harness has no such
 * requirement, so this clears them outright rather than reimplementing anonymization.
 *
 * Callers don't need to know which tables reference auth.users — this is the one
 * place that does. Update the list here when a new table gets its own FK to it.
 */
export async function deleteTestUser(serviceClient: SupabaseClient, userId: string): Promise<void> {
  const { error: goalsError } = await serviceClient.from("goals").delete().eq("user_id", userId);
  if (goalsError) {
    throw new Error(`Failed to clean up goals for test user ${userId}: ${goalsError.message}`);
  }

  const { error: membershipError } = await serviceClient.from("group_members").delete().eq("user_id", userId);
  if (membershipError) {
    throw new Error(`Failed to clean up group memberships for test user ${userId}: ${membershipError.message}`);
  }

  // Cascades that group's own group_members rows (on delete cascade), including any
  // other members still in it.
  const { error: groupsError } = await serviceClient.from("groups").delete().eq("created_by", userId);
  if (groupsError) {
    throw new Error(`Failed to clean up groups created by test user ${userId}: ${groupsError.message}`);
  }

  const { error } = await serviceClient.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`Failed to delete test user ${userId}: ${error.message}`);
  }
}
