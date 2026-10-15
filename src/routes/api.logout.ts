import { createFileRoute } from "@tanstack/react-router";
import { sameOrigin, sessionCookie } from "../server/auth";

export const Route = createFileRoute("/api/logout")({
  server: {
    handlers: {
      POST: ({ request }) =>
        sameOrigin(request)
          ? new Response(null, {
              status: 303,
              headers: { Location: "/login", "Set-Cookie": sessionCookie("", 0), "Cache-Control": "no-store" },
            })
          : new Response("Forbidden", { status: 403 }),
    },
  },
});
