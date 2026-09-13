import type { Session } from "@supabase/supabase-js";

/**
 * Mirrors @supabase/ssr's own cookie format (createServerClient's default
 * cookieEncoding: "base64url" — see node_modules/@supabase/ssr/dist/module/cookies.js):
 * cookie name is `sb-<project-ref>-auth-token` where project-ref is the first label of
 * the Supabase URL's hostname; the value is the session JSON, base64url-encoded with a
 * "base64-" prefix. Setting it directly authenticates the browser the same way the app's
 * own /api/auth/callback would, without driving the magic-link UI.
 */
export function buildSupabaseAuthCookie(session: Session): { name: string; value: string } {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL must be set to build the Supabase auth cookie.");
  }
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  return { name: `sb-${projectRef}-auth-token`, value };
}
