import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "../components/ui";

// STUB: replaced by the owning area.
export const Route = createFileRoute("/txn/$id")({ component: () => <PageHeader title="Transaction" /> });
