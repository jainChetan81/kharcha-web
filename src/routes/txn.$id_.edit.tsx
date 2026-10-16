import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sheet } from "../components/sheet";
import { TxnForm } from "../components/txn-form";
import { getCategories, getTransaction } from "../server/fns";
export const Route = createFileRoute("/txn/$id_/edit")({ loader: ({ params }) => Promise.all([getTransaction({ data: { id: Number(params.id) } }), getCategories()]), component: Edit });
function Edit() { const [txn, categories] = Route.useLoaderData(); const navigate = useNavigate(); if (!txn) return null; return <Sheet title="Edit transaction" description={`From ${txn.source === "sms" ? "SMS" : txn.source} · ${txn.date.slice(0, 10)}`} onClose={() => void navigate({ to: "/txn/$id", params: { id: String(txn.id) } })} className="tablet:min-h-[580px]"><TxnForm mode="edit" categories={categories} initial={{ ...txn, category: txn.category ?? "Other" }} onDone={() => void navigate({ to: "/txn/$id", params: { id: String(txn.id) } })} onDeleted={() => void navigate({ to: "/activity" })} /></Sheet>; }
