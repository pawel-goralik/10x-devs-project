import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "../support/service-role-client";
import { createTestUser, signInAsTestUser } from "../support/test-users";
import { cleanupFixtures, createGoalAt, createGroupWithMembers } from "../support/fixtures";
import { deleteGoal, listGoals, listGroupMemberGoals, recordProgress, updateGoals } from "@/lib/services/goals";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const LOCKED_CREATED_AT = new Date(Date.now() - EDIT_WINDOW_MS - 1000);

describe("cross-group goal/progress visibility (Risk #1)", () => {
  let serviceClient: SupabaseClient;

  beforeEach(() => {
    serviceClient = createServiceRoleClient();
  });

  it("returns the author's own goal via listGoals", async () => {
    const author = await createTestUser(serviceClient);
    const goalId = await createGoalAt(serviceClient, {
      userId: author.id,
      description: "Own goal",
      measureType: "boolean",
      createdAt: new Date(),
    });

    try {
      const authorSession = await signInAsTestUser(author.email, author.password);
      const goals = await listGoals(authorSession, author.id);
      expect(goals.map((goal) => goal.id)).toContain(goalId);
    } finally {
      await cleanupFixtures(serviceClient, { goalIds: [goalId], userIds: [author.id] });
    }
  });

  it("returns a locked, shared-group member's goal via listGroupMemberGoals", async () => {
    const author = await createTestUser(serviceClient);
    const viewer = await createTestUser(serviceClient);
    const groupId = await createGroupWithMembers(serviceClient, [author.id, viewer.id]);
    const goalId = await createGoalAt(serviceClient, {
      userId: author.id,
      description: "Locked, shared-group goal",
      measureType: "boolean",
      createdAt: LOCKED_CREATED_AT,
    });

    try {
      const viewerSession = await signInAsTestUser(viewer.email, viewer.password);
      const goalsByUser = await listGroupMemberGoals(viewerSession, [author.id]);
      expect((goalsByUser.get(author.id) ?? []).map((goal) => goal.id)).toContain(goalId);
    } finally {
      await cleanupFixtures(serviceClient, {
        goalIds: [goalId],
        groupIds: [groupId],
        userIds: [author.id, viewer.id],
      });
    }
  });

  it("does not return a goal to a user sharing no group with its author", async () => {
    const author = await createTestUser(serviceClient);
    const outsider = await createTestUser(serviceClient);
    const goalId = await createGoalAt(serviceClient, {
      userId: author.id,
      description: "Locked goal, no shared group with outsider",
      measureType: "boolean",
      createdAt: LOCKED_CREATED_AT,
    });

    try {
      const outsiderSession = await signInAsTestUser(outsider.email, outsider.password);
      const goalsByUser = await listGroupMemberGoals(outsiderSession, [author.id]);
      expect(goalsByUser.get(author.id) ?? []).toHaveLength(0);
    } finally {
      await cleanupFixtures(serviceClient, { goalIds: [goalId], userIds: [author.id, outsider.id] });
    }
  });

  it("revokes visibility immediately once the shared group membership is removed", async () => {
    const author = await createTestUser(serviceClient);
    const viewer = await createTestUser(serviceClient);
    const groupId = await createGroupWithMembers(serviceClient, [author.id, viewer.id]);
    const goalId = await createGoalAt(serviceClient, {
      userId: author.id,
      description: "Locked goal, membership about to be revoked",
      measureType: "boolean",
      createdAt: LOCKED_CREATED_AT,
    });

    try {
      const viewerSession = await signInAsTestUser(viewer.email, viewer.password);

      const beforeLeaving = await listGroupMemberGoals(viewerSession, [author.id]);
      expect(beforeLeaving.get(author.id) ?? []).toHaveLength(1);

      const { error: leaveError } = await serviceClient
        .from("group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", viewer.id);
      expect(leaveError).toBeNull();

      const afterLeaving = await listGroupMemberGoals(viewerSession, [author.id]);
      expect(afterLeaving.get(author.id) ?? []).toHaveLength(0);
    } finally {
      await cleanupFixtures(serviceClient, {
        goalIds: [goalId],
        groupIds: [groupId],
        userIds: [author.id, viewer.id],
      });
    }
  });

  it("does not let another user's session record progress on a goal it does not own", async () => {
    const owner = await createTestUser(serviceClient);
    const attacker = await createTestUser(serviceClient);
    const goalId = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "Numeric goal owned by someone else",
      measureType: "numeric",
      targetValue: 100,
      createdAt: new Date(),
    });

    try {
      const attackerSession = await signInAsTestUser(attacker.email, attacker.password);
      const result = await recordProgress(attackerSession, attacker.id, [
        { id: goalId, measureType: "numeric", amount: 10 },
      ]);
      expect(result.skipped).toContain(goalId);
      expect(result.updated).not.toContain(goalId);

      const { data: row } = await serviceClient
        .from("goals")
        .select("current_value")
        .eq("id", goalId)
        .single<{ current_value: number | null }>();
      expect(row?.current_value).toBe(0);
    } finally {
      await cleanupFixtures(serviceClient, { goalIds: [goalId], userIds: [owner.id, attacker.id] });
    }
  });

  it("does not let another user's session update or delete a goal well inside its own 24h window", async () => {
    const owner = await createTestUser(serviceClient);
    const attacker = await createTestUser(serviceClient);
    const originalDescription = "Owner's fresh goal";
    const goalId = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: originalDescription,
      measureType: "boolean",
      createdAt: new Date(),
    });

    try {
      const attackerSession = await signInAsTestUser(attacker.email, attacker.password);

      const updateResult = await updateGoals(attackerSession, attacker.id, [{ id: goalId, description: "hijacked" }]);
      expect(updateResult.skipped).toContain(goalId);
      expect(updateResult.updated).not.toContain(goalId);

      const deleted = await deleteGoal(attackerSession, attacker.id, goalId);
      expect(deleted).toBe(false);

      const { data: row } = await serviceClient
        .from("goals")
        .select("id, description")
        .eq("id", goalId)
        .maybeSingle<{ id: string; description: string }>();
      expect(row).not.toBeNull();
      expect(row?.description).toBe(originalDescription);
    } finally {
      await cleanupFixtures(serviceClient, { goalIds: [goalId], userIds: [owner.id, attacker.id] });
    }
  });
});
