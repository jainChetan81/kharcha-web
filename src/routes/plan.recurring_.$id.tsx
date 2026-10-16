import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/ui";

// STUB: replaced by the owning area.
export const Route = createFileRoute("/plan/recurring_/$id")({ component: () => <PageHeader title="Recurring" /> });
