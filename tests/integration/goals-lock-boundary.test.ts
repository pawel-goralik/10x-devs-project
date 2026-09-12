import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "../support/service-role-client";
import { createTestUser, signInAsTestUser } from "../support/test-users";
import { cleanupFixtures, createGoalAt, createGroupWithMembers } from "../support/fixtures";
import { deleteGoal, listGroupMemberGoals, recordProgress, updateGoals } from "@/lib/services/goals";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

describe("24h immutability lock boundary (Risk #2)", () => {
  let serviceClient: SupabaseClient;

  beforeEach(() => {
    serviceClient = createServiceRoleClient();
  });

  it("updateGoals/deleteGoal lock a goal exactly at the cutoff and 1s outside it, but allow one 1s inside it", async () => {
    const owner = await createTestUser(serviceClient);
    const atCutoff = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "At cutoff",
      measureType: "boolean",
      createdAt: new Date(Date.now() - EDIT_WINDOW_MS),
    });
    const insideWindow = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "Inside window",
      measureType: "boolean",
      createdAt: new Date(Date.now() - EDIT_WINDOW_MS + 1000),
    });
    const outsideWindow = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "Outside window",
      measureType: "boolean",
      createdAt: new Date(Date.now() - EDIT_WINDOW_MS - 1000),
    });

    try {
      const ownerSession = await signInAsTestUser(owner.email, owner.password);

      const updateResult = await updateGoals(ownerSession, owner.id, [
        { id: atCutoff, description: "edit at cutoff" },
        { id: insideWindow, description: "edit inside window" },
        { id: outsideWindow, description: "edit outside window" },
      ]);
      expect(updateResult.skipped).toContain(atCutoff);
      expect(updateResult.skipped).toContain(outsideWindow);
      expect(updateResult.updated).toContain(insideWindow);
      expect(updateResult.updated).not.toContain(atCutoff);
      expect(updateResult.updated).not.toContain(outsideWindow);

      const deletedAtCutoff = await deleteGoal(ownerSession, owner.id, atCutoff);
      const deletedOutsideWindow = await deleteGoal(ownerSession, owner.id, outsideWindow);
      const deletedInsideWindow = await deleteGoal(ownerSession, owner.id, insideWindow);
      expect(deletedAtCutoff).toBe(false);
      expect(deletedOutsideWindow).toBe(false);
      expect(deletedInsideWindow).toBe(true);
    } finally {
      await cleanupFixtures(serviceClient, {
        goalIds: [atCutoff, insideWindow, outsideWindow],
        userIds: [owner.id],
      });
    }
  });

  it("listGroupMemberGoals shows the at-cutoff and outside-window goals, but not the inside-window goal", async () => {
    const owner = await createTestUser(serviceClient);
    const viewer = await createTestUser(serviceClient);
    const groupId = await createGroupWithMembers(serviceClient, [owner.id, viewer.id]);
    const atCutoff = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "At cutoff",
      measureType: "boolean",
      createdAt: new Date(Date.now() - EDIT_WINDOW_MS),
    });
    const insideWindow = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "Inside window",
      measureType: "boolean",
      createdAt: new Date(Date.now() - EDIT_WINDOW_MS + 1000),
    });
    const outsideWindow = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "Outside window",
      measureType: "boolean",
      createdAt: new Date(Date.now() - EDIT_WINDOW_MS - 1000),
    });

    try {
      const viewerSession = await signInAsTestUser(viewer.email, viewer.password);
      const goalsByUser = await listGroupMemberGoals(viewerSession, [owner.id]);
      const visibleIds = (goalsByUser.get(owner.id) ?? []).map((goal) => goal.id);

      expect(visibleIds).toContain(atCutoff);
      expect(visibleIds).toContain(outsideWindow);
      expect(visibleIds).not.toContain(insideWindow);
    } finally {
      await cleanupFixtures(serviceClient, {
        goalIds: [atCutoff, insideWindow, outsideWindow],
        groupIds: [groupId],
        userIds: [owner.id, viewer.id],
      });
    }
  });

  it("treats a goal created exactly at the cutoff instant as simultaneously locked and group-visible, with no gap", async () => {
    const owner = await createTestUser(serviceClient);
    const viewer = await createTestUser(serviceClient);
    const groupId = await createGroupWithMembers(serviceClient, [owner.id, viewer.id]);
    const goalId = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "Exactly at cutoff",
      measureType: "boolean",
      createdAt: new Date(Date.now() - EDIT_WINDOW_MS),
    });

    try {
      const ownerSession = await signInAsTestUser(owner.email, owner.password);
      const viewerSession = await signInAsTestUser(viewer.email, viewer.password);

      const updateResult = await updateGoals(ownerSession, owner.id, [{ id: goalId, description: "attempted edit" }]);
      expect(updateResult.skipped).toContain(goalId);
      expect(updateResult.updated).not.toContain(goalId);

      const goalsByUser = await listGroupMemberGoals(viewerSession, [owner.id]);
      expect((goalsByUser.get(owner.id) ?? []).map((goal) => goal.id)).toContain(goalId);
    } finally {
      await cleanupFixtures(serviceClient, { goalIds: [goalId], groupIds: [groupId], userIds: [owner.id, viewer.id] });
    }
  });

  it("recordProgress regression: accepts a progress update on a goal long past its lock window", async () => {
    const owner = await createTestUser(serviceClient);
    const goalId = await createGoalAt(serviceClient, {
      userId: owner.id,
      description: "Long locked, numeric",
      measureType: "numeric",
      targetValue: 100,
      createdAt: new Date(Date.now() - EDIT_WINDOW_MS * 10),
    });

    try {
      const ownerSession = await signInAsTestUser(owner.email, owner.password);
      const result = await recordProgress(ownerSession, owner.id, [{ id: goalId, measureType: "numeric", amount: 7 }]);
      expect(result.updated).toContain(goalId);
      expect(result.skipped).not.toContain(goalId);

      const { data: row } = await serviceClient
        .from("goals")
        .select("current_value")
        .eq("id", goalId)
        .single<{ current_value: number | null }>();
      expect(row?.current_value).toBe(7);
    } finally {
      await cleanupFixtures(serviceClient, { goalIds: [goalId], userIds: [owner.id] });
    }
  });
});
