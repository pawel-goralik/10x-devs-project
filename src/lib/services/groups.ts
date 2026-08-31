import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Group, GroupDetail, GroupMember, GroupPreview } from "@/types";
import { sendEmail } from "@/lib/services/email";

interface GroupRow {
  id: string;
  name: string;
  invite_token: string;
  created_by: string;
  created_at: string;
}

interface GroupMemberRow {
  user_id: string;
  joined_at: string;
}

interface ProfileRow {
  id: string;
  email: string;
}

interface GroupPreviewRow {
  group_id: string;
  group_name: string;
  creator_email: string;
  already_member: boolean;
}

function fromGroupRow(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    inviteToken: row.invite_token,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Filters explicitly by current membership via the group_members join, rather than
 * relying solely on RLS visibility — groups_select_own_created (added during Phase 1)
 * also lets a creator see a group they created even after leaving it, which would
 * otherwise make a left group linger in "my groups" forever. This keeps listMyGroups'
 * meaning ("groups I currently belong to") independent of that RLS widening.
 */
export async function listMyGroups(supabase: SupabaseClient, userId: string): Promise<Group[]> {
  const { data, error } = await supabase
    .from("groups")
    .select("*, group_members!inner(user_id)")
    .eq("group_members.user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list groups: ${error.message}`);
  }
  return (data as GroupRow[]).map(fromGroupRow);
}

/**
 * Two follow-up queries instead of a single embedded select: group_members and
 * profiles have no direct foreign key to each other (both reference auth.users
 * independently), so PostgREST can't auto-detect a relationship to embed across them.
 *
 * Accepted edge case: if the group's creator has left their own group, RLS still lets
 * them see the group's own row (groups_select_own_created) but no longer lets them see
 * any group_members rows for it (group_members_select_fellow_members requires current
 * membership) — so this would return the group with an empty members list rather than
 * null. No data is exposed either way; this mirrors the plan's already-accepted
 * not-found/not-a-member gap on a URL no normal flow leads to.
 */
export async function getGroupDetail(supabase: SupabaseClient, groupId: string): Promise<GroupDetail | null> {
  const { data: groupRow, error: groupError } = (await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle()) as { data: GroupRow | null; error: PostgrestError | null };

  if (groupError || !groupRow) {
    return null;
  }

  const { data: memberData, error: memberError } = await supabase
    .from("group_members")
    .select("user_id, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  if (memberError) {
    throw new Error(`Failed to list group members: ${memberError.message}`);
  }
  const memberRows = memberData as GroupMemberRow[];

  const userIds = memberRows.map((row) => row.user_id);
  const emailById = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);

    if (profileError) {
      throw new Error(`Failed to list member profiles: ${profileError.message}`);
    }
    for (const profile of profileData as ProfileRow[]) {
      emailById.set(profile.id, profile.email);
    }
  }

  const members: GroupMember[] = memberRows.map((row) => ({
    userId: row.user_id,
    email: emailById.get(row.user_id) ?? "unknown",
    joinedAt: row.joined_at,
  }));

  return { ...fromGroupRow(groupRow), members };
}

export type CreateGroupResult = { success: true; groupId: string } | { success: false; error: string };

export async function createGroup(supabase: SupabaseClient, name: string): Promise<CreateGroupResult> {
  const { data, error } = (await supabase.rpc("create_group", { p_name: name })) as {
    data: string | null;
    error: PostgrestError | null;
  };

  if (error || !data) {
    return { success: false, error: error?.message ?? "Failed to create group" };
  }
  return { success: true, groupId: data };
}

export async function previewInvite(supabase: SupabaseClient, token: string): Promise<GroupPreview | null> {
  const { data, error } = (await supabase.rpc("get_group_preview", { p_invite_token: token })) as {
    data: GroupPreviewRow[] | null;
    error: PostgrestError | null;
  };

  if (error || !data || data.length === 0) {
    return null;
  }

  const row = data[0];
  return {
    groupId: row.group_id,
    groupName: row.group_name,
    creatorEmail: row.creator_email,
    alreadyMember: row.already_member,
  };
}

/** Returns the joined group's id, or null for an invalid/unresolvable token. */
export async function joinGroup(supabase: SupabaseClient, token: string): Promise<string | null> {
  const { data, error } = (await supabase.rpc("join_group_by_token", { p_invite_token: token })) as {
    data: string | null;
    error: PostgrestError | null;
  };

  if (error || !data) {
    return null;
  }
  return data;
}

/**
 * Deletes the caller's own membership row. Returns whether a row was actually removed.
 *
 * Ordering constraint: the caller MUST fetch the group's name/member list (via
 * getGroupDetail) BEFORE calling this — group_members' SELECT policy requires current
 * membership, so once this delete removes the caller's own row, that same session can
 * no longer see the group's name or member list at all (RLS returns nothing). There is
 * no "fetch afterward" option.
 */
export async function leaveGroup(supabase: SupabaseClient, userId: string, groupId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .select("group_id");

  return !error && data.length > 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Takes an already-resolved recipient list (no supabase/groupId params, no query of its
 * own) and notifies each in parallel — sendEmail has no per-call timeout, so a
 * sequential loop would make this call's latency the sum of every recipient's send time
 * instead of just the slowest one. Never throws — sendEmail itself already swallows
 * failures. groupName/departedEmail are user-controlled (group names have no content
 * restriction beyond non-blank), so they're HTML-escaped before going into the email's
 * HTML heading/body — subject and the plain-text body don't need escaping.
 */
export async function notifyGroupOfDeparture(
  groupName: string,
  departedEmail: string,
  recipientEmails: string[],
): Promise<void> {
  const subject = `${departedEmail} left ${groupName}`;
  const heading = `${escapeHtml(departedEmail)} left ${escapeHtml(groupName)}`;
  const bodyHtml = `<p>${escapeHtml(departedEmail)} has left the group "${escapeHtml(groupName)}".</p>`;
  const text = `${departedEmail} has left the group "${groupName}".`;

  await Promise.all(recipientEmails.map((to) => sendEmail({ to, subject, heading, bodyHtml, text })));
}
