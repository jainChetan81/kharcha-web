import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sheet } from "../components/sheet";
import { TxnForm } from "../components/txn-form";
import { getCategories } from "../server/fns";
export const Route = createFileRoute("/add")({ loader: () => getCategories(), component: Add });
function Add() { const categories = Route.useLoaderData(); const navigate = useNavigate(); return <Sheet title="Add transaction" onClose={() => void navigate({ to: "/" })} className="tablet:min-h-[640px]"><TxnForm mode="add" categories={categories} onDone={() => void navigate({ to: "/" })} /></Sheet>; }
