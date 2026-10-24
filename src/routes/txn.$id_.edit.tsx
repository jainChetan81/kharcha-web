import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Sheet } from "../components/sheet";
import { TxnForm } from "../components/txn-form";
import { ErrorState, Skeleton } from "../components/ui";
import { fromSource } from "../lib/format";
import { getCategories, getTransaction } from "../server/fns";
export const Route = createFileRoute("/txn/$id_/edit")({
  loader: ({ params }) => Promise.all([getTransaction({ data: { id: Number(params.id) } }), getCategories()]),
  pendingComponent: () => <Skeleton rows={6} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load transaction."} retry={() => void router.invalidate()} />; },
  component: Edit,
});
function Edit() {
  const [txn, categories] = Route.useLoaderData();
  const navigate = useNavigate();
  if (!txn) return <ErrorState text="Transaction not found." back="/activity" backLabel="Back to Activity" />;
  const back = () => void navigate({ to: "/txn/$id", params: { id: String(txn.id) } });
  return <Sheet title="Edit transaction" description={fromSource(txn.source, txn.date)} onClose={back} className="tablet:min-h-[580px]"><TxnForm mode="edit" categories={categories} initial={{ ...txn, category: txn.category ?? "Other" }} onDone={back} onDeleted={() => void navigate({ to: "/activity" })} /></Sheet>;
}
