import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MESSAGES = {
  wrong: "Wrong password.",
  locked: "Too many attempts. Try again in 15 minutes.",
  config: "Login is not configured on the server.",
} as const;

export const Route = createFileRoute("/login")({
  validateSearch: z.object({
    next: z.string().optional(),
    error: z.enum(["wrong", "locked", "config"]).optional(),
  }),
  component: Login,
});

function Login() {
  const { next, error } = Route.useSearch();
  return (
    <section className="mx-auto mt-16 max-w-sm rounded-2xl bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Kharcha</h1>
      {/* Plain form post: works before hydration and without JS. */}
      <form method="post" action="/api/login" className="mt-4 space-y-4">
        <input type="hidden" name="next" value={next ?? "/"} />
        <label className="block text-sm font-medium">
          Password
          <input name="password" type="password" autoComplete="current-password" required className="field mt-1" />
        </label>
        <button type="submit" className="btn w-full">Sign in</button>
        <p role="alert" className="text-sm text-spend">{error ? MESSAGES[error] : ""}</p>
      </form>
    </section>
  );
}
