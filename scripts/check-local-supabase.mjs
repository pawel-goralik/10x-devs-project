const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

/**
 * Hits GoTrue's health endpoint specifically, rather than the bare host — an
 * unrelated listener on the same port (e.g. a stray SSH tunnel) can still answer
 * a plain HTTP request, but won't produce GoTrue's `{ name: "GoTrue", ... }` body.
 * @param {string} targetUrl
 * @returns {Promise<boolean>}
 */
async function checkReachable(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 2000);
  try {
    const response = await fetch(`${targetUrl}/auth/v1/health`, { signal: controller.signal });
    if (!response.ok) {
      return false;
    }
    /** @type {unknown} */
    const body = await response.json();
    return typeof body === "object" && body !== null && "name" in body && body.name === "GoTrue";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const reachable = await checkReachable(url);

if (!reachable) {
  console.error(
    `Local Supabase not reachable at ${url} — run \`npx supabase start\` first ` +
      `(see context/foundation/lessons.md for the Colima workaround if it fails).`,
  );
  process.exit(1);
}
