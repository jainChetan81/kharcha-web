import { createFileRoute, Link } from "@tanstack/react-router";
import { DeskPage } from "../components/app-shell";
import { AddPlanLink, PlanError, PlanHeader, PlanPending } from "../components/plan-screen";
import { Empty } from "../components/ui";
import { money } from "../lib/format";
import { getTrips } from "../server/plan/fns";

export const Route = createFileRoute("/plan/trips")({ loader: () => getTrips(), pendingComponent: PlanPending, errorComponent: PlanError, component: Trips });
function Trips() { const trips = Route.useLoaderData(); return <DeskPage><PlanHeader sub="Trips and daily budgets" /><section className="mx-5 mt-5 desk:mx-0"><h2 className="font-serif text-lg">Upcoming and active</h2>{trips.length ? trips.map((trip) => <Link key={trip.id} to="/plan/trips/$id" params={{ id: String(trip.id) }} className={`mb-3 flex min-h-28 flex-col justify-between rounded-card p-4 ${trip.active ? "bg-trip text-on-ink" : "border border-rule bg-card"}`}><span><b className="font-serif text-[22px] font-medium">{trip.name}</b><small className={`mt-1 block ${trip.active ? "text-trip-muted" : "text-ink-3"}`}>{trip.startDate} – {trip.endDate} · {trip.autoTag ? "auto-tag on" : "auto-tag off"}</small></span><span className="text-sm">{money(trip.spent)} spent · {money(trip.budget)} a day</span></Link>) : <Empty text="No trips planned." action={<Link to="/plan/trips/new" className="text-brand">Start a trip</Link>} />}</section><AddPlanLink to="/plan/trips/new" label="Start a trip" /></DeskPage>; }
