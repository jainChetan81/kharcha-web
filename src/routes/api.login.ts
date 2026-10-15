import { createFileRoute } from "@tanstack/react-router";
import { authConfig, checkPassword, makeSession, safeNext, sameOrigin, sessionCookie } from "../server/auth";

const WINDOW = 15 * 60 * 1000;
const PER_IP = 5;
const GLOBAL = 30;
const fails = new Map<string, number[]>();

function recent(key: string): number[] {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW);
  if (list.length) fails.set(key, list);
  else fails.delete(key);
  return list;
}
function note(key: string) {
  fails.set(key, [...recent(key), Date.now()]);
  if (fails.size > 1000) fails.delete(fails.keys().next().value ?? "");
}
// Caddy appends the real peer last; earlier entries are client-controlled.
const clientIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "local";

const back = (next: string, error: string) =>
  new Response(null, {
    status: 303,
    headers: { Location: `/login?error=${error}&next=${encodeURIComponent(next)}`, "Cache-Control": "no-store" },
  });

export const Route = createFileRoute("/api/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData().catch(() => undefined);
        const next = safeNext(form?.get("next"));
        const config = authConfig();
        if (!config) return back(next, "config");
        if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
        const ip = clientIp(request);
        if (recent(ip).length >= PER_IP || recent("*").length >= GLOBAL) return back(next, "locked");
        const password = form?.get("password");
        if (typeof password !== "string" || !(await checkPassword(config.hash, password))) {
          note(ip);
          note("*");
          return back(next, "wrong");
        }
        fails.delete(ip);
        return new Response(null, {
          status: 303,
          headers: { Location: next, "Set-Cookie": sessionCookie(makeSession(config.secret)), "Cache-Control": "no-store" },
        });
      },
    },
  },
});
