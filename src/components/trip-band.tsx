import { Link } from "@tanstack/react-router";
import type { ShellData } from "./app-shell";
import { dayMonth } from "../lib/format";

export function TripBand({ trip }: { trip: NonNullable<ShellData["trip"]> }) {
  return <Link to="/plan/trips/$id" params={{ id: String(trip.id) }} className="mx-5 flex min-h-20 flex-col justify-center rounded-card bg-trip px-4 text-on-ink desk:mx-0"><span className="font-serif text-[21px] font-medium">{trip.name}</span><span className="mt-1 text-[13px] text-trip-muted">{trip.active ? `Day trip · until ${dayMonth(trip.endDate)}` : `${trip.name} starts ${dayMonth(trip.startDate)}`} · {trip.autoTag ? "auto-tag on" : "auto-tag off"}</span></Link>;
}
