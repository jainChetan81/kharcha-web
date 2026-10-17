import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { Sheet } from "../components/sheet";
import { TxnForm } from "../components/txn-form";
import { getCategories } from "../server/fns";
export const Route = createFileRoute("/add")({ loader: () => getCategories(), component: Add });
function Add() { const categories = Route.useLoaderData(); const navigate = useNavigate(); const dirty = useRef(false); return <Sheet title="Add transaction" onClose={() => void navigate({ to: "/" })} confirmClose={() => !dirty.current || window.confirm("Discard this transaction?")} className="tablet:min-h-[640px]"><TxnForm mode="add" categories={categories} onDone={() => void navigate({ to: "/" })} onDirtyChange={(d) => { dirty.current = d; }} /></Sheet>; }
