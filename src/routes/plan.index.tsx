import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/plan/")({ beforeLoad: () => { throw redirect({ to: "/plan/budgets" }); } });
