import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Bypasses RLS entirely — for fixture setup/teardown and backdating `created_at` only.
 * Never import this into application code (see plan's Critical Implementation Details).
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to create a service-role test client " +
        "(see .env.example — get the key locally via `npx supabase status`).",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as SupabaseClient;
}
