import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { recordProgress } from "@/lib/services/goals";
import type { RecordProgressCommand } from "@/types";

export const prerender = false;

const progressRowSchema = z.union([
  z.object({ id: z.uuid(), amount: z.coerce.number().positive() }),
  z.object({ id: z.uuid(), done: z.literal("on") }),
]);

const progressSchema = z.array(progressRowSchema);

const PROGRESS_FIELD_PATTERN = /^progress\.([^.]+)\.(amount|done)$/;

/** Reconstructs one row per goal id from `progress.<id>.<field>` form fields. */
function parseProgress(form: FormData): unknown[] {
  const byId = new Map<string, Record<string, FormDataEntryValue | string>>();
  for (const [key, value] of form.entries()) {
    const match = PROGRESS_FIELD_PATTERN.exec(key);
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
    return context.redirect(`/goals?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const form = await context.request.formData();
  const parsed = progressSchema.safeParse(parseProgress(form));
  if (!parsed.success) {
    return context.redirect(
      `/goals?error=${encodeURIComponent("Check your progress entries — amounts must be positive numbers")}`,
    );
  }

  if (parsed.data.length === 0) {
    return context.redirect("/goals");
  }

  const commands: RecordProgressCommand[] = parsed.data.map((row) =>
    "amount" in row
      ? { id: row.id, measureType: "numeric", amount: row.amount }
      : { id: row.id, measureType: "boolean" },
  );

  const { skipped } = await recordProgress(supabase, user.id, commands);
  if (skipped.length > 0) {
    return context.redirect(`/goals?error=${encodeURIComponent(`${skipped.length} goal(s) could not be updated`)}`);
  }

  return context.redirect("/goals?progress=1");
};
