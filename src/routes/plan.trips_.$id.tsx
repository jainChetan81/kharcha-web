import { saveWithSnack } from "../components/save-with-snack";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type ComponentProps } from "react";
import { saveFailed, snack } from "../components/sheet";
import { TripForm } from "../components/trip-form";
import { Button, ErrorState, PageHeader } from "../components/ui";
import { dayMonth, money } from "../lib/format";
import { endTrip, getTrip, saveTrip } from "../server/plan/fns";

export const Route = createFileRoute("/plan/trips_/$id")({
  loader: ({ params }) => getTrip({ data: { id: Number(params.id) } }),
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
  const totals = new Map<string, number>();
  for (const row of daily) totals.set(row.date.slice(0, 10), (totals.get(row.date.slice(0, 10)) ?? 0) + row.amount);
  const byDay = [...totals];
  const onSave: ComponentProps<typeof TripForm>["onSave"] = saveWithSnack(
    async (value) => {
      await saveTrip({ data: { ...value, id: trip.id } });
      snack("Trip saved.");
      void router.invalidate();
    },
    () => {
      throw new Error("Couldn't save trip");
    },
  );
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
  return (
    <>
      <PageHeader title={trip.name} sub={`${trip.startDate} – ${trip.endDate} · ${money(trip.budget)} a day`} back="/plan/trips" />
      <div className="flex flex-col gap-6 px-5 pb-8 desk:mx-auto desk:max-w-[640px]">
        <section className="rounded-panel bg-trip p-4 text-on-ink">
          <b className="font-serif text-title">{trip.name}</b>
          <p className="mb-0 text-control text-trip-muted">{money(daily.reduce((sum, row) => sum + row.amount, 0))} in daily budget</p>
        </section>
        <section>
          <h2 className="font-serif text-section">By day</h2>
          <ul className="m-0 list-none p-0">
            {byDay.map(([day, amount]) => (
              <li key={day} className="my-2 flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-control">
                  {dayMonth(day)} · {money(amount)}
                </span>
                <span
                  aria-hidden="true"
                  className="h-6 rounded-control bg-brand"
                  style={{ width: `${Math.min(100, (amount / Math.max(trip.budget, 1)) * 100)}%` }}
                />
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="font-serif text-section">Getting there</h2>
          {outside.length ? (
            outside.map((row) => (
              <p key={row.id} className="border-b border-hairline py-2 text-control">
                {row.merchant} <b className="float-right">{money(row.amount)}</b>
              </p>
            ))
          ) : (
            <p className="text-control text-ink-2">No bookings outside daily budget.</p>
          )}
        </section>
        <TripForm initial={trip} onSave={onSave} />
        <Button variant="danger" disabled={ending} onClick={() => void end()}>
          {ending ? "Ending…" : "End trip"}
        </Button>
      </div>
    </>
  );
}
