/**
 * Shared entity and command types for the goals feature (roadmap S-01: commit-a-goal).
 * See supabase/migrations/20260829164522_create_goals.sql for the underlying schema.
 */

export type MeasureType = "numeric" | "boolean";

export interface GoalNumericMeasure {
  measureType: "numeric";
  targetValue: number;
  currentValue: number;
}

export interface GoalBooleanMeasure {
  measureType: "boolean";
  isDone: boolean;
}

export type GoalMeasure = GoalNumericMeasure | GoalBooleanMeasure;

export type Goal = {
  id: string;
  userId: string;
  description: string;
  createdAt: string;
  updatedAt: string;
} & GoalMeasure;

/** One row of a create-bundle submission (see POST /api/goals). */
export type CreateGoalCommand =
  | { description: string; measureType: "numeric"; targetValue: number }
  | { description: string; measureType: "boolean" };

/**
 * One row of a save-all submission (see POST /api/goals/manage). Measure type is not
 * editable after creation, so it isn't part of this command — only description and,
 * for numeric goals, the target value.
 */
export interface UpdateGoalCommand {
  id: string;
  description: string;
  targetValue?: number;
}

/**
 * One row of a progress submission (see POST /api/goals/progress). The boolean variant
 * always means "mark done" — there's only one legal direction, so no `isDone` field.
 */
export type RecordProgressCommand =
  | { id: string; measureType: "numeric"; amount: number }
  | { id: string; measureType: "boolean" };
