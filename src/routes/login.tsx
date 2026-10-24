import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "../components/ui";

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
  const [signingIn, setSigningIn] = useState(false);
  return (
    <section className="mx-auto mt-16 max-w-sm rounded-card border border-rule bg-card p-6">
      <h1 className="text-xl font-semibold">Kharcha</h1>
      {/* Plain form post: works before hydration and without JS. */}
      <form method="post" action="/api/login" className="mt-4 space-y-4" onSubmit={() => setSigningIn(true)}>
        <input type="hidden" name="next" value={next ?? "/"} />
        <label className="block text-sm font-medium">
          Password
          <input name="password" type="password" autoComplete="current-password" required className="field mt-1" />
        </label>
        <Button type="submit" disabled={signingIn} className="w-full">{signingIn ? "Signing in…" : "Sign in"}</Button>
        <p role="alert" className="text-sm text-over">{error ? MESSAGES[error] : ""}</p>
      </form>
    </section>
  );
}
