import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// A custom start instance replaces TanStack's default, so CSRF must be listed explicitly.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

// Server-function responses carry finance data; keep them out of browser and proxy caches.
const noStore = createMiddleware().server(async ({ next, handlerType }) => {
  const result = await next();
  if (handlerType === "serverFn") result.response.headers.set("Cache-Control", "no-store");
  return result;
});

export const startInstance = createStart(() => ({ requestMiddleware: [csrf, noStore] }));
