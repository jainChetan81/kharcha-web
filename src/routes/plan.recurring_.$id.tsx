import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { SeriesForm } from "../components/series-form";
import { saveFailed, snack } from "../components/sheet";
import { Button, ErrorState, PageHeader, Skeleton } from "../components/ui";
import { money } from "../lib/format";
import { getSeries, removeSeries, saveSeries } from "../server/plan/fns";

export const Route = createFileRoute("/plan/recurring_/$id")({
  loader: ({ params }) => getSeries({ data: { id: Number(params.id) } }),
  pendingComponent: () => <Skeleton rows={5} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load series."} retry={() => void router.invalidate()} />; },
  component: Series,
});

function Series() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  if (!data) return <ErrorState text="Series not found." back="/plan/recurring" backLabel="Back to Recurring" />;
  const save = async (value: Parameters<typeof saveSeries>[0]["data"]) => {
    try {
      await saveSeries({ data: { ...value, id: data.series.id } });
      snack("Recurring saved");
      void router.invalidate();
    } catch {
      saveFailed(() => void save(value));
    }
  };
  const remove = async () => {
    if (deleting || !window.confirm(`Delete ${data.series.name}?`)) return;
    setDeleting(true);
    try {
      await removeSeries({ data: { id: data.series.id } });
      snack("Recurring deleted.");
      await navigate({ to: "/plan/recurring" });
    } catch {
      saveFailed(remove);
    } finally {
      setDeleting(false);
    }
  };
  return <>
    <PageHeader title={data.series.name} sub={`Next ${data.occurrences.find((row) => row.status === "upcoming")?.dueDate ?? "not scheduled"}`} back="/plan/recurring" />
    <main className="flex flex-col gap-6 px-5 pb-8 desk:mx-auto desk:max-w-[640px]">
      <SeriesForm initial={data.series} onSave={save} />
      <section>
        <h2 className="font-serif text-lg">Last payments</h2>
        {data.occurrences.filter((row) => row.transactionId).slice(0, 6).map((row) => <div key={row.dueDate} className="flex min-h-11 items-center justify-between border-b border-hairline text-sm"><span>{row.dueDate} · {row.status === "cleared_late" ? "Late" : "Paid"}</span><b>{row.amount ? money(row.amount) : ""}</b></div>)}
      </section>
      <Button variant="danger" disabled={deleting} onClick={() => void remove()}>{deleting ? "Deleting…" : "Delete"}</Button>
    </main>
  </>;
}
