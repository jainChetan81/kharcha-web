import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sheet } from "../components/sheet";
import { TxnForm } from "../components/txn-form";
import { fromSource } from "../lib/format";
import { getCategories, getTransaction } from "../server/fns";
export const Route = createFileRoute("/txn/$id_/edit")({ loader: ({ params }) => Promise.all([getTransaction({ data: { id: Number(params.id) } }), getCategories()]), component: Edit });
function Edit() {
  const [txn, categories] = Route.useLoaderData();
  const navigate = useNavigate();
  if (!txn) return null;
  const back = () => void navigate({ to: "/txn/$id", params: { id: String(txn.id) } });
  return <Sheet title="Edit transaction" description={fromSource(txn.source, txn.date)} onClose={back} className="tablet:min-h-[580px]"><TxnForm mode="edit" categories={categories} initial={{ ...txn, category: txn.category ?? "Other" }} onDone={back} onCancel={back} onDeleted={() => void navigate({ to: "/activity" })} /></Sheet>;
}
