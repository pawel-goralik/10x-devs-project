import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { sanitizeNextPath } from "@/lib/utils";

export const prerender = false;

const INVALID_LINK_MESSAGE = "This link is invalid or has expired. Request a new one.";

export const GET: APIRoute = async (context) => {
  const errorDescription = context.url.searchParams.get("error_description");
  if (errorDescription) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(errorDescription)}`);
  }

  const code = context.url.searchParams.get("code");
  if (!code) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(INVALID_LINK_MESSAGE)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(INVALID_LINK_MESSAGE)}`);
  }

  const next = sanitizeNextPath(context.url.searchParams.get("next"));
  return context.redirect(next ?? "/goals");
};
