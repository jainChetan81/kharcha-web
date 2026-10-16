import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { TripForm } from "../components/trip-form";
import { PageHeader } from "../components/ui";
import { saveFailed, snack } from "../components/sheet";
import { findBookings, saveTrip } from "../server/plan/fns";

export const Route = createFileRoute("/plan/trips_/new")({ component: NewTrip });
function NewTrip() { const navigate = useNavigate(); const [bookings, setBookings] = useState<{ id: number; merchant: string; amount: number }[]>(); const save = async (value: Parameters<typeof saveTrip>[0]["data"]) => { try { const id = await saveTrip({ data: value }); snack("Trip saved"); await navigate({ to: "/plan/trips/$id", params: { id: String(id) } }); } catch { saveFailed(() => void save(value)); } }; return <><PageHeader title="Start a trip" back="/plan/trips" /><main className="px-5 pb-8 desk:mx-auto desk:max-w-[640px]"><TripForm bookings={bookings} onSave={save} /><button type="button" className="mt-4 text-sm font-medium text-brand" onClick={() => void findBookings({ data: { before: new Date().toISOString().slice(0, 10) } }).then(setBookings)}>Find bookings before today</button></main></>; }
