import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateGoalCommand, Goal, MeasureType, UpdateGoalCommand } from "@/types";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

interface GoalRow {
  id: string;
  user_id: string;
  description: string;
  measure_type: MeasureType;
  target_value: number | null;
  current_value: number | null;
  is_done: boolean | null;
  created_at: string;
  updated_at: string;
}

function fromRow(row: GoalRow): Goal {
  const base = {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.measure_type === "numeric" && row.target_value !== null && row.current_value !== null) {
    return { ...base, measureType: "numeric", targetValue: row.target_value, currentValue: row.current_value };
  }
  if (row.measure_type === "boolean" && row.is_done !== null) {
    return { ...base, measureType: "boolean", isDone: row.is_done };
  }
  throw new Error(`Malformed goal row ${row.id}: measure_type "${row.measure_type}" has inconsistent columns`);
}

function toInsertRow(userId: string, command: CreateGoalCommand) {
  if (command.measureType === "numeric") {
    return {
      user_id: userId,
      description: command.description,
      measure_type: "numeric" as const,
      target_value: command.targetValue,
      current_value: 0,
      is_done: null,
    };
  }
  return {
    user_id: userId,
    description: command.description,
    measure_type: "boolean" as const,
    target_value: null,
    current_value: null,
    is_done: false,
  };
}

/** Pure — used only to decide what to render (editable input vs. read-only text). */
export function isEditable(goal: Pick<Goal, "createdAt">): boolean {
  return Date.now() - new Date(goal.createdAt).getTime() < EDIT_WINDOW_MS;
}

export async function listGoals(supabase: SupabaseClient, userId: string): Promise<Goal[]> {
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list goals: ${error.message}`);
  }
  return data.map(fromRow);
}

export type CreateGoalsResult = { success: true; goals: Goal[] } | { success: false; error: string };

/** All-or-nothing: a single multi-row insert, so bundle members share one `created_at`. */
export async function createGoals(
  supabase: SupabaseClient,
  userId: string,
  commands: CreateGoalCommand[],
): Promise<CreateGoalsResult> {
  const rows = commands.map((command) => toInsertRow(userId, command));
  const { data, error } = await supabase.from("goals").insert(rows).select();

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true, goals: data.map(fromRow) };
}

export interface UpdateGoalsResult {
  updated: string[];
  /** Ids whose update affected zero rows — either the 24h window closed or the id isn't owned by this user. */
  skipped: string[];
}

/**
 * The 24h window is enforced here, in each update's own WHERE clause (`created_at >
 * cutoff`), not via a separate fetch-then-check step — closing the race between page
 * load and submit. A zero-rows-affected result IS the "locked" signal.
 */
export async function updateGoals(
  supabase: SupabaseClient,
  userId: string,
  edits: UpdateGoalCommand[],
): Promise<UpdateGoalsResult> {
  const cutoff = new Date(Date.now() - EDIT_WINDOW_MS).toISOString();
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const edit of edits) {
    const patch: { description: string; updated_at: string; target_value?: number } = {
      description: edit.description,
      updated_at: new Date().toISOString(),
    };
    if (edit.targetValue !== undefined) {
      patch.target_value = edit.targetValue;
    }

    const { data, error } = await supabase
      .from("goals")
      .update(patch)
      .eq("id", edit.id)
      .eq("user_id", userId)
      .gt("created_at", cutoff)
      .select("id");

    if (error || data.length === 0) {
      skipped.push(edit.id);
    } else {
      updated.push(edit.id);
    }
  }

  return { updated, skipped };
}

/** Same atomic-WHERE-clause window check as `updateGoals`. Returns whether a row was actually removed. */
export async function deleteGoal(supabase: SupabaseClient, userId: string, goalId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - EDIT_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("goals")
    .delete()
    .eq("id", goalId)
    .eq("user_id", userId)
    .gt("created_at", cutoff)
    .select("id");

  return !error && data.length > 0;
}
