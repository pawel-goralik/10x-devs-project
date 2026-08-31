import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { joinGroup } from "@/lib/services/groups";

export const prerender = false;

const joinSchema = z.object({
  token: z.uuid(),
});

const INVALID_INVITE_MESSAGE = "This invite link is invalid.";

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    // The confirm page never renders a Join form for a signed-out visitor (it renders
    // a sign-in link instead) — reaching this unauthenticated only happens via a
    // direct/crafted POST, so a plain sign-in redirect is sufficient.
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const parsed = joinSchema.safeParse({ token: form.get("token") });
  if (!parsed.success) {
    return context.redirect(`/groups?error=${encodeURIComponent(INVALID_INVITE_MESSAGE)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/groups?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const groupId = await joinGroup(supabase, parsed.data.token);
  if (!groupId) {
    return context.redirect(`/groups?error=${encodeURIComponent(INVALID_INVITE_MESSAGE)}`);
  }

  return context.redirect(`/groups/${groupId}`);
};
