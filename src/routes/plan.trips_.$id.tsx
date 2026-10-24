import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type ComponentProps } from "react";
import { saveFailed, snack } from "../components/sheet";
import { TripForm } from "../components/trip-form";
import { Button, ErrorState, PageHeader, Skeleton } from "../components/ui";
import { money } from "../lib/format";
import { endTrip, getTrip, saveTrip } from "../server/plan/fns";

export const Route = createFileRoute("/plan/trips_/$id")({
  loader: ({ params }) => getTrip({ data: { id: Number(params.id) } }),
  pendingComponent: () => <Skeleton rows={5} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load trip."} retry={() => void router.invalidate()} />; },
  component: Trip,
});

function Trip() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  if (!data) return <ErrorState text="Trip not found." back="/plan/trips" backLabel="Back to Trips" />;
  const { trip, rows } = data;
  const daily = rows.filter((row) => row.daily);
  const outside = rows.filter((row) => !row.daily);
  const byDay = Object.entries(daily.reduce<Record<string, number>>((all, row) => ({ ...all, [row.date.slice(0, 10)]: (all[row.date.slice(0, 10)] ?? 0) + row.amount }), {}));
  const onSave: ComponentProps<typeof TripForm>["onSave"] = async (value) => {
    try {
      await saveTrip({ data: { ...value, id: trip.id } });
      snack("Trip saved.");
      void router.invalidate();
    } catch {
      saveFailed(() => void onSave(value));
      throw new Error("Couldn't save trip");
    }
  };
  const end = async () => {
    if (ending || !window.confirm(`End ${trip.name}?`)) return;
    setEnding(true);
    try {
      await endTrip({ data: { id: trip.id } });
      snack("Trip ended.");
      await navigate({ to: "/plan/trips" });
    } catch {
      saveFailed(end);
    } finally {
      setEnding(false);
    }
  };
  return <>
    <PageHeader title={trip.name} sub={`${trip.startDate} – ${trip.endDate} · ${money(trip.budget)} a day`} back="/plan/trips" />
    <main className="flex flex-col gap-6 px-5 pb-8 desk:mx-auto desk:max-w-[640px]">
      <section className="rounded-card bg-trip p-4 text-on-ink">
        <b className="font-serif text-[22px]">{trip.name}</b>
        <p className="mb-0 text-sm text-trip-muted">{money(daily.reduce((sum, row) => sum + row.amount, 0))} in daily budget</p>
      </section>
      <section>
        <h2 className="font-serif text-lg">By day</h2>
        {byDay.map(([day, amount]) => <div key={day} role="img" aria-label={`${day} spent ${money(amount)}`} className="my-2 h-6 rounded bg-brand" style={{ width: `${Math.min(100, amount / Math.max(trip.budget, 1) * 100)}%` }} />)}
      </section>
      <section>
        <h2 className="font-serif text-lg">Getting there</h2>
        {outside.length ? outside.map((row) => <p key={row.id} className="border-b border-hairline py-2 text-sm">{row.merchant} <b className="float-right">{money(row.amount)}</b></p>) : <p className="text-sm text-ink-2">No bookings outside daily budget.</p>}
      </section>
      <TripForm initial={trip} onSave={onSave} />
      <Button variant="danger" disabled={ending} onClick={() => void end()}>{ending ? "Ending…" : "End trip"}</Button>
    </main>
  </>;
}
