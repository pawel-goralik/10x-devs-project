import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { createGoals } from "@/lib/services/goals";

export const prerender = false;

const goalRowSchema = z.discriminatedUnion("measureType", [
  z.object({
    description: z.string().trim().min(1).max(255),
    measureType: z.literal("numeric"),
    targetValue: z.coerce.number().positive(),
  }),
  z.object({
    description: z.string().trim().min(1).max(255),
    measureType: z.literal("boolean"),
  }),
]);

// Bundle create: 1-20 rows, all-or-nothing. A single bad row rejects the whole submission.
const bundleSchema = z.array(goalRowSchema).min(1).max(20);

const BUNDLE_FIELD_PATTERN = /^goals\.(\d+)\.(description|measureType|targetValue)$/;

/** Reconstructs the ordered row array from `goals.<index>.<field>` form fields. */
function parseBundle(form: FormData): unknown[] {
  const rows: (Record<string, FormDataEntryValue> | undefined)[] = [];
  for (const [key, value] of form.entries()) {
    const match = BUNDLE_FIELD_PATTERN.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    const field = match[2];
    rows[index] = { ...rows[index], [field]: value };
  }
  return rows.filter((row): row is Record<string, FormDataEntryValue> => row !== undefined);
}

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const parsed = bundleSchema.safeParse(parseBundle(form));
  if (!parsed.success) {
    return context.redirect(
      `/goals?error=${encodeURIComponent("Check each goal — description is required and targets must be positive numbers")}`,
    );
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/goals?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const result = await createGoals(supabase, user.id, parsed.data);
  if (!result.success) {
    return context.redirect(`/goals?error=${encodeURIComponent(result.error)}`);
  }

  return context.redirect("/goals?created=1");
};
