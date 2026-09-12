import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteTestUser } from "./test-users";

export async function createGroupWithMembers(
  serviceClient: SupabaseClient,
  memberIds: string[],
  name = `Test Group ${randomUUID()}`,
): Promise<string> {
  const [creatorId] = memberIds;
  if (!creatorId) {
    throw new Error("createGroupWithMembers requires at least one member id");
  }

  const { data: group, error: groupError } = await serviceClient
    .from("groups")
    .insert({ name, created_by: creatorId })
    .select("id")
    .single<{ id: string }>();

  if (groupError) {
    throw new Error(`Failed to create test group: ${groupError.message}`);
  }

  const { error: membersError } = await serviceClient
    .from("group_members")
    .insert(memberIds.map((userId) => ({ group_id: group.id, user_id: userId })));

  if (membersError) {
    throw new Error(`Failed to add test group members: ${membersError.message}`);
  }

  return group.id;
}

type CreateGoalAtParams = {
  userId: string;
  description: string;
  createdAt: Date;
} & ({ measureType: "numeric"; targetValue: number } | { measureType: "boolean" });

/** Backdates `created_at` at insert time — overrides the column's `default now()`. */
export async function createGoalAt(serviceClient: SupabaseClient, params: CreateGoalAtParams): Promise<string> {
  const row =
    params.measureType === "numeric"
      ? {
          user_id: params.userId,
          description: params.description,
          measure_type: "numeric" as const,
          target_value: params.targetValue,
          current_value: 0,
          is_done: null,
          created_at: params.createdAt.toISOString(),
        }
      : {
          user_id: params.userId,
          description: params.description,
          measure_type: "boolean" as const,
          target_value: null,
          current_value: null,
          is_done: false,
          created_at: params.createdAt.toISOString(),
        };

  const { data, error } = await serviceClient.from("goals").insert([row]).select("id").single<{ id: string }>();

  if (error) {
    throw new Error(`Failed to create test goal: ${error.message}`);
  }

  return data.id;
}

interface CleanupFixturesParams {
  goalIds?: string[];
  groupIds?: string[];
  userIds?: string[];
}

/** Deletes in FK-safe order: goals -> group_members -> groups -> each user. */
export async function cleanupFixtures(serviceClient: SupabaseClient, params: CleanupFixturesParams): Promise<void> {
  const { goalIds = [], groupIds = [], userIds = [] } = params;

  if (goalIds.length > 0) {
    const { error } = await serviceClient.from("goals").delete().in("id", goalIds);
    if (error) {
      throw new Error(`Failed to clean up test goals: ${error.message}`);
    }
  }

  if (groupIds.length > 0) {
    const { error: membersError } = await serviceClient.from("group_members").delete().in("group_id", groupIds);
    if (membersError) {
      throw new Error(`Failed to clean up test group members: ${membersError.message}`);
    }

    const { error: groupsError } = await serviceClient.from("groups").delete().in("id", groupIds);
    if (groupsError) {
      throw new Error(`Failed to clean up test groups: ${groupsError.message}`);
    }
  }

  for (const userId of userIds) {
    await deleteTestUser(serviceClient, userId);
  }
}
