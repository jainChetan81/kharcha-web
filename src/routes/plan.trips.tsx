import { createFileRoute, Link } from "@tanstack/react-router";
import { DeskPage } from "../components/app-shell";
import { AddPlanLink, PlanHeader } from "../components/plan-screen";
import { Empty } from "../components/ui";
import { money } from "../lib/format";
import { getTrips } from "../server/plan/fns";

export const Route = createFileRoute("/plan/trips")({
  loader: () => getTrips(),
  component: Trips,
});
function Trips() {
  const trips = Route.useLoaderData();
  return (
    <DeskPage reserveRail>
      <PlanHeader sub="Trips and daily budgets" />
      <section className="mx-5 mt-5 desk:mx-0">
        <h2 className="font-serif text-section">Upcoming and active</h2>
        {trips.length ? (
          trips.map((trip) => (
            <Link
              key={trip.id}
              to="/plan/trips/$id"
              params={{ id: String(trip.id) }}
              className={`mb-3 flex min-h-28 min-w-0 flex-col justify-between rounded-card p-4 ${trip.active ? "bg-trip text-on-ink" : "border border-rule bg-card"}`}
            >
              <span className="min-w-0">
                <b className="block truncate font-serif text-title font-medium">{trip.name}</b>
                <small className={`mt-1 block truncate ${trip.active ? "text-trip-muted" : "text-ink-2"}`}>
                  {trip.startDate} – {trip.endDate} · {trip.autoTag ? "auto-tag on" : "auto-tag off"}
                </small>
              </span>
              <span className="text-control">
                {money(trip.spent)} spent · {money(trip.budget)} a day
              </span>
            </Link>
          ))
        ) : (
          <Empty text="No trips planned." action={<AddPlanLink to="/plan/trips/new" label="Start a trip" />} />
        )}
      </section>
      {trips.length > 0 && <AddPlanLink to="/plan/trips/new" label="Start a trip" />}
    </DeskPage>
  );
}
