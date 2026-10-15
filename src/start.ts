import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { isSignedIn } from "./server/auth";

// A custom start instance replaces TanStack's default, so CSRF must be listed explicitly.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

// Reachable without a session: the login flow, plus endpoints with their own guard
// (ingest: bearer token; both ingest and health are also 404 on the public Caddy site).
const PUBLIC = new Set(["/login", "/api/login", "/api/logout", "/api/ingest", "/api/health"]);

// ponytail: KHARCHA_AUTH=off opens the whole app (owner's choice while data is low-stakes).
// Remove that line from /etc/kharcha-web/env and restart to require the login again.
const authOff = process.env.KHARCHA_AUTH === "off";

const auth = createMiddleware().server(async ({ request, pathname, handlerType, next }) => {
  if (authOff) return next();
  if (handlerType === "router" && PUBLIC.has(pathname)) return next();
  if (isSignedIn(request)) return next();
  if (handlerType === "serverFn") return new Response("Sign in again.", { status: 401 });
  const target = encodeURIComponent(pathname + new URL(request.url).search);
  return new Response(null, {
    status: 302,
    headers: { Location: `/login?next=${target}`, "Cache-Control": "no-store" },
  });
});

// Server-function responses carry finance data; keep them out of browser and proxy caches.
const noStore = createMiddleware().server(async ({ next, handlerType }) => {
  const result = await next();
  if (handlerType === "serverFn") result.response.headers.set("Cache-Control", "no-store");
  return result;
});

export const startInstance = createStart(() => ({ requestMiddleware: [csrf, auth, noStore] }));
