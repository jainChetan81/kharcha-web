import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { Sheet } from "../components/sheet";
import { TxnForm } from "../components/txn-form";
import { ErrorState, Skeleton } from "../components/ui";
import { getCategories } from "../server/fns";
export const Route = createFileRoute("/add")({
  loader: () => getCategories(),
  pendingComponent: () => <Skeleton rows={6} />,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return <ErrorState text={error instanceof Error ? error.message : "Couldn't load categories."} retry={() => void router.invalidate()} />;
  },
  component: Add,
});
function Add() {
  const categories = Route.useLoaderData();
  const navigate = useNavigate();
  const dirty = useRef(false);
  const close = () => void navigate({ to: "/" });
  const confirmDiscard = () => !dirty.current || window.confirm("Discard this transaction?");
  return <Sheet title="Add transaction" onClose={close} confirmClose={confirmDiscard} className="tablet:min-h-[640px]"><TxnForm mode="add" categories={categories} onDone={close} onCancel={() => { if (confirmDiscard()) close(); }} onDirtyChange={(d) => { dirty.current = d; }} /></Sheet>;
}
