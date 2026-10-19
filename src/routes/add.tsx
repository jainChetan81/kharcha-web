import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { Sheet } from "../components/sheet";
import { TxnForm } from "../components/txn-form";
import { getCategories } from "../server/fns";
export const Route = createFileRoute("/add")({ loader: () => getCategories(), component: Add });
function Add() {
  const categories = Route.useLoaderData();
  const navigate = useNavigate();
  const dirty = useRef(false);
  const close = () => void navigate({ to: "/" });
  const confirm = () => !dirty.current || window.confirm("Discard this transaction?");
  return <Sheet title="Add transaction" onClose={close} confirmClose={confirm} className="tablet:min-h-[640px]"><TxnForm mode="add" categories={categories} onDone={close} onCancel={() => { if (confirm()) close(); }} onDirtyChange={(d) => { dirty.current = d; }} /></Sheet>;
}
