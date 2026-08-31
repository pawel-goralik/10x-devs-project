import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getGroupDetail, leaveGroup, notifyGroupOfDeparture } from "@/lib/services/groups";

export const prerender = false;

const leaveSchema = z.object({
  groupId: z.uuid(),
});

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const parsed = leaveSchema.safeParse({ groupId: form.get("groupId") });
  if (!parsed.success) {
    return context.redirect(`/groups?error=${encodeURIComponent("Invalid group")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/groups?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { groupId } = parsed.data;

  // Must snapshot before leaving — group_members' SELECT policy requires current
  // membership, so this same lookup returns nothing once leaveGroup succeeds below.
  const groupBeforeLeaving = await getGroupDetail(supabase, groupId);

  const left = await leaveGroup(supabase, user.id, groupId);
  if (!left) {
    return context.redirect(`/groups?error=${encodeURIComponent("You are not a member of that group")}`);
  }

  if (groupBeforeLeaving) {
    const callerEmail = user.email ?? "A member";
    const remainingEmails = groupBeforeLeaving.members
      .map((member) => member.email)
      .filter((email) => email !== callerEmail);
    await notifyGroupOfDeparture(groupBeforeLeaving.name, callerEmail, remainingEmails);
  }

  return context.redirect("/groups?left=1");
};
