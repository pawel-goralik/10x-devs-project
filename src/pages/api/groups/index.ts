import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createGroup } from "@/lib/services/groups";
import type { CreateGroupCommand } from "@/types";

export const prerender = false;

const createGroupSchema: z.ZodType<CreateGroupCommand> = z.object({
  name: z.string().trim().min(1).max(255),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const parsed = createGroupSchema.safeParse({ name: form.get("name") });
  if (!parsed.success) {
    return context.redirect(`/groups?error=${encodeURIComponent("Enter a group name")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/groups?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const result = await createGroup(supabase, parsed.data);
  if (!result.success) {
    return context.redirect(`/groups?error=${encodeURIComponent(result.error)}`);
  }

  return context.redirect(`/groups/${result.groupId}`);
};
