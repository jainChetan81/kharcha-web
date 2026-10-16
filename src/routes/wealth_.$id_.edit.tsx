import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/ui";

// STUB: replaced by the owning area.
export const Route = createFileRoute("/wealth_/$id_/edit")({ component: () => <PageHeader title="Edit holding" /> });
