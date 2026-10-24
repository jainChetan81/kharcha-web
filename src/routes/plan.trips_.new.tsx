import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { TripForm } from "../components/trip-form";
import { Button, PageHeader } from "../components/ui";
import { saveFailed, snack } from "../components/sheet";
import { findBookings, saveTrip } from "../server/plan/fns";

export const Route = createFileRoute("/plan/trips_/new")({ component: NewTrip });
function NewTrip() {
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<{ id: number; merchant: string; amount: number }[]>();
  const [finding, setFinding] = useState(false);
  const save = async (value: Parameters<typeof saveTrip>[0]["data"]) => {
    try {
      const id = await saveTrip({ data: value });
      snack("Trip saved");
      await navigate({ to: "/plan/trips/$id", params: { id: String(id) } });
    } catch {
      saveFailed(() => void save(value));
    }
  };
  const find = async () => {
    if (finding) return;
    setFinding(true);
    try {
      const list = await findBookings({ data: { before: new Date().toISOString().slice(0, 10) } });
      setBookings(list);
      snack(list.length ? `Found ${list.length} booking${list.length === 1 ? "" : "s"}.` : "No bookings found before today.");
    } catch {
      snack("Couldn’t find bookings.");
    } finally {
      setFinding(false);
    }
  };
  return <>
    <PageHeader title="Start a trip" back="/plan/trips" />
    <main className="px-5 pb-8 desk:mx-auto desk:max-w-[640px]">
      <TripForm bookings={bookings} onSave={save} />
      <Button variant="outline" className="mt-4" disabled={finding} onClick={() => void find()}>{finding ? "Finding…" : "Find bookings before today"}</Button>
    </main>
  </>;
}
