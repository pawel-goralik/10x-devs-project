import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { sanitizeNextPath } from "@/lib/utils";

export const prerender = false;

const requestLinkSchema = z.object({
  email: z.email(),
});

const RATE_LIMIT_MESSAGE = "Link został niedawno wysłany — sprawdź skrzynkę odbiorczą lub spróbuj ponownie za chwilę.";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const parsed = requestLinkSchema.safeParse({ email: form.get("email") });

  if (!parsed.success) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Podaj prawidłowy adres e-mail")}`);
  }

  const { email } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  const nextRaw = form.get("next");
  const next = sanitizeNextPath(typeof nextRaw === "string" ? nextRaw : null);

  const emailRedirectUrl = new URL("/api/auth/callback", context.url.origin);
  if (next) {
    emailRedirectUrl.searchParams.set("next", next);
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: emailRedirectUrl.toString() },
  });

  if (error) {
    const message = error.code === "over_email_send_rate_limit" ? RATE_LIMIT_MESSAGE : error.message;
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  return context.redirect(`/auth/check-email?email=${encodeURIComponent(email)}`);
};
