import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { isSignedIn } from "./server/auth";

// A custom start instance replaces TanStack's default, so CSRF must be listed explicitly.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

// Reachable without a session: the login flow, plus endpoints with their own guard
// (ingest, mini poll and jobs: bearer token; all of these and health are also 404 on the public Caddy site).
const PUBLIC = new Set(["/login", "/api/login", "/api/logout", "/api/ingest", "/api/health", "/api/mini/poll"]);
const isPublic = (path: string) => PUBLIC.has(path) || path.startsWith("/api/jobs/");

// ponytail: KHARCHA_AUTH=off opens the whole app (owner's choice while data is low-stakes).
// Remove that line from /etc/kharcha-web/env and restart to require the login again.
const authOff = process.env.KHARCHA_AUTH === "off";

const auth = createMiddleware().server(async ({ request, pathname, handlerType, next }) => {
  if (authOff) return next();
  if (handlerType === "router" && isPublic(pathname)) return next();
  if (isSignedIn(request)) return next();
  if (handlerType === "serverFn") return new Response(SIGN_IN_AGAIN, { status: 401 });
  return new Response(null, {
    status: 302,
    headers: { Location: loginHref(pathname + new URL(request.url).search), "Cache-Control": "no-store" },
  });
});

// Server-function responses carry finance data; keep them out of browser and proxy caches.
const noStore = createMiddleware().server(async ({ next, handlerType }) => {
  const result = await next();
  if (handlerType === "serverFn") result.response.headers.set("Cache-Control", "no-store");
  return result;
});

export const SIGN_IN_AGAIN = "Sign in again.";

// Browser side: an expired session makes every server function 401. Retrying cannot fix
// that, so leave for the login page and come back to the same screen afterwards.
export const loginHref = (path: string) => `/login?next=${encodeURIComponent(path)}`;
const expired = createMiddleware({ type: "function" }).client(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof Error && error.message === SIGN_IN_AGAIN && typeof window !== "undefined" && location.pathname !== "/login") {
      window.location.assign(loginHref(location.pathname + location.search));
    }
    throw error;
  }
});

export const startInstance = createStart(() => ({ requestMiddleware: [csrf, auth, noStore], functionMiddleware: [expired] }));
