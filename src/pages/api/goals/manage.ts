import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { deleteGoal, updateGoals } from "@/lib/services/goals";

export const prerender = false;

const DELETE_ACTION_PREFIX = "delete:";

const editRowSchema = z.object({
  id: z.uuid(),
  description: z.string().trim().min(1).max(255),
  targetValue: z.coerce.number().positive().optional(),
});

const editsSchema = z.array(editRowSchema);

const EDIT_FIELD_PATTERN = /^edits\.([^.]+)\.(description|targetValue)$/;

/** Reconstructs one row per goal id from `edits.<id>.<field>` form fields. */
function parseEdits(form: FormData): unknown[] {
  const byId = new Map<string, Record<string, FormDataEntryValue | string>>();
  for (const [key, value] of form.entries()) {
    const match = EDIT_FIELD_PATTERN.exec(key);
    if (!match) continue;
    const [, id, field] = match;
    byId.set(id, { ...byId.get(id), id, [field]: value });
  }
  return Array.from(byId.values());
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/goals?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  const form = await context.request.formData();
  const action = form.get("action");

  if (typeof action === "string" && action.startsWith(DELETE_ACTION_PREFIX)) {
    const goalId = action.slice(DELETE_ACTION_PREFIX.length);
    const deleted = await deleteGoal(supabase, user.id, goalId);
    if (!deleted) {
      return context.redirect(
        `/goals?error=${encodeURIComponent("Tego celu nie można już usunąć — jego 24-godzinne okno edycji minęło")}`,
      );
    }
    return context.redirect("/goals?updated=1");
  }

  const parsed = editsSchema.safeParse(parseEdits(form));
  if (!parsed.success) {
    return context.redirect(
      `/goals?error=${encodeURIComponent("Sprawdź swoje zmiany — opis jest wymagany, a wartości docelowe muszą być liczbami dodatnimi")}`,
    );
  }

  const { skipped } = await updateGoals(supabase, user.id, parsed.data);
  if (skipped.length > 0) {
    return context.redirect(
      `/goals?error=${encodeURIComponent(`Nie zapisano ${skipped.length} cel(ów) — ich 24-godzinne okno edycji minęło`)}`,
    );
  }

  return context.redirect("/goals?updated=1");
};
