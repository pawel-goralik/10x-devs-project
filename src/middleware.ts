import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/goals", "/groups"];

// /groups/join/[token] must render its invite preview for a signed-out visitor —
// only the actual Join action (POST /api/groups/join) requires auth. /groups (list)
// and /groups/[id] (detail) stay fully gated.
const PUBLIC_EXCEPTIONS = ["/groups/join"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const { pathname } = context.url;
  const isProtected =
    PROTECTED_ROUTES.some((route) => pathname.startsWith(route)) &&
    !PUBLIC_EXCEPTIONS.some((route) => pathname.startsWith(route));

  if (isProtected && !context.locals.user) {
    return context.redirect(`/auth/signin?next=${encodeURIComponent(context.url.pathname + context.url.search)}`);
  }

  return next();
});
